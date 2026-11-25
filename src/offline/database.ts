import Dexie, { type Table } from 'dexie'
import type { CartLine, PaymentAllocation, Product, Settings, UserProfile } from '@/types'
import type { InvoiceData } from '@/lib/invoice'
import { calculateCart } from '@/lib/money'

export interface SaleCommand {
  clientSaleId: string; deviceId: string; localReceiptNumber: string; completedAt: string
  sessionId?: string; offline: boolean; lines: CartLine[]; billDiscount: number; taxRate: number
  payments: PaymentAllocation[]; customer?: { id: string; name: string }; cashier: { id: string; name: string }
}
export interface SaleResult { id: string; invoiceNumber: string; subtotal: number; discount: number; tax: number; grandTotal: number; paid: number; balance: number; change: number }
export interface LocalSale {
  id: string; uid: string; branchId: string; command: SaleCommand; invoice: InvoiceData
  state: 'pending' | 'syncing' | 'synced' | 'conflict'; error?: string; result?: SaleResult; syncedAt?: string
}
export interface Session { uid: string; profile: UserProfile; id: string; expiresAt: number; settings: Settings }
export class PosDatabase extends Dexie {
  catalog!: Table<{ id: string; scope: string; product: Product }, string>
  sales!: Table<LocalSale, string>
  items!: Table<{ id: string; saleId: string; line: CartLine }, string>
  reservations!: Table<{ id: string; scope: string; saleId: string; key: string; quantity: number }, string>
  outbox!: Table<{ id: string; uid: string; attempts: number; nextAttempt: number }, string>
  metadata!: Table<{ key: string; value: unknown }, string>
  constructor(name = 'z17-pos-v1') {
    super(name)
    this.version(1).stores({ catalog: 'id,scope', sales: 'id,uid,state,branchId', items: 'id,saleId', reservations: 'id,scope,saleId,key', outbox: 'id,uid,nextAttempt', metadata: 'key' })
  }
}
export const localDb = new PosDatabase()
export async function deviceId(db = localDb): Promise<string> {
  return db.transaction('rw', db.metadata, async () => {
    const old = await db.metadata.get('deviceId')
    if (old) return old.value as string
    const value = crypto.randomUUID(); await db.metadata.put({ key: 'deviceId', value }); return value
  })
}
export async function getSession(uid: string, db = localDb) {
  const row = await db.metadata.get(`session:${uid}`)
  return row?.value as Session | undefined
}
export async function availableCatalog(uid: string, branchId: string, db = localDb) {
  const scope = `${uid}:${branchId}`
  return db.transaction('r', db.catalog, db.reservations, async () => {
    const rows = await db.catalog.where('scope').equals(scope).toArray()
    const reservations = (await db.reservations.toArray()).filter(r=>r.scope.endsWith(`:${branchId}`))
    return rows.map(({ product }) => {
      const reserved = reservations.filter(r => r.key.startsWith(`${product.id}:`))
      return { ...product, stock: Math.max(0, product.stock - reserved.reduce((s,r)=>s+r.quantity,0)), variants: product.variants.map(v=>({ ...v, stock: Math.max(0,v.stock-reserved.filter(r=>r.key===`${product.id}:${v.id}`).reduce((s,r)=>s+r.quantity,0)) })) }
    })
  })
}
export async function persistSale(input: Omit<SaleCommand, 'deviceId' | 'localReceiptNumber' | 'completedAt'>, profile: UserProfile, db = localDb): Promise<LocalSale> {
  const device = await deviceId(db), scope = `${profile.uid}:${profile.branchId}`
  return db.transaction('rw', [db.sales,db.items,db.reservations,db.outbox,db.metadata,db.catalog], async () => {
    const existing = await db.sales.get(input.clientSaleId)
    if (existing) {
      if(existing.uid!==profile.uid)throw new Error('This checkout belongs to another cashier. Recover it in Sync Center.')
      return existing
    }
    const session = await getSession(profile.uid, db)
    if (input.offline && (!session || session.expiresAt < Date.now() || session.id !== input.sessionId || profile.status !== 'active' || input.payments.some(p=>p.method!=='cash'))) throw new Error('Offline checkout requires an unexpired authorized session and cash payment.')
    if (!input.lines.length || input.lines.length > 100 || !Number.isSafeInteger(input.billDiscount) || input.billDiscount < 0 || !Number.isFinite(input.taxRate) || input.taxRate < 0 || input.taxRate > 100) throw new Error('Invalid checkout totals.')
    const keys = new Set<string>()
    const catalog = await availableCatalog(profile.uid, profile.branchId, db)
    for (const line of input.lines) {
      const key = `${line.productId}:${line.variantId || ''}`, p=catalog.find(p=>p.id===line.productId), v=line.variantId?p?.variants.find(v=>v.id===line.variantId):undefined
      if (keys.has(key) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0 || !Number.isSafeInteger(line.discount) || line.discount < 0 || line.discount > line.unitPrice*line.quantity) throw new Error('Invalid or duplicate cart line.')
      keys.add(key)
      if (!p || (line.variantId&&!v) || (!line.variantId&&p.variants.length) || (v?.stock??p.stock)<line.quantity) throw new Error('Insufficient locally available stock. Refresh catalog or reconcile pending sales.')
      if (line.unitPrice !== (v?.sellingPrice ?? p.sellingPrice)) throw new Error('Catalog price changed. Re-add this item.')
    }
    const totals=calculateCart(input.lines,input.billDiscount,input.taxRate), tendered=input.payments.reduce((s,p)=>s+p.amount,0), credit=input.payments.filter(p=>p.method==='credit').reduce((s,p)=>s+p.amount,0), cash=input.payments.filter(p=>p.method==='cash').reduce((s,p)=>s+p.amount,0)
    if (!input.payments.length || input.payments.some(p=>!['cash','card','bank','qr','credit'].includes(p.method)||!Number.isSafeInteger(p.amount)||p.amount<0) || tendered<totals.grandTotal || tendered-totals.grandTotal>cash || credit>totals.grandTotal || (credit&&!input.customer?.id)) throw new Error('Invalid payment. Only cash can provide change.')
    const sequence=Number((await db.metadata.get('receiptSequence'))?.value||0)+1
    const localReceiptNumber=`LOCAL-${device.slice(0,8)}-${String(sequence).padStart(6,'0')}`
    const command: SaleCommand={...input, deviceId:device, localReceiptNumber, completedAt:new Date().toISOString()}
    const invoice: InvoiceData={invoiceNumber:localReceiptNumber,items:input.lines,subtotal:totals.subtotal,discount:totals.discount,tax:totals.tax,grandTotal:totals.grandTotal,paid:totals.grandTotal-credit,balance:credit,change:tendered-totals.grandTotal,customerName:input.customer?.name||'Walk-in Customer',cashierName:profile.name,pending:true,issuedAt:command.completedAt}
    const sale: LocalSale={id:input.clientSaleId,uid:profile.uid,branchId:profile.branchId,command,invoice,state:'pending'}
    await db.sales.add(sale)
    await db.items.bulkAdd(input.lines.map((line,i)=>({id:`${sale.id}:${i}`,saleId:sale.id,line})))
    await db.reservations.bulkAdd(input.lines.map((line,i)=>({id:`${sale.id}:${i}`,scope,saleId:sale.id,key:`${line.productId}:${line.variantId||''}`,quantity:line.quantity})))
    await db.outbox.add({id:sale.id,uid:profile.uid,attempts:0,nextAttempt:0})
    await db.metadata.put({key:'receiptSequence',value:sequence})
    return sale
  })
}
export async function acknowledge(sale: LocalSale, result: SaleResult, db=localDb) {
  await db.transaction('rw',[db.sales,db.outbox,db.metadata],async()=>{
    await db.sales.update(sale.id,{state:'synced',result,error:undefined,syncedAt:new Date().toISOString(),invoice:{...sale.invoice,...result,pending:false}})
    await db.outbox.delete(sale.id)
    // Keep reservations until a fresh server catalog is received, preventing stale stock reuse.
    await db.metadata.put({key:'lastSync',value:new Date().toISOString()})
  })
}
