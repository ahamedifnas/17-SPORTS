import type { AuthUser, D1Database, D1PreparedStatement, Env } from './types'
import { errorResponse, jsonResponse } from './helpers'

export interface CheckoutInput {
  clientSaleId: string
  deviceId: string
  localReceiptNumber?: string
  sessionId?: string
  cashierId?: string
  customerId?: string
  customerName?: string
  createdAt?: string
  approvalReason?: string
  subtotal: number
  discount: number
  billDiscount?: number
  taxRate: number
  tax: number
  grandTotal: number
  paid: number
  balance: number
  change: number
  items: {
    productId: string
    variantId?: string
    productName?: string
    sku?: string
    variantDescription?: string
    quantity: number
    unitPrice: number
    discount: number
    lineTotal: number
    tax?: number
  }[]
  payments: { method: string; amount: number }[]
  notes?: string
}

export class CheckoutError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

const validId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,128}$/.test(v)
const money = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000_000_000

export function validateCheckout(d: CheckoutInput, offline: boolean) {
  if (!d || !validId(d.clientSaleId) || !validId(d.deviceId) || !Array.isArray(d.items) || !d.items.length || d.items.length > 100) {
    throw new CheckoutError('Invalid checkout identifiers or cart.')
  }
  if (
    !['subtotal', 'discount', 'tax', 'grandTotal', 'paid', 'balance', 'change'].every((k) =>
      money(d[k as keyof CheckoutInput])
    ) ||
    !Number.isFinite(d.taxRate) ||
    d.taxRate < 0 ||
    d.taxRate > 100 ||
    d.grandTotal <= 0
  ) {
    throw new CheckoutError('Invalid money or tax values.')
  }
  if (d.billDiscount !== undefined && !money(d.billDiscount)) {
    throw new CheckoutError('Invalid bill discount.')
  }
  if (d.customerId && !validId(d.customerId)) {
    throw new CheckoutError('Invalid customer.')
  }
  const seen = new Set<string>()
  for (const l of d.items) {
    const key = `${l.productId}:${l.variantId || ''}`
    if (
      !validId(l.productId) ||
      (l.variantId && !validId(l.variantId)) ||
      seen.has(key) ||
      !Number.isSafeInteger(l.quantity) ||
      l.quantity <= 0 ||
      l.quantity > 100000 ||
      !money(l.unitPrice) ||
      l.unitPrice <= 0 ||
      !money(l.discount) ||
      !money(l.lineTotal) ||
      !money(l.unitPrice * l.quantity) ||
      l.discount > l.unitPrice * l.quantity ||
      l.lineTotal !== l.unitPrice * l.quantity - l.discount ||
      (l.tax !== undefined && !money(l.tax))
    ) {
      throw new CheckoutError('Invalid or duplicate cart line, quantity, price or discount.')
    }
    seen.add(key)
  }
  if (
    !Array.isArray(d.payments) ||
    !d.payments.length ||
    d.payments.length > 10 ||
    d.payments.some(
      (p) =>
        !['cash', 'card', 'bank', 'qr', 'credit'].includes(p.method) ||
        !money(p.amount) ||
        p.amount <= 0 ||
        (offline && p.method !== 'cash')
    )
  ) {
    throw new CheckoutError('Invalid payment. Offline receipts accept cash only.')
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function assertChanged(db: D1Database, label: string): D1PreparedStatement {
  return db.prepare('INSERT INTO transaction_guards (id,ok) VALUES (?,CASE WHEN changes() = 1 THEN 1 ELSE 0 END)').bind(label)
}

interface RequestRow {
  device_id: string
  branch_id: string
  cashier_id: string
  fingerprint: string
  state: string
  result_json: string | null
}

interface ProductRow {
  id: string
  name: string
  sku: string
  stock: number
  status: string
  selling_price: number
  buying_price: number
  average_cost: number
  minimum_selling_price: number
  variant_count: number
}

interface VariantRow {
  id: string
  sku: string
  stock: number
  selling_price: number
  buying_price: number
  status: string
}

export async function checkout(
  request: Request,
  env: Env,
  user: AuthUser | null,
  offline: boolean
): Promise<Response> {
  if (!user || user.status !== 'active') return errorResponse('Unauthorized', 401)
  if (!['admin', 'manager', 'cashier'].includes(user.role)) return errorResponse('Forbidden', 403)

  let d: CheckoutInput
  try {
    d = (await request.json()) as CheckoutInput
    validateCheckout(d, offline)
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Invalid JSON', 400)
  }

  const branch = user.branch_id
  const db = env.DB
  const uid = d.cashierId || user.uid
  const approval = user.role === 'admin' && typeof d.approvalReason === 'string' && d.approvalReason.trim().length >= 10

  if (uid !== user.uid && !approval) {
    return errorResponse('Owner approval required to recover another cashier receipt.', 403)
  }

  const hashInput = { ...d, approvalReason: undefined, notes: undefined, cashierId: uid, offline }
  const fingerprint = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(hashInput))))
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')

  const read = () => db.prepare('SELECT * FROM checkout_requests WHERE client_sale_id=?').bind(d.clientSaleId).first<RequestRow>()
  const replay = (row: RequestRow) => {
    if (row.fingerprint !== fingerprint || row.branch_id !== branch || row.device_id !== d.deviceId || row.cashier_id !== uid) {
      return errorResponse('Checkout ID already belongs to different contents or identity.', 409)
    }
    if (row.state === 'completed' && row.result_json) {
      return jsonResponse(JSON.parse(row.result_json), 200)
    }
    if (row.state === 'conflict') {
      if (row.result_json && !approval) {
        return jsonResponse(JSON.parse(row.result_json), 200)
      }
    }
    return null
  }

  const old = await read()
  if (old) {
    const result = replay(old)
    if (result) return result
    if (old.state === 'conflict' && !approval) {
      return errorResponse('Stock/catalog conflict requires owner reconciliation and explicit approval.', 409)
    }
  }

  const legacy = await db.prepare('SELECT id FROM sales WHERE client_sale_id=?').bind(d.clientSaleId).first()
  if (legacy && !old) {
    return errorResponse('Historical receipt already exists; reconcile it without resubmitting.', 409)
  }

  try {
    if (offline) {
      if (!validId(d.sessionId) || !d.createdAt || !Number.isFinite(Date.parse(d.createdAt))) {
        throw new CheckoutError('Server-issued offline session and sale time required.', 403)
      }
      const session = await db
        .prepare('SELECT * FROM offline_sessions WHERE id=? AND uid=? AND device_id=? AND branch_id=?')
        .bind(d.sessionId, uid, d.deviceId, branch)
        .first<{ issued_at: string; expires_at: string }>()
      const parse = (s: string) => Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
      if (
        !session ||
        Date.parse(d.createdAt) < parse(session.issued_at) ||
        Date.parse(d.createdAt) > parse(session.expires_at) ||
        Date.parse(d.createdAt) > Date.now() + 60000
      ) {
        throw new CheckoutError('Offline session is invalid or expired at checkout.', 403)
      }
    }

    await db
      .prepare(
        "INSERT INTO checkout_requests(client_sale_id,device_id,branch_id,cashier_id,fingerprint,payload_json,state) VALUES(?,?,?,?,?,?,'pending') ON CONFLICT(client_sale_id) DO NOTHING"
      )
      .bind(d.clientSaleId, d.deviceId, branch, uid, fingerprint, canonical(d))
      .run()

    const current = (await read())!
    const already = replay(current)
    if (already) return already

    const settings = await db
      .prepare('SELECT * FROM settings WHERE branch_id=?')
      .bind(branch)
      .first<{ invoice_prefix: string; tax_enabled: number; tax_rate: number; require_manager_below_minimum: number }>()
    const taxRate = settings?.tax_enabled ? settings.tax_rate : 0
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100 || d.taxRate !== taxRate) {
      throw new CheckoutError('Tax settings mismatch.', 409)
    }

    let hasConflict = false
    let conflictReason = ''
    const rows: { line: CheckoutInput['items'][number]; product: ProductRow; variant: VariantRow | null }[] = []

    for (const line of d.items) {
      const p = await db
        .prepare(
          'SELECT p.*, (SELECT COUNT(*) FROM product_variants WHERE product_id=p.id) AS variant_count FROM products p WHERE p.id=? AND p.branch_id=?'
        )
        .bind(line.productId, branch)
        .first<ProductRow>()

      if (!p || p.status !== 'active') {
        if (offline) {
          hasConflict = true
          conflictReason = `Product unavailable or inactive: ${line.productId}`
          break
        }
        throw new CheckoutError('Unknown or inactive product.', 400)
      }

      const v = line.variantId
        ? await db.prepare('SELECT * FROM product_variants WHERE id=? AND product_id=?').bind(line.variantId, line.productId).first<VariantRow>()
        : null

      if ((line.variantId && (!v || v.status !== 'active')) || (!line.variantId && p.variant_count > 0)) {
        if (offline) {
          hasConflict = true
          conflictReason = `Variant unavailable or missing for ${p.name}`
          break
        }
        throw new CheckoutError('Unknown, inactive or missing variant.', 400)
      }

      const authoritativePrice = v?.selling_price ?? p.selling_price
      if (line.unitPrice !== authoritativePrice) {
        if (offline) {
          hasConflict = true
          conflictReason = `Price mismatch for ${p.name} (client: ${line.unitPrice}, server: ${authoritativePrice})`
        } else {
          throw new CheckoutError('Product price mismatch.', 409)
        }
      }

      const currentStock = v?.stock ?? p.stock
      if (currentStock < line.quantity) {
        if (offline) {
          hasConflict = true
          conflictReason = `Stock conflict: insufficient stock for ${p.name} (requested ${line.quantity}, available ${currentStock})`
        } else {
          throw new CheckoutError(`Stock conflict: insufficient stock for ${p.name}.`, 409)
        }
      }

      rows.push({ line, product: p, variant: v })
    }

    const subtotal = d.items.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
    const itemDiscount = d.items.reduce((s, l) => s + l.discount, 0)
    const billDiscount = d.billDiscount ?? d.discount - itemDiscount
    const discount = itemDiscount + billDiscount

    if (!money(billDiscount) || discount > subtotal || discount !== d.discount) {
      throw new CheckoutError('Inconsistent discount.')
    }

    const tax = Math.round(((subtotal - discount) * taxRate) / 100)
    const grandTotal = subtotal - discount + tax

    if (!money(subtotal) || !money(grandTotal) || grandTotal <= 0 || d.subtotal !== subtotal || d.tax !== tax || d.grandTotal !== grandTotal) {
      throw new CheckoutError('Inconsistent subtotal, tax or grand total.')
    }

    const tendered = d.payments.reduce((s, p) => s + p.amount, 0)
    const credit = d.payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0)
    const cash = d.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
    const change = tendered - grandTotal
    const paid = grandTotal - credit

    if (!money(tendered) || credit > grandTotal || change < 0 || change > cash || d.paid !== paid || d.balance !== credit || d.change !== change) {
      throw new CheckoutError('Inconsistent payment amounts or change.')
    }

    const customer = d.customerId
      ? await db
          .prepare("SELECT * FROM customers WHERE id=? AND branch_id=? AND status='active'")
          .bind(d.customerId, branch)
          .first<{ name: string; current_credit: number; credit_limit: number }>()
      : null

    if ((d.customerId && !customer) || (credit > 0 && (!customer || customer.current_credit + credit > customer.credit_limit))) {
      if (offline) {
        hasConflict = true
        conflictReason = 'Customer unavailable or credit limit exceeded.'
      } else {
        throw new CheckoutError('Customer unavailable or credit limit exceeded.', 409)
      }
    }

    const saleId = `sale_${d.clientSaleId}`
    const year = new Date().getUTCFullYear()
    const counter = `invoice-${year}`
    const prefix = settings?.invoice_prefix || 'INV'
    const guardPrefix = crypto.randomUUID()
    const statements: D1PreparedStatement[] = []

    statements.push(
      db
        .prepare("UPDATE checkout_requests SET state='applying' WHERE client_sale_id=? AND fingerprint=? AND state IN ('pending','conflict')")
        .bind(d.clientSaleId, fingerprint),
      assertChanged(db, `${guardPrefix}:request`)
    )

    statements.push(
      db
        .prepare(
          "INSERT INTO transaction_guards(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM users WHERE uid=? AND branch_id=? AND status='active' AND role=?) AND COALESCE((SELECT CASE WHEN tax_enabled=1 THEN tax_rate ELSE 0 END FROM settings WHERE branch_id=?),0)=? THEN 1 ELSE 0 END"
        )
        .bind(`${guardPrefix}:auth`, user.uid, branch, user.role, branch, taxRate)
    )

    statements.push(
      db.prepare('INSERT INTO counters(key,sequence) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET sequence=sequence+1').bind(counter)
    )

    const invoiceExpr = "? || '-' || ? || '-' || printf('%06d',(SELECT sequence FROM counters WHERE key=?))"
    let cumulativeBase = 0
    let cumulativeNet = 0
    let cost = 0

    const items = rows.map(({ line: l, product: p, variant: v }) => {
      const base = subtotal - itemDiscount
      const billShare = base ? Math.round((billDiscount * (cumulativeBase + l.lineTotal)) / base) - Math.round((billDiscount * cumulativeBase) / base) : 0
      cumulativeBase += l.lineTotal
      const net = l.lineTotal - billShare
      const taxBase = subtotal - discount
      const taxShare = taxBase ? Math.round((tax * (cumulativeNet + net)) / taxBase) - Math.round((tax * cumulativeNet) / taxBase) : 0
      cumulativeNet += net

      if (l.tax !== undefined && l.tax !== taxShare) throw new CheckoutError('Inconsistent line tax.')
      if (user.role === 'cashier' && settings?.require_manager_below_minimum && net < p.minimum_selling_price * l.quantity) {
        throw new CheckoutError('Manager approval required below minimum price.', 403)
      }

      const unitCost = v?.buying_price ?? p.average_cost ?? p.buying_price ?? 0
      cost += unitCost * l.quantity
      return { l, p, v, unitCost, net, taxShare, discount: l.discount + billShare }
    })

    if (!money(cost)) throw new CheckoutError('Invalid total cost.', 409)

    // CASE 1: OFFLINE STOCK CONFLICT PRESERVATION
    // Preserve sale in sales and items for owner reconciliation WITHOUT deducting stock or applying credit
    if (offline && hasConflict && !approval) {
      const conflictResult = {
        id: saleId,
        invoiceNumber: `${prefix}-${year}-PENDING`,
        clientSaleId: d.clientSaleId,
        subtotal,
        discount,
        tax,
        grandTotal,
        paid,
        balance: credit,
        change,
        status: 'conflict',
        hasConflict: true,
        success: true,
        message: conflictReason,
      }

      statements.push(
        db
          .prepare(
            `INSERT INTO sales(id,branch_id,invoice_number,client_sale_id,device_id,local_receipt_number,customer_id,customer_name,cashier_id,cashier_name,subtotal,discount,tax_rate,tax,grand_total,paid,balance,change,cost,gross_profit,status,is_offline,notes,created_at)
             VALUES(?,?,${invoiceExpr},?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'conflict',?,?,?)`
          )
          .bind(
            saleId,
            branch,
            prefix,
            String(year),
            counter,
            d.clientSaleId,
            d.deviceId,
            d.localReceiptNumber || null,
            d.customerId || null,
            customer?.name || 'Walk-in Customer',
            uid,
            user.name,
            subtotal,
            discount,
            taxRate,
            tax,
            grandTotal,
            paid,
            credit,
            change,
            cost,
            grandTotal - tax - cost,
            1,
            conflictReason,
            d.createdAt!
          )
      )

      for (const { l, p, v, unitCost, net, taxShare, discount: lineDiscount } of items) {
        statements.push(
          db
            .prepare(
              'INSERT INTO sale_items(id,sale_id,product_id,variant_id,product_name,sku,variant_description,quantity,unit_price,cost_price,discount,line_total,tax) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
            )
            .bind(crypto.randomUUID(), saleId, p.id, v?.id || null, p.name, v?.sku || p.sku, l.variantDescription || null, l.quantity, l.unitPrice, unitCost, lineDiscount, net, taxShare)
        )
      }

      let remChange = change
      for (const payment of d.payments) {
        const refund = payment.method === 'cash' ? Math.min(remChange, payment.amount) : 0
        remChange -= refund
        statements.push(
          db.prepare('INSERT INTO sale_payments(id,sale_id,method,amount) VALUES(?,?,?,?)').bind(crypto.randomUUID(), saleId, payment.method, payment.amount - refund)
        )
      }

      statements.push(
        db
          .prepare(
            "UPDATE checkout_requests SET state='conflict',error=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE client_sale_id=?"
          )
          .bind(conflictReason, JSON.stringify(conflictResult), d.clientSaleId)
      )

      statements.push(
        db
          .prepare('INSERT INTO audit_logs(id,branch_id,user_id,user_name,action,module,reference_id,description) VALUES(?,?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(), branch, user.uid, user.name, 'conflict', 'sales', saleId, conflictReason)
      )

      statements.push(db.prepare('DELETE FROM transaction_guards WHERE id LIKE ?').bind(`${guardPrefix}:%`))

      await db.batch(statements)
      return jsonResponse(conflictResult, 200)
    }

    // CASE 2: NORMAL CHECKOUT OR APPROVED RECONCILIATION
    statements.push(
      db
        .prepare(
          `INSERT INTO sales(id,branch_id,invoice_number,client_sale_id,device_id,local_receipt_number,customer_id,customer_name,cashier_id,cashier_name,subtotal,discount,tax_rate,tax,grand_total,paid,balance,change,cost,gross_profit,status,is_offline,notes,created_at)
           VALUES(?,?,${invoiceExpr},?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'completed',?,?,?)
           ON CONFLICT(client_sale_id) DO UPDATE SET status='completed', notes=?`
        )
        .bind(
          saleId,
          branch,
          prefix,
          String(year),
          counter,
          d.clientSaleId,
          d.deviceId,
          d.localReceiptNumber || null,
          d.customerId || null,
          customer?.name || 'Walk-in Customer',
          uid,
          user.name,
          subtotal,
          discount,
          taxRate,
          tax,
          grandTotal,
          paid,
          credit,
          change,
          cost,
          grandTotal - tax - cost,
          offline ? 1 : 0,
          d.approvalReason || d.notes || null,
          offline ? d.createdAt! : new Date().toISOString(),
          d.approvalReason || d.notes || null
        )
    )

    for (const { l, p, v, unitCost, net, taxShare, discount: lineDiscount } of items) {
      if (v) {
        statements.push(
          db
            .prepare(
              "UPDATE product_variants SET stock=stock-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND product_id=? AND status='active' AND stock>=?"
            )
            .bind(l.quantity, v.id, p.id, l.quantity)
        )
      } else {
        statements.push(
          db
            .prepare(
              "UPDATE products SET stock=stock-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND branch_id=? AND status='active' AND stock>=? AND NOT EXISTS(SELECT 1 FROM product_variants WHERE product_id=?)"
            )
            .bind(l.quantity, p.id, branch, l.quantity, p.id)
        )
      }
      statements.push(assertChanged(db, `${guardPrefix}:${p.id}:${v?.id || ''}`))

      const stockExpr = v ? '(SELECT stock FROM product_variants WHERE id=?)' : '(SELECT stock FROM products WHERE id=?)'
      const stockId = v?.id || p.id

      statements.push(
        db
          .prepare(
            `INSERT INTO stock_movements(id,branch_id,product_id,variant_id,type,quantity,before_stock,after_stock,reference_id,reason,created_by) VALUES(?,?,?,?,'sale',?,${stockExpr}+?,${stockExpr},?,?,?)`
          )
          .bind(crypto.randomUUID(), branch, p.id, v?.id || null, -l.quantity, stockId, l.quantity, stockId, saleId, offline ? 'Offline reconciliation' : 'POS sale', user.uid)
      )

      statements.push(
        db
          .prepare(
            'INSERT OR REPLACE INTO sale_items(id,sale_id,product_id,variant_id,product_name,sku,variant_description,quantity,unit_price,cost_price,discount,line_total,tax) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
          )
          .bind(crypto.randomUUID(), saleId, p.id, v?.id || null, p.name, v?.sku || p.sku, l.variantDescription || null, l.quantity, l.unitPrice, unitCost, lineDiscount, net, taxShare)
      )
    }

    for (const pid of new Set(items.filter((i) => i.v).map((i) => i.p.id))) {
      statements.push(
        db
          .prepare('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id=? AND status=\'active\'),updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .bind(pid, pid)
      )
    }

    let remainingChange = change
    for (const payment of d.payments) {
      const refund = payment.method === 'cash' ? Math.min(remainingChange, payment.amount) : 0
      remainingChange -= refund
      statements.push(
        db.prepare('INSERT INTO sale_payments(id,sale_id,method,amount) VALUES(?,?,?,?)').bind(crypto.randomUUID(), saleId, payment.method, payment.amount - refund)
      )
    }

    if (credit > 0) {
      statements.push(
        db
          .prepare(
            "UPDATE customers SET current_credit=current_credit+?,current_balance=current_balance+? WHERE id=? AND branch_id=? AND status='active' AND current_credit+?<=credit_limit"
          )
          .bind(credit, credit, d.customerId!, branch, credit),
        assertChanged(db, `${guardPrefix}:credit`)
      )
    }

    statements.push(
      db
        .prepare(
          "UPDATE checkout_requests SET state='completed',error=NULL,result_json=(SELECT json_object('id',id,'invoiceNumber',invoice_number,'clientSaleId',client_sale_id,'subtotal',subtotal,'discount',discount,'tax',tax,'grandTotal',grand_total,'paid',paid,'balance',balance,'change',change,'status',status,'hasConflict',json('false'),'success',json('true')) FROM sales WHERE id=?),updated_at=CURRENT_TIMESTAMP WHERE client_sale_id=?"
        )
        .bind(saleId, d.clientSaleId)
    )

    statements.push(
      db
        .prepare('INSERT INTO audit_logs(id,branch_id,user_id,user_name,action,module,reference_id,description) VALUES(?,?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), branch, user.uid, user.name, approval ? 'reconcile' : 'checkout', 'sales', saleId, d.approvalReason || 'Completed authoritative checkout')
    )

    statements.push(db.prepare('DELETE FROM transaction_guards WHERE id LIKE ?').bind(`${guardPrefix}:%`))

    try {
      await db.batch(statements)
    } catch (error) {
      const committed = await read()
      if (committed?.state === 'completed') return replay(committed)!
      if (String(error).includes('CHECK constraint failed') || String(error).includes('UNIQUE constraint failed')) {
        throw new CheckoutError('Stock conflict or concurrent modification; no sale mutations were applied.', 409)
      }
      throw error
    }

    return jsonResponse(JSON.parse((await read())!.result_json!), 201)
  } catch (error) {
    if (error instanceof CheckoutError) {
      if (offline && error.status === 409) {
        await db
          .prepare("UPDATE checkout_requests SET state='conflict',error=?,updated_at=CURRENT_TIMESTAMP WHERE client_sale_id=? AND fingerprint=? AND state!='completed'")
          .bind(error.message, d.clientSaleId, fingerprint)
          .run()
      }
      return errorResponse(error.message, error.status)
    }
    throw error
  }
}
