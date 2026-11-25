import { calculateCart } from '@/lib/money'
import { ApiError } from '@/services/apiClient'
import type { Product, UserProfile } from '@/types'
import { settingsService } from '@/services/settingsService'
import { acknowledge, deviceId, localDb, type SaleResult, type Session } from './database'
import { apiClient } from '@/services/apiClient'

interface PosCatalogResponse {
  products: {
    id: string;
    branch_id: string;
    name: string;
    sku: string;
    barcode?: string;
    category_id?: string;
    brand_id?: string;
    description?: string;
    image_url?: string;
    unit: string;
    buying_price?: number;
    selling_price: number;
    wholesale_price?: number;
    minimum_selling_price?: number;
    stock: number;
    minimum_stock: number;
    status: string;
    variants: {
      id: string;
      sku: string;
      barcode?: string;
      size?: string;
      color?: string;
      buying_price?: number;
      selling_price: number;
      stock: number;
      minimum_stock: number;
      status: string;
    }[];
  }[];
}

interface OfflineSessionResponse {
  sessionId: string;
  uid: string;
  deviceId: string;
  branchId: string;
  expiresAt: string;
}

export async function prepareDevice(profile: UserProfile) {
  if (!navigator.onLine) throw new Error('Connect to prepare this device for offline billing.')
  const scope = `${profile.uid}:${profile.branchId}`
  const items: Product[] = []
  const currentDeviceId = await deviceId()

  // Capture confirmed IDs before the request. Never release a reservation acknowledged after this snapshot.
  const confirmed = await localDb.sales.where('state').equals('synced').toArray()

  // 1. Try Cloudflare Worker REST API
  let sessionData: { id: string; expiresAt: number } | null = null

  const catalogRes = await apiClient.get<PosCatalogResponse>('/catalog/pos')
  if (catalogRes?.products) {
    for (const p of catalogRes.products) {
      items.push({
        id: p.id,
        branchId: p.branch_id || profile.branchId,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode || '',
        categoryId: p.category_id || '',
        brandId: p.brand_id || '',
        description: p.description || '',
        imageUrl: p.image_url || '',
        unit: p.unit || 'pcs',
        buyingPrice: 0, // Shielded from POS
        averageCost: 0,
        sellingPrice: p.selling_price,
        wholesalePrice: p.wholesale_price || p.selling_price,
        minimumSellingPrice: p.minimum_selling_price || 0,
        stock: p.stock,
        minimumStock: p.minimum_stock,
        status: p.status as 'active',
        variants: (p.variants || []).map((v) => ({
          id: v.id,
          sku: v.sku,
          barcode: v.barcode || '',
          size: v.size || '',
          color: v.color || '',
          buyingPrice: 0,
          sellingPrice: v.selling_price,
          stock: v.stock,
          minimumStock: v.minimum_stock,
          status: v.status as 'active',
        })),
      })
    }
  }

  const sessRes = await apiClient.post<OfflineSessionResponse>('/auth/offline-session', {
    deviceId: currentDeviceId,
  })
  if (sessRes?.sessionId) {
    sessionData = {
      id: sessRes.sessionId,
      expiresAt: new Date(sessRes.expiresAt).getTime(),
    }
  }

  if(!sessionData||!Number.isFinite(sessionData.expiresAt)||sessionData.expiresAt<=Date.now())throw new Error('Server offline authorization was not issued. Reconnect and retry.')

  const settings = await settingsService.get()
  const session: Session = { ...sessionData, uid: profile.uid, profile, settings }

  await localDb.transaction('rw', [localDb.catalog, localDb.metadata, localDb.reservations], async () => {
    await localDb.catalog.where('scope').equals(scope).delete()
    await localDb.catalog.bulkPut(items.map((product) => ({ id: `${scope}:${product.id}`, scope, product })))
    for (const sale of confirmed.filter((s) => s.branchId === profile.branchId)) {
      await localDb.reservations.where('saleId').equals(sale.id).delete()
    }
    await localDb.metadata.put({ key: `session:${profile.uid}`, value: session })
    await localDb.metadata.put({ key: `catalogTime:${profile.uid}`, value: new Date().toISOString() })
  })

  await navigator.storage?.persist?.()
  return session
}

