import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, recordAuditLog } from '../helpers';

interface AdjustStockInput {
  productId: string;
  variantId?: string;
  type: 'adjustment' | 'initial';
  quantity: number; // positive to increase, negative to decrease
  reason?: string;
}

export async function handleInventoryRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // GET /api/inventory/movements - Query stock movements ledger
  if (path === '/api/inventory/movements' && request.method === 'GET') {
    if (!user) return errorResponse('Unauthorized', 401);

    const productId = url.searchParams.get('productId');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    let query = `SELECT sm.*, p.name as product_name, p.sku as product_sku
                 FROM stock_movements sm
                 JOIN products p ON sm.product_id = p.id`;
    const params: unknown[] = [];

    if (productId) {
      query += ` WHERE sm.product_id = ?`;
      params.push(productId);
    }

    query += ` ORDER BY sm.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const movements = await env.DB.prepare(query).bind(...params).all();
    return jsonResponse(movements.results);
  }

  // POST /api/inventory/adjust - Stock adjustment with ledger record
  if (path === '/api/inventory/adjust' && request.method === 'POST') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);

    const body = (await request.json()) as AdjustStockInput;
    if (!body.productId || body.quantity === undefined || body.quantity === 0) {
      return errorResponse('Valid productId and non-zero quantity required');
    }

    const branchId = user.branch_id || 'main';

    if (body.variantId) {
      const variant = await env.DB
        .prepare('SELECT id, stock FROM product_variants WHERE id = ? AND product_id = ?')
        .bind(body.variantId, body.productId)
        .first<{ id: string; stock: number }>();

      if (!variant) return errorResponse('Variant not found', 404);

      const beforeStock = variant.stock;
      const afterStock = beforeStock + body.quantity;
      if (afterStock < 0) {
        return errorResponse(`Cannot reduce variant stock below 0. Current stock: ${beforeStock}`);
      }

      const movementId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const statements = [
        env.DB.prepare('UPDATE product_variants SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(afterStock, body.variantId),
        env.DB.prepare(
          `INSERT INTO stock_movements (
            id, branch_id, product_id, variant_id, type, quantity,
            before_stock, after_stock, reason, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(
          movementId,
          branchId,
          body.productId,
          body.variantId,
          body.type || 'adjustment',
          body.quantity,
          beforeStock,
          afterStock,
          body.reason || 'Manual Adjustment',
          user.name || user.email
        ),
      ];

      if (env.DB.batch) {
        await env.DB.batch(statements);
      } else {
        for (const s of statements) await s.run();
      }

      await recordAuditLog(
        env.DB,
        user,
        'inventory',
        'adjust_stock',
        body.variantId,
        `Adjusted variant stock by ${body.quantity} (before: ${beforeStock}, after: ${afterStock})`
      );

      return jsonResponse({ success: true, afterStock });
    } else {
      const product = await env.DB
        .prepare('SELECT id, stock FROM products WHERE id = ?')
        .bind(body.productId)
        .first<{ id: string; stock: number }>();

      if (!product) return errorResponse('Product not found', 404);

      const beforeStock = product.stock;
      const afterStock = beforeStock + body.quantity;
      if (afterStock < 0) {
        return errorResponse(`Cannot reduce product stock below 0. Current stock: ${beforeStock}`);
      }

      const movementId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const statements = [
        env.DB.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(afterStock, body.productId),
        env.DB.prepare(
          `INSERT INTO stock_movements (
            id, branch_id, product_id, variant_id, type, quantity,
            before_stock, after_stock, reason, created_by, created_at
          ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(
          movementId,
          branchId,
          body.productId,
          body.type || 'adjustment',
          body.quantity,
          beforeStock,
          afterStock,
          body.reason || 'Manual Adjustment',
          user.name || user.email
        ),
      ];

      if (env.DB.batch) {
        await env.DB.batch(statements);
      } else {
        for (const s of statements) await s.run();
      }

      await recordAuditLog(
        env.DB,
        user,
        'inventory',
        'adjust_stock',
        body.productId,
        `Adjusted product stock by ${body.quantity} (before: ${beforeStock}, after: ${afterStock})`
      );

      return jsonResponse({ success: true, afterStock });
    }
  }

  return errorResponse('Not Found', 404);
}
