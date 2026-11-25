import { checkout } from '../checkout'
import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, getNextSequence, recordAuditLog } from '../helpers';

export async function handleSaleRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // GET /api/sales - Sales history list
  if (path === '/api/sales' && request.method === 'GET') {
    if (!user) return errorResponse('Unauthorized', 401);

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const cashierId = url.searchParams.get('cashierId');
    const status = url.searchParams.get('status');

    let query = 'SELECT * FROM sales WHERE 1=1';
    const params: unknown[] = [];

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate + ' 23:59:59');
    }
    if (cashierId) {
      query += ' AND cashier_id = ?';
      params.push(cashierId);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const salesRes = await env.DB.prepare(query).bind(...params).all();
    const sales = salesRes.results as Record<string, unknown>[];

    // Mask cost and gross_profit for cashiers
    const isCashier = user.role === 'cashier';
    for (const s of sales) {
      if (isCashier) {
        delete s.cost;
        delete s.gross_profit;
      }
    }

    return jsonResponse(sales);
  }

  if (
    request.method === 'POST' &&
    (path === '/api/sales' || path === '/api/sales/checkout' || path === '/api/sales/sync' || path === '/api/sales/offline-sync')
  ) {
    return checkout(request, env, user, path.endsWith('/sync') || path.endsWith('/offline-sync'));
  }

  // POST /api/sales/:id/void - Void a sale
  const voidMatch = path.match(/^\/api\/sales\/([^/]+)\/void$/);
  if (voidMatch && request.method === 'POST') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden: Only Manager/Admin can void sales', 403);
    const saleId = voidMatch[1];

    const sale = await env.DB
      .prepare('SELECT * FROM sales WHERE id = ?')
      .bind(saleId)
      .first<{ id: string; status: string; invoice_number: string }>();

    if (!sale) return errorResponse('Sale not found', 404);
    if (sale.status === 'voided') return errorResponse('Sale is already voided', 400);

    const items = await env.DB
      .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
      .bind(saleId)
      .all<{ product_id: string; variant_id?: string; quantity: number }>();

    const statements = [
      env.DB.prepare("UPDATE sales SET status = 'voided' WHERE id = ?").bind(saleId),
    ];

    // Restore stock
    for (const item of items.results) {
      if (item.variant_id) {
        statements.push(
          env.DB.prepare('UPDATE product_variants SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(item.quantity, item.variant_id)
        );
      } else {
        statements.push(
          env.DB.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(item.quantity, item.product_id)
        );
      }

      const smId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO stock_movements (
            id, branch_id, product_id, variant_id, type, quantity,
            before_stock, after_stock, reference_id, reason, created_by, created_at
          ) VALUES (?, 'main', ?, ?, 'sale_return', ?, 0, 0, ?, 'Voided Sale', ?, CURRENT_TIMESTAMP)`
        ).bind(
          smId,
          item.product_id,
          item.variant_id || null,
          item.quantity,
          sale.invoice_number,
          user.name || user.email
        )
      );
    }

    if (env.DB.batch) {
      await env.DB.batch(statements);
    } else {
      for (const s of statements) await s.run();
    }

    await recordAuditLog(env.DB, user, 'sales', 'void_sale', saleId, `Voided sale ${sale.invoice_number}`);
    return jsonResponse({ success: true, id: saleId });
  }

  // GET /api/sales/returns - List sales returns
  if (path === '/api/sales/returns' && request.method === 'GET') {
    if (!user) return errorResponse('Unauthorized', 401);
    const returns = await env.DB.prepare('SELECT * FROM sales_returns ORDER BY return_date DESC, created_at DESC LIMIT 200').all();
    return jsonResponse(returns.results);
  }

  // POST /api/sales/returns - Complete sales return
  if (path === '/api/sales/returns' && request.method === 'POST') {
    if (!user) return errorResponse('Unauthorized', 401);

    const body = (await request.json()) as {
      saleId: string;
      invoiceNumber: string;
      customerId?: string;
      customerName?: string;
      total: number;
      refundAmount: number;
      refundMethod: string;
      reason?: string;
      items: {
        productId: string;
        variantId?: string;
        productName: string;
        sku: string;
        quantity: number;
        unitPrice: number;
        costPrice?: number;
        lineTotal: number;
      }[];
    };

    if (!body.saleId || !body.items || body.items.length === 0) {
      return errorResponse('Sale ID and returned items are required');
    }

    const returnNumber = await getNextSequence(env.DB, 'sret', 'SRET');
    const returnId = `sret_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const statements = [
      env.DB.prepare(
        `INSERT INTO sales_returns (
          id, branch_id, return_number, sale_id, invoice_number,
          customer_id, customer_name, total, refund_amount, refund_method,
          reason, return_date, status, created_by, created_at
        ) VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'completed', ?, CURRENT_TIMESTAMP)`
      ).bind(
        returnId,
        returnNumber,
        body.saleId,
        body.invoiceNumber,
        body.customerId || null,
        body.customerName || null,
        Math.round(body.total),
        Math.round(body.refundAmount),
        body.refundMethod || 'cash',
        body.reason || 'Sales Return',
        user.name || user.email
      ),
    ];

    // Restore stock and record returned items
    for (const item of body.items) {
      const sriId = `sri_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO sales_return_items (
            id, return_id, product_id, variant_id, product_name, sku,
            quantity, unit_price, cost_price, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          sriId,
          returnId,
          item.productId,
          item.variantId || null,
          item.productName,
          item.sku,
          item.quantity,
          Math.round(item.unitPrice),
          Math.round(item.costPrice || 0),
          Math.round(item.lineTotal)
        )
      );

      if (item.variantId) {
        statements.push(
          env.DB.prepare('UPDATE product_variants SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(item.quantity, item.variantId)
        );
      } else {
        statements.push(
          env.DB.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(item.quantity, item.productId)
        );
      }

      // Update returned_quantity on original sale item
      statements.push(
        env.DB.prepare(
          'UPDATE sale_items SET returned_quantity = returned_quantity + ? WHERE sale_id = ? AND product_id = ?'
        ).bind(item.quantity, body.saleId, item.productId)
      );

      const smId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO stock_movements (
            id, branch_id, product_id, variant_id, type, quantity,
            before_stock, after_stock, reference_id, reason, created_by, created_at
          ) VALUES (?, 'main', ?, ?, 'sale_return', ?, 0, 0, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(
          smId,
          item.productId,
          item.variantId || null,
          item.quantity,
          returnNumber,
          body.reason || 'Sales Return',
          user.name || user.email
        )
      );
    }

    if (env.DB.batch) {
      await env.DB.batch(statements);
    } else {
      for (const s of statements) await s.run();
    }

    await recordAuditLog(env.DB, user, 'sales', 'sales_return', returnId, `Completed return ${returnNumber} for invoice ${body.invoiceNumber}`);
    return jsonResponse({ id: returnId, returnNumber, success: true }, 201);
  }

  return errorResponse('Not Found', 404);
}