let running: Promise<void> | undefined

export function syncSales(profile: UserProfile, manual = false, approvalReason?: string) {
  if (running) return running
  running = performSync(profile, manual, approvalReason).finally(() => {
    running = undefined
  })
  return running
}

async function performSync(profile: UserProfile, manual: boolean, approvalReason?: string) {
  if (!navigator.onLine) return

  const run = async () => {
    const rows = await localDb.outbox.toArray()
    for (const row of rows) {
      const sale = await localDb.sales.get(row.id)
      if (!sale || sale.branchId !== profile.branchId || (sale.uid !== profile.uid && !(profile.role === 'admin' && approvalReason))) {
        continue
      }
      if (!manual && (row.nextAttempt > Date.now() || sale.state === 'conflict')) {
        continue
      }

      await localDb.sales.update(sale.id, { state: 'syncing' })

      try {
        let syncedResult: SaleResult | null = null

        // 1. Try Cloudflare Worker sync endpoint
        const totals=calculateCart(sale.command.lines,sale.command.billDiscount,sale.command.taxRate)
        const tendered=sale.command.payments.reduce((acc,p)=>acc+p.amount,0)
        const credit=sale.command.payments.filter(p=>p.method==='credit').reduce((acc,p)=>acc+p.amount,0)
        const {subtotal,grandTotal}=totals,paid=grandTotal-credit,balance=credit,change=tendered-grandTotal
        const payload = {
          clientSaleId: sale.command.clientSaleId,
          deviceId: sale.command.deviceId,
          localReceiptNumber: sale.command.localReceiptNumber,
          customerId: sale.command.customer?.id,
          customerName: sale.command.customer?.name,
          subtotal,
          discount: totals.discount,
          billDiscount: sale.command.billDiscount,
          sessionId: sale.command.sessionId,
          cashierId: sale.uid,
          approvalReason,
          taxRate: sale.command.taxRate,
          tax: totals.tax,
          grandTotal,
          paid,
          balance,
          change,
          items: sale.command.lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            productName: l.name,
            sku: l.sku,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount || 0,
            lineTotal: l.unitPrice * l.quantity - (l.discount || 0),
          })),
          payments: sale.command.payments,
          notes: approvalReason || undefined,
          createdAt: sale.command.completedAt,
        }

        const res = await apiClient.post<SaleResult & {
          id: string;
          invoiceNumber: string;
          clientSaleId: string;
          status: string;
          hasConflict?: boolean;
        }>(sale.command.offline?'/sales/sync':'/sales/checkout', payload)

        if (res?.hasConflict) {
          await localDb.transaction('rw', localDb.sales, localDb.outbox, async () => {
            await localDb.sales.update(sale.id, {
              state: 'conflict',
              error: 'Server inventory conflict detected. Requires owner reconciliation.',
            })
          })
          continue
        }

        if(res.status!=='completed')throw new Error('Server did not confirm the receipt.')
        syncedResult = res

        if (syncedResult) {
          await acknowledge(sale, syncedResult)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sync failed'
        const isConflict = error instanceof ApiError && error.status>=400 && error.status<500 && error.status!==429

        await localDb.transaction('rw', localDb.sales, localDb.outbox, async () => {
          await localDb.sales.update(sale.id, {
            state: isConflict ? 'conflict' : 'pending',
            error: message,
          })
          await localDb.outbox.update(sale.id, {
            attempts: row.attempts + 1,
            nextAttempt: Date.now() + Math.min(300000, 2000 * 2 ** Math.min(row.attempts, 7)),
          })
        })
      }
    }
  }

  // Web Locks coordinate multiple tabs; server idempotency remains the final duplicate guard.
  if (navigator.locks) {
    await navigator.locks.request('z17-sync', run)
  } else {
    await run()
  }
}

export async function exportJournal(profile: UserProfile) {
  const sales = (await localDb.sales.toArray()).filter(
    (s) => s.branchId === profile.branchId && (s.uid === profile.uid || profile.role === 'admin')
  )
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: 'z17-journal-v1',
          exportedAt: new Date().toISOString(),
          sales,
        },
        null,
        2
      ),
    ],
    { type: 'application/json' }
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `z17-journal-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}
