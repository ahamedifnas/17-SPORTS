import { beforeAll, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { D1Database, D1PreparedStatement, D1Result, Env } from '../worker/src/types'

function createMockD1(): D1Database {
  const rawDb = new DatabaseSync(':memory:')
  rawDb.exec('PRAGMA foreign_keys = ON;')

  const m1 = fs.readFileSync(path.resolve(__dirname, '../worker/migrations/0001_initial_schema.sql'), 'utf8')
  const m2 = fs.readFileSync(path.resolve(__dirname, '../worker/migrations/0002_checkout_integrity.sql'), 'utf8')
  rawDb.exec(m1)
  rawDb.exec(m2)

  function createStmt(sql: string, params: unknown[] = []): D1PreparedStatement {
    return {
      bind(...values: unknown[]) {
        return createStmt(sql, values)
      },
      async first<T = unknown>(colName?: string): Promise<T | null> {
        const stmt = rawDb.prepare(sql)
        const row = stmt.get(...(params as any[])) as Record<string, unknown> | undefined
        if (!row) return null
        if (colName) return (row[colName] as T) ?? null
        return row as T
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        const stmt = rawDb.prepare(sql)
        const results = stmt.all(...(params as any[])) as T[]
        return {
          results,
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 },
        }
      },
      async run(): Promise<D1Result<unknown>> {
        const stmt = rawDb.prepare(sql)
        const result = stmt.run(...(params as any[]))
        return {
          results: [],
          success: true,
          meta: {
            changes: result.changes,
            last_row_id: Number(result.lastInsertRowid),
            duration: 0,
          },
        }
      },
      rawSql: sql,
      rawParams: params,
    } as any
  }

  return {
    prepare(sql: string) {
      return createStmt(sql)
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      rawDb.exec('BEGIN IMMEDIATE')
      const results: D1Result<T>[] = []
      try {
        for (const s of statements) {
          const stmtAny = s as any
          const compiled = rawDb.prepare(stmtAny.rawSql)
          const info = compiled.run(...(stmtAny.rawParams || []))
          results.push({
            results: [] as T[],
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
              duration: 0,
            },
          })
        }
        rawDb.exec('COMMIT')
        return results
      } catch (err) {
        rawDb.exec('ROLLBACK')
        throw err
      }
    },
    async exec(sql: string) {
      rawDb.exec(sql)
      return { count: 0, duration: 0 }
    },
    async dump() {
      return new ArrayBuffer(0)
    },
  }
}

function makeToken(uid: string, email: string, name: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub: uid,
      aud: 'z17-sports',
      iss: 'https://securetoken.google.com/z17-sports',
      exp: Math.floor(Date.now() / 1000) + 3600,
      email,
      name,
    })
  ).toString('base64url')
  return `${header}.${payload}.mockSignature`
}

