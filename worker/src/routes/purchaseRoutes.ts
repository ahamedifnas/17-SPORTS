import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, getNextSequence, recordAuditLog } from '../helpers';

interface PurchaseItemInput {
  productId: string;
  variantId?: string;
  productName: string;
  sku: string;
  quantity: number;
  costPrice: number;
  discount?: number;
  lineTotal: number;
}

interface PurchaseInput {
  id?: string;
  supplierId: string;
  supplierName: string;
  referenceNumber?: string;
  purchaseDate: string;
  paymentMethod: string;
  subtotal: number;
  discount?: number;
  tax?: number;
  grandTotal: number;
  status?: 'draft' | 'received';
  items: PurchaseItemInput[];
}

export async function handlePurchaseRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // GET /api/purchases
  if (path === '/api/purchases' && request.method === 'GET') {
    if (!user) return errorResponse('Unauthorized', 401);
    if (user.role === 'cashier') return errorResponse('Forbidden: Cashiers cannot view purchases', 403);

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const status = url.searchParams.get('status');

    let query = 'SELECT * FROM purchases';
    const params: unknown[] = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const purchasesRes = await env.DB.prepare(query).bind(...params).all();
    const purchases = purchasesRes.results as Record<string, unknown>[];

    // Fetch items for each purchase
    if (purchases.length > 0) {
      const pids = purchases.map((p) => p.id as string);
      const placeholders = pids.map(() => '?').join(',');
      const itemsRes = await env.DB.prepare(
        `SELECT * FROM purchase_items WHERE purchase_id IN (${placeholders})`
      ).bind(...pids).all();

      const itemsByPid: Record<string, unknown[]> = {};
      for (const item of itemsRes.results as Record<string, unknown>[]) {
        const pid = item.purchase_id as string;
        if (!itemsByPid[pid]) itemsByPid[pid] = [];
        itemsByPid[pid].push(item);
      }

      for (const p of purchases) {
        p.items = itemsByPid[p.id as string] || [];
      }
    }

    return jsonResponse(purchases);
  }

  // POST /api/purchases - Create purchase (draft or received)
  if (path === '/api/purchases' && request.method === 'POST') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);

    const body = (await request.json()) as PurchaseInput;
    if (!body.supplierId || !body.items || body.items.length === 0) {
      return errorResponse('Supplier and items are required');
    }

    const purchaseId = body.id || `po_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const purchaseNumber = await getNextSequence(env.DB, 'purchase', 'PO');
    const branchId = user.branch_id || 'main';
    const isReceived = body.status === 'received';

    const statements = [
      env.DB.prepare(
        `INSERT INTO purchases (
          id, branch_id, purchase_number, supplier_id, supplier_name, reference_number,
          purchase_date, payment_method, subtotal, discount, tax, grand_total, status,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(
        purchaseId,
        branchId,
        purchaseNumber,
        body.supplierId,
        body.supplierName,
        body.referenceNumber || null,
        body.purchaseDate || new Date().toISOString().split('T')[0],
        body.paymentMethod || 'credit',
        Math.round(body.subtotal),
        Math.round(body.discount || 0),
        Math.round(body.tax || 0),
        Math.round(body.grandTotal),
        body.status || 'draft',
        user.name || user.email
      ),
    ];

    for (const item of body.items) {
      const itemId = `pi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO purchase_items (
            id, purchase_id, product_id, variant_id, product_name, sku,
            quantity, cost_price, discount, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          itemId,
          purchaseId,
          item.productId,
          item.variantId || null,
          item.productName,
          item.sku,
          item.quantity,
          Math.round(item.costPrice),
          Math.round(item.discount || 0),
          Math.round(item.lineTotal)
        )
      );

      // If immediately received, increment stock and create stock movements
      if (isReceived) {
        if (item.variantId) {
          statements.push(
            env.DB.prepare(
              'UPDATE product_variants SET stock = stock + ?, buying_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(item.quantity, Math.round(item.costPrice), item.variantId)
          );
        } else {
          statements.push(
            env.DB.prepare(
              'UPDATE products SET stock = stock + ?, buying_price = ?, average_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(item.quantity, Math.round(item.costPrice), Math.round(item.costPrice), item.productId)
          );
        }

        const smId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        statements.push(
          env.DB.prepare(
            `INSERT INTO stock_movements (
              id, branch_id, product_id, variant_id, type, quantity,
              before_stock, after_stock, reference_id, reason, created_by, created_at
            ) VALUES (?, ?, ?, ?, 'purchase', ?, 0, ?, ?, 'Purchase Received', ?, CURRENT_TIMESTAMP)`
          ).bind(
            smId,
            branchId,
            item.productId,
            item.variantId || null,
            item.quantity,
            item.quantity,
            purchaseNumber,
            user.name || user.email
          )
        );
      }
    }

    // If received and payment method is credit, increment supplier's current_balance
    if (isReceived && (body.paymentMethod === 'credit' || !body.paymentMethod)) {
      statements.push(
        env.DB.prepare(
          'UPDATE suppliers SET current_balance = current_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(Math.round(body.grandTotal), body.supplierId)
      );
    }

    if (env.DB.batch) {
      await env.DB.batch(statements);
    } else {
      for (const s of statements) await s.run();
    }

    await recordAuditLog(
      env.DB,
      user,
      'purchases',
      'create_purchase',
      purchaseId,
      `Created purchase ${purchaseNumber} (${body.status || 'draft'}) for ${body.supplierName}`
    );

    return jsonResponse({ id: purchaseId, purchaseNumber, success: true }, 201);
  }

  // POST /api/purchases/:id/receive - Receive draft purchase
  const recvMatch = path.match(/^\/api\/purchases\/([^/]+)\/receive$/);
  if (recvMatch && request.method === 'POST') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
    const purchaseId = recvMatch[1];

    const purchase = await env.DB
      .prepare('SELECT * FROM purchases WHERE id = ?')
      .bind(purchaseId)
      .first<{ id: string; status: string; purchase_number: string; supplier_id: string; grand_total: number; payment_method: string }>();

    if (!purchase) return errorResponse('Purchase not found', 404);
    if (purchase.status === 'received') return errorResponse('Purchase already received', 400);

    const items = await env.DB
      .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
      .bind(purchaseId)
      .all<{ product_id: string; variant_id?: string; quantity: number; cost_price: number }>();

    const statements = [
      env.DB.prepare("UPDATE purchases SET status = 'received', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(purchaseId),
    ];

    for (const item of items.results) {
      if (item.variant_id) {
        statements.push(
          env.DB.prepare(
            'UPDATE product_variants SET stock = stock + ?, buying_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).bind(item.quantity, item.cost_price, item.variant_id)
        );
      } else {
        statements.push(
          env.DB.prepare(
            'UPDATE products SET stock = stock + ?, buying_price = ?, average_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).bind(item.quantity, item.cost_price, item.cost_price, item.product_id)
        );
      }

      const smId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO stock_movements (
            id, branch_id, product_id, variant_id, type, quantity,
            before_stock, after_stock, reference_id, reason, created_by, created_at
          ) VALUES (?, 'main', ?, ?, 'purchase', ?, 0, ?, ?, 'Draft Purchase Received', ?, CURRENT_TIMESTAMP)`
        ).bind(
          smId,
          item.product_id,
          item.variant_id || null,
          item.quantity,
          item.quantity,
          purchase.purchase_number,
          user.name || user.email
        )
      );
    }

    if (purchase.payment_method === 'credit') {
      statements.push(
        env.DB.prepare(
          'UPDATE suppliers SET current_balance = current_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(purchase.grand_total, purchase.supplier_id)
      );
    }

    if (env.DB.batch) {
      await env.DB.batch(statements);
    } else {
      for (const s of statements) await s.run();
    }

    await recordAuditLog(env.DB, user, 'purchases', 'receive_purchase', purchaseId, `Received purchase ${purchase.purchase_number}`);
    return jsonResponse({ success: true, id: purchaseId });
  }

  // POST /api/purchases/returns - Purchase return
  if (path === '/api/purchases/returns' && request.method === 'POST') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
    const body = (await request.json()) as {
      purchaseId: string;
      purchaseNumber: string;
      supplierId: string;
      supplierName: string;
      productId: string;
      variantId?: string;
      quantity: number;
      amount: number;
      reason?: string;
    };

    if (!body.purchaseId || !body.productId || !body.quantity) {
      return errorResponse('Missing required return fields');
    }

    const returnNumber = await getNextSequence(env.DB, 'pret', 'PRET');
    const returnId = `pret_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const statements = [
      env.DB.prepare(
        `INSERT INTO purchase_returns (
          id, branch_id, return_number, purchase_id, purchase_number,
          supplier_id, supplier_name, product_id, variant_id, quantity,
          amount, reason, return_date, status, created_by, created_at
        ) VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'completed', ?, CURRENT_TIMESTAMP)`
      ).bind(
        returnId,
        returnNumber,
        body.purchaseId,
        body.purchaseNumber,
        body.supplierId,
        body.supplierName,
        body.productId,
        body.variantId || null,
        body.quantity,
        Math.round(body.amount),
        body.reason || 'Purchase Return',
        user.name || user.email
      ),
    ];

    // Deduct stock
    if (body.variantId) {
      statements.push(
        env.DB.prepare('UPDATE product_variants SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(body.quantity, body.variantId)
      );
    } else {
      statements.push(
        env.DB.prepare('UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(body.quantity, body.productId)
      );
    }

    // Ledger record
    const smId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    statements.push(
      env.DB.prepare(
        `INSERT INTO stock_movements (
          id, branch_id, product_id, variant_id, type, quantity,
          before_stock, after_stock, reference_id, reason, created_by, created_at
        ) VALUES (?, 'main', ?, ?, 'purchase_return', ?, 0, 0, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(
        smId,
        body.productId,
        body.variantId || null,
        -body.quantity,
        returnNumber,
        body.reason || 'Purchase Return',
        user.name || user.email
      )
    );

    // Credit supplier current_balance
    statements.push(
      env.DB.prepare(
        'UPDATE suppliers SET current_balance = current_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(Math.round(body.amount), body.supplierId)
    );

    if (env.DB.batch) {
      await env.DB.batch(statements);
    } else {
      for (const s of statements) await s.run();
    }

    await recordAuditLog(env.DB, user, 'purchases', 'purchase_return', returnId, `Completed purchase return ${returnNumber}`);
    return jsonResponse({ id: returnId, returnNumber, success: true }, 201);
  }

  return errorResponse('Not Found', 404);
}