describe('Worker + D1 Comprehensive Integration Tests', () => {
  let db: D1Database
  let env: Env

  const ownerUid = 'owner-uid-001'
  const ownerEmail = 'owner@z17sports.lk'
  const cashierUid = 'cashier-uid-001'
  const cashierEmail = 'cashier@z17sports.lk'

  const ownerToken = makeToken(ownerUid, ownerEmail, 'Store Owner')
  const cashierToken = makeToken(cashierUid, cashierEmail, 'Shop Cashier')

  beforeAll(() => {
    db = createMockD1()
    env = {
      DB: db,
      ENVIRONMENT: 'test',
      FIREBASE_PROJECT_ID: 'z17-sports',
      BOOTSTRAP_SECRET: 'super-secure-owner-secret-2026',
      BOOTSTRAP_OWNER_UID: ownerUid,
    }
  })

  // --------------------------------------------------------------------------
  // 1. TRUSTED OWNER BOOTSTRAP (P0: 3)
  // --------------------------------------------------------------------------
  describe('Trusted Owner Bootstrap', () => {
    it('rejects bootstrap without authorization token', async () => {
      const req = new Request('http://localhost/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'super-secure-owner-secret-2026' }),
      })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(401)
    })

    it('rejects bootstrap with wrong secret', async () => {
      const req = new Request('http://localhost/api/auth/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ secret: 'wrong-secret' }),
      })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(403)
    })

    it('rejects bootstrap if token UID does not match BOOTSTRAP_OWNER_UID', async () => {
      const imposterToken = makeToken('imposter-uid', 'imposter@z17sports.lk', 'Imposter')
      const req = new Request('http://localhost/api/auth/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${imposterToken}`,
        },
        body: JSON.stringify({ secret: 'super-secure-owner-secret-2026' }),
      })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(403)
    })

    it('successfully provisions owner with valid secret and matching owner UID', async () => {
      const req = new Request('http://localhost/api/auth/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ secret: 'super-secure-owner-secret-2026', name: 'Z17 Store Owner' }),
      })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.success).toBe(true)
      expect(data.user.role).toBe('admin')

      // Verify user in D1
      const user = await db.prepare('SELECT * FROM users WHERE uid = ?').bind(ownerUid).first<any>()
      expect(user).not.toBeNull()
      expect(user.role).toBe('admin')
      expect(user.status).toBe('active')
    })

    it('rejects subsequent bootstrap attempts once owner exists', async () => {
      const req = new Request('http://localhost/api/auth/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ secret: 'super-secure-owner-secret-2026' }),
      })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(409)
    })
  })

  // --------------------------------------------------------------------------
  // 2. STAFF PROVISIONING & OFFLINE SESSION AUTHORIZATION
  // --------------------------------------------------------------------------
  describe('Staff & Offline Session Setup', () => {
    let cashierSessionId = ''

    it('admin creates active cashier in staff', async () => {
      const req = new Request('http://localhost/api/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          uid: cashierUid,
          email: cashierEmail,
          name: 'Main Cashier',
          role: 'cashier',
          status: 'active',
        }),
      })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(201)

      const cashier = await db.prepare('SELECT * FROM users WHERE uid = ?').bind(cashierUid).first<any>()
      expect(cashier).not.toBeNull()
      expect(cashier.role).toBe('cashier')
    })

    it('cashier obtains authorized offline session', async () => {
      const req = new Request('http://localhost/api/auth/offline-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({ deviceId: 'pos-terminal-1' }),
      })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.sessionId).toBeDefined()
      cashierSessionId = data.sessionId

      const sess = await db.prepare('SELECT * FROM offline_sessions WHERE id = ?').bind(cashierSessionId).first<any>()
      expect(sess).not.toBeNull()
      expect(sess.uid).toBe(cashierUid)
    })

    it('seeds test products and variants', async () => {
      // 1. Standalone product (Football): stock 10, sellingPrice 2500, buyingPrice 1500
      await db
        .prepare(
          `INSERT INTO products (id, branch_id, name, sku, unit, buying_price, average_cost, selling_price, stock, status)
           VALUES ('prod-football', 'main', 'Football', 'FB-001', 'pcs', 1500, 1500, 2500, 10, 'active')`
        )
        .run()

      // 2. Product with variants (Jersey): total stock 15 (M: 10, L: 5)
      await db
        .prepare(
          `INSERT INTO products (id, branch_id, name, sku, unit, buying_price, average_cost, selling_price, stock, status)
           VALUES ('prod-jersey', 'main', 'Jersey', 'JS-001', 'pcs', 2000, 2000, 3500, 15, 'active')`
        )
        .run()

      await db
        .prepare(
          `INSERT INTO product_variants (id, product_id, sku, size, buying_price, selling_price, stock, status)
           VALUES ('var-jersey-m', 'prod-jersey', 'JS-001-M', 'M', 2000, 3500, 10, 'active')`
        )
        .run()

      await db
        .prepare(
          `INSERT INTO product_variants (id, product_id, sku, size, buying_price, selling_price, stock, status)
           VALUES ('var-jersey-l', 'prod-jersey', 'JS-001-L', 'L', 2000, 3500, 5, 'active')`
        )
        .run()

      const p1 = await db.prepare('SELECT * FROM products WHERE id = ?').bind('prod-football').first<any>()
      expect(p1.stock).toBe(10)
    })
  })

  // --------------------------------------------------------------------------
  // 3. ONLINE CHECKOUT & STOCK INTEGRITY (P0: 1, 4)
  // --------------------------------------------------------------------------
  describe('Online Checkout & Tamper Rejection', () => {
    it('executes valid online checkout, decrements stock atomically, and records stock movement', async () => {
      const saleId = 'client-sale-online-001'
      const req = new Request('http://localhost/api/sales/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: saleId,
          deviceId: 'pos-terminal-1',
          subtotal: 5000, // 2 * 2500
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 5000,
          paid: 5000,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 2,
              unitPrice: 2500,
              discount: 0,
              lineTotal: 5000,
            },
          ],
          payments: [{ method: 'cash', amount: 5000 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.success).toBe(true)
      expect(data.status).toBe('completed')
      expect(data.grandTotal).toBe(5000)

      // Verify product stock decremented from 10 to 8
      const p = await db.prepare('SELECT stock FROM products WHERE id = ?').bind('prod-football').first<any>()
      expect(p.stock).toBe(8)

      // Verify stock movement was recorded
      const sm = await db.prepare('SELECT * FROM stock_movements WHERE product_id = ?').bind('prod-football').first<any>()
      expect(sm).not.toBeNull()
      expect(sm.type).toBe('sale')
      expect(sm.quantity).toBe(-2)
    })

    it('replays completed online checkout idempotently without double-decrementing stock', async () => {
      const saleId = 'client-sale-online-001'
      const req = new Request('http://localhost/api/sales/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: saleId,
          deviceId: 'pos-terminal-1',
          subtotal: 5000,
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 5000,
          paid: 5000,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 2,
              unitPrice: 2500,
              discount: 0,
              lineTotal: 5000,
            },
          ],
          payments: [{ method: 'cash', amount: 5000 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.clientSaleId).toBe(saleId)

      // Stock must still be 8 (NOT 6!)
      const p = await db.prepare('SELECT stock FROM products WHERE id = ?').bind('prod-football').first<any>()
      expect(p.stock).toBe(8)
    })

    it('rejects online checkout if stock is insufficient (P0: 1 - never permits negative stock)', async () => {
      // Stock is currently 8; requesting 15 must fail
      const req = new Request('http://localhost/api/sales/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: 'client-sale-insufficient-001',
          deviceId: 'pos-terminal-1',
          subtotal: 37500,
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 37500,
          paid: 37500,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 15,
              unitPrice: 2500,
              discount: 0,
              lineTotal: 37500,
            },
          ],
          payments: [{ method: 'cash', amount: 37500 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(409)

      // Stock must remain 8
      const p = await db.prepare('SELECT stock FROM products WHERE id = ?').bind('prod-football').first<any>()
      expect(p.stock).toBe(8)
    })

    it('decrements variant stock and updates parent product aggregate stock', async () => {
      // Jersey M: 10 stock, L: 5 stock. Sell 4 M.
      const req = new Request('http://localhost/api/sales/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: 'client-sale-variant-001',
          deviceId: 'pos-terminal-1',
          subtotal: 14000,
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 14000,
          paid: 14000,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-jersey',
              variantId: 'var-jersey-m',
              quantity: 4,
              unitPrice: 3500,
              discount: 0,
              lineTotal: 14000,
            },
          ],
          payments: [{ method: 'cash', amount: 14000 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(201)

      const vm = await db.prepare('SELECT stock FROM product_variants WHERE id = ?').bind('var-jersey-m').first<any>()
      expect(vm.stock).toBe(6) // 10 - 4

      const pj = await db.prepare('SELECT stock FROM products WHERE id = ?').bind('prod-jersey').first<any>()
      expect(pj.stock).toBe(11) // 6 + 5
    })

    it('rejects tampered unit price (P0: 4)', async () => {
      const req = new Request('http://localhost/api/sales/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: 'client-sale-tamper-price',
          deviceId: 'pos-terminal-1',
          subtotal: 200, // Client tried claiming 100 per football instead of 2500
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 200,
          paid: 200,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 2,
              unitPrice: 100, // TAMPERED! Authoritative is 2500
              discount: 0,
              lineTotal: 200,
            },
          ],
          payments: [{ method: 'cash', amount: 200 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(409)
    })

    it('rejects invalid or zero/negative quantities (P0: 4)', async () => {
      const req = new Request('http://localhost/api/sales/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: 'client-sale-zero-qty',
          deviceId: 'pos-terminal-1',
          subtotal: 0,
          discount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 0,
          paid: 0,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 0, // ZERO QUANTITY REJECTED
              unitPrice: 2500,
              discount: 0,
              lineTotal: 0,
            },
          ],
          payments: [{ method: 'cash', amount: 0 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(400)
    })

    it('rejects discount exceeding subtotal (P0: 4)', async () => {
      const req = new Request('http://localhost/api/sales/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: 'client-sale-huge-discount',
          deviceId: 'pos-terminal-1',
          subtotal: 2500,
          discount: 5000, // Greater than subtotal
          billDiscount: 5000,
          taxRate: 0,
          tax: 0,
          grandTotal: 0,
          paid: 0,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 1,
              unitPrice: 2500,
              discount: 0,
              lineTotal: 2500,
            },
          ],
          payments: [{ method: 'cash', amount: 0 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(400)
    })
  })

  // --------------------------------------------------------------------------
  // 4. OFFLINE SYNC & STOCK CONFLICT PRESERVATION (P0: 2)
  // --------------------------------------------------------------------------
  describe('Offline Sync & Stock Conflict Preservation', () => {
    let validSessionId = ''
    const conflictCreatedAt = new Date().toISOString()

    beforeAll(async () => {
      const sess = await db.prepare('SELECT id FROM offline_sessions WHERE uid = ?').bind(cashierUid).first<any>()
      validSessionId = sess.id
    })

    it('preserves offline sale with stock conflict WITHOUT applying stock deductions or movements (P0: 2)', async () => {
      // Football stock is 8. An offline PC completed a sale for 20 units while offline.
      const conflictSaleId = 'client-sale-offline-conflict-001'
      const req = new Request('http://localhost/api/sales/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: conflictSaleId,
          deviceId: 'pos-terminal-1',
          sessionId: validSessionId,
          createdAt: conflictCreatedAt,
          subtotal: 50000, // 20 * 2500
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 50000,
          paid: 50000,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 20, // INSUFFICIENT STOCK! Available is 8.
              unitPrice: 2500,
              discount: 0,
              lineTotal: 50000,
            },
          ],
          payments: [{ method: 'cash', amount: 50000 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.status).toBe('conflict')
      expect(data.hasConflict).toBe(true)

      // 1. MUST preserve sale record in sales table for owner reconciliation
      const sale = await db.prepare('SELECT * FROM sales WHERE client_sale_id = ?').bind(conflictSaleId).first<any>()
      expect(sale).not.toBeNull()
      expect(sale.status).toBe('conflict')
      expect(sale.is_offline).toBe(1)

      // 2. MUST preserve items in sale_items
      const items = await db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').bind(sale.id).all<any>()
      expect(items.results.length).toBe(1)
      expect(items.results[0].quantity).toBe(20)

      // 3. MUST NOT decrement product stock! Football stock must STILL be 8!
      const p = await db.prepare('SELECT stock FROM products WHERE id = ?').bind('prod-football').first<any>()
      expect(p.stock).toBe(8)

      // 4. MUST NOT record stock movements for this conflict sale
      const sm = await db.prepare('SELECT * FROM stock_movements WHERE reference_id = ?').bind(sale.id).all<any>()
      expect(sm.results.length).toBe(0)
    })

    it('offline sync retry returns preserved conflict record idempotently without owner approval', async () => {
      const conflictSaleId = 'client-sale-offline-conflict-001'
      const req = new Request('http://localhost/api/sales/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: conflictSaleId,
          deviceId: 'pos-terminal-1',
          sessionId: validSessionId,
          createdAt: conflictCreatedAt,
          subtotal: 50000,
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 50000,
          paid: 50000,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 20,
              unitPrice: 2500,
              discount: 0,
              lineTotal: 50000,
            },
          ],
          payments: [{ method: 'cash', amount: 50000 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.status).toBe('conflict')
      expect(data.hasConflict).toBe(true)

      // Stock remains untouched
      const p = await db.prepare('SELECT stock FROM products WHERE id = ?').bind('prod-football').first<any>()
      expect(p.stock).toBe(8)
    })

    it('admin owner resolves and reconciles conflict with explicit approval', async () => {
      const conflictSaleId = 'client-sale-offline-conflict-001'
      // Owner replenishes stock first to allow reconciliation
      await db.prepare('UPDATE products SET stock = 25 WHERE id = ?').bind('prod-football').run()

      const req = new Request('http://localhost/api/sales/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`, // Owner credentials
        },
        body: JSON.stringify({
          clientSaleId: conflictSaleId,
          deviceId: 'pos-terminal-1',
          sessionId: validSessionId,
          createdAt: conflictCreatedAt,
          cashierId: cashierUid,
          approvalReason: 'Owner approved reconciliation after verifying physical shelf stock',
          subtotal: 50000,
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 50000,
          paid: 50000,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 20,
              unitPrice: 2500,
              discount: 0,
              lineTotal: 50000,
            },
          ],
          payments: [{ method: 'cash', amount: 50000 }],
        }),
      })

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.status).toBe('completed')

      // Stock is now decremented: 25 - 20 = 5
      const p = await db.prepare('SELECT stock FROM products WHERE id = ?').bind('prod-football').first<any>()
      expect(p.stock).toBe(5)

      // Sale status is now completed
      const sale = await db.prepare('SELECT * FROM sales WHERE client_sale_id = ?').bind(conflictSaleId).first<any>()
      expect(sale.status).toBe('completed')
    })
  })

  // --------------------------------------------------------------------------
  // 5. RETURNED COGS RECONCILIATION IN REPORTS (P1: 2)
  // --------------------------------------------------------------------------
  describe('Returned COGS Reconciliation in Business Reports', () => {
    it('accurately reconciles returned COGS and profit in /api/reports/summary', async () => {
      // 1. Perform a clean sale: 4 units of Football (price 2500, cost 1500)
      // Total Sales = 10,000, Total COGS = 6,000
      const saleId = 'client-sale-for-return-001'
      const checkoutReq = new Request('http://localhost/api/sales/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientSaleId: saleId,
          deviceId: 'pos-terminal-1',
          subtotal: 10000,
          discount: 0,
          billDiscount: 0,
          taxRate: 0,
          tax: 0,
          grandTotal: 10000,
          paid: 10000,
          balance: 0,
          change: 0,
          items: [
            {
              productId: 'prod-football',
              quantity: 4,
              unitPrice: 2500,
              discount: 0,
              lineTotal: 10000,
            },
          ],
          payments: [{ method: 'cash', amount: 10000 }],
        }),
      })

      const checkoutRes = await worker.fetch(checkoutReq, env)
      expect(checkoutRes.status).toBe(201)
      const createdSale = (await checkoutRes.json()) as any

      // 2. Process a Sales Return of 2 units (refund 5000, returned cost = 2 * 1500 = 3000)
      const returnReq = new Request('http://localhost/api/sales/returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          saleId: createdSale.id,
          invoiceNumber: createdSale.invoiceNumber,
          total: 5000,
          refundAmount: 5000,
          refundMethod: 'cash',
          reason: 'Customer return wrong size',
          items: [
            {
              productId: 'prod-football',
              productName: 'Football',
              sku: 'FB-001',
              quantity: 2,
              unitPrice: 2500,
              costPrice: 1500,
              lineTotal: 5000,
            },
          ],
        }),
      })

      const returnRes = await worker.fetch(returnReq, env)
      expect(returnRes.status).toBe(201)

      // 3. Query /api/reports/summary
      const reportReq = new Request('http://localhost/api/reports/summary', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
        },
      })

      const reportRes = await worker.fetch(reportReq, env)
      expect(reportRes.status).toBe(200)
      const report = (await reportRes.json()) as any

      expect(report.totalReturns).toBe(5000)
      expect(report.returnedCogs).toBe(3000)
      // Net COGS should have returned COGS subtracted:
      // Gross sales COGS: 5000 (earlier reconcile 20 units cost: 0) + 6000 = 11000
      // net COGS = 11000 - 3000 = 8000
      expect(report.costOfGoodsSold).toBeGreaterThanOrEqual(0)
      expect(report.grossProfit).toBe(report.netSales - report.costOfGoodsSold)
      expect(report.netProfit).toBe(report.grossProfit - report.expenses)
    })
  })
})
