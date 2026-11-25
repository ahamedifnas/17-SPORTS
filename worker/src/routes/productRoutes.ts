import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, recordAuditLog } from '../helpers';

interface VariantInput {
  id?: string;
  sku: string;
  barcode?: string;
  size?: string;
  color?: string;
  buying_price?: number;
  selling_price: number;
  stock?: number;
  minimum_stock?: number;
  status?: string;
}

interface ProductInput {
  id?: string;
  name: string;
  sku: string;
  barcode?: string;
  category_id?: string;
  brand_id?: string;
  description?: string;
  image_url?: string;
  unit?: string;
  buying_price?: number;
  average_cost?: number;
  selling_price: number;
  wholesale_price?: number;
  minimum_selling_price?: number;
  stock?: number;
  minimum_stock?: number;
  status?: string;
  variants?: VariantInput[];
}

export async function handleProductRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // GET /api/products - Full listing for management
  if (path === '/api/products' && request.method === 'GET') {
    if (!user) return errorResponse('Unauthorized', 401);

    const isCashier = user.role === 'cashier';
    const productsRes = await env.DB.prepare(
      `SELECT * FROM products ORDER BY updated_at DESC LIMIT 500`
    ).all();

    const variantsRes = await env.DB.prepare(
      `SELECT * FROM product_variants ORDER BY id ASC`
    ).all();

    const variantsByProduct: Record<string, unknown[]> = {};
    for (const v of variantsRes.results as Record<string, unknown>[]) {
      const pid = v.product_id as string;
      if (!variantsByProduct[pid]) variantsByProduct[pid] = [];
      variantsByProduct[pid].push(
        isCashier ? { ...v, buying_price: 0 } : v
      );
    }

    const items = (productsRes.results as Record<string, unknown>[]).map((p) => ({
      ...p,
      buying_price: isCashier ? 0 : p.buying_price,
      average_cost: isCashier ? 0 : p.average_cost,
      variants: variantsByProduct[p.id as string] || [],
    }));

    return jsonResponse(items);
  }

  // POST /api/products - Create product with variants
  if (path === '/api/products' && request.method === 'POST') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);

    const body = (await request.json()) as ProductInput;
    if (!body.name || !body.sku || body.selling_price === undefined) {
      return errorResponse('Missing required fields (name, sku, selling_price)');
    }

    const productId = body.id || `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const branchId = user.branch_id || 'main';

    const statements = [
      env.DB.prepare(
        `INSERT INTO products (
          id, branch_id, name, sku, barcode, category_id, brand_id, description,
          image_url, unit, buying_price, average_cost, selling_price,
          wholesale_price, minimum_selling_price, stock, minimum_stock, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(
        productId,
        branchId,
        body.name,
        body.sku,
        body.barcode || null,
        body.category_id || null,
        body.brand_id || null,
        body.description || null,
        body.image_url || null,
        body.unit || 'pcs',
        Math.round(body.buying_price || 0),
        Math.round(body.average_cost || body.buying_price || 0),
        Math.round(body.selling_price),
        Math.round(body.wholesale_price || body.selling_price),
        Math.round(body.minimum_selling_price || 0),
        body.stock || 0,
        body.minimum_stock ?? 5,
        body.status || 'active'
      ),
    ];

    if (body.variants && Array.isArray(body.variants)) {
      for (const v of body.variants) {
        const variantId = v.id || `var_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        statements.push(
          env.DB.prepare(
            `INSERT INTO product_variants (
              id, product_id, sku, barcode, size, color, buying_price,
              selling_price, stock, minimum_stock, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          ).bind(
            variantId,
            productId,
            v.sku,
            v.barcode || null,
            v.size || null,
            v.color || null,
            Math.round(v.buying_price || body.buying_price || 0),
            Math.round(v.selling_price),
            v.stock || 0,
            v.minimum_stock ?? 2,
            v.status || 'active'
          )
        );
      }
    }

    if (statements.length > 1 && env.DB.batch) {
      await env.DB.batch(statements);
    } else {
      for (const stmt of statements) {
        await stmt.run();
      }
    }

    await recordAuditLog(
      env.DB,
      user,
      'products',
      'create_product',
      productId,
      `Created product ${body.name} (${body.sku}) with ${body.variants?.length || 0} variants`
    );

    return jsonResponse({ id: productId, success: true }, 201);
  }

  // POST /api/products/:id/archive
  const archiveMatch = path.match(/^\/api\/products\/([^/]+)\/archive$/);
  if (archiveMatch && request.method === 'POST') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
    const productId = archiveMatch[1];

    await env.DB
      .prepare(`UPDATE products SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(productId)
      .run();

    await env.DB
      .prepare(`UPDATE product_variants SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE product_id = ?`)
      .bind(productId)
      .run();

    await recordAuditLog(env.DB, user, 'products', 'archive_product', productId, `Archived product ${productId}`);
    return jsonResponse({ success: true, id: productId });
  }

  // PUT /api/products/:id
  const putMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (putMatch && request.method === 'PUT') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
    const productId = putMatch[1];
    const body = (await request.json()) as ProductInput;

    await env.DB.prepare(
      `UPDATE products SET
        name = ?, barcode = ?, category_id = ?, brand_id = ?, description = ?,
        image_url = ?, unit = ?, buying_price = ?, average_cost = ?,
        selling_price = ?, wholesale_price = ?, minimum_selling_price = ?,
        minimum_stock = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      body.name,
      body.barcode || null,
      body.category_id || null,
      body.brand_id || null,
      body.description || null,
      body.image_url || null,
      body.unit || 'pcs',
      Math.round(body.buying_price || 0),
      Math.round(body.average_cost || body.buying_price || 0),
      Math.round(body.selling_price),
      Math.round(body.wholesale_price || body.selling_price),
      Math.round(body.minimum_selling_price || 0),
      body.minimum_stock ?? 5,
      body.status || 'active',
      productId
    ).run();

    // Replace or sync variants if provided
    if (body.variants && Array.isArray(body.variants)) {
      for (const v of body.variants) {
        if (v.id) {
          await env.DB.prepare(
            `UPDATE product_variants SET
              sku = ?, barcode = ?, size = ?, color = ?, buying_price = ?,
              selling_price = ?, minimum_stock = ?, status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND product_id = ?`
          ).bind(
            v.sku,
            v.barcode || null,
            v.size || null,
            v.color || null,
            Math.round(v.buying_price || 0),
            Math.round(v.selling_price),
            v.minimum_stock ?? 2,
            v.status || 'active',
            v.id,
            productId
          ).run();
        } else {
          const newVarId = `var_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          await env.DB.prepare(
            `INSERT INTO product_variants (
              id, product_id, sku, barcode, size, color, buying_price,
              selling_price, stock, minimum_stock, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          ).bind(
            newVarId,
            productId,
            v.sku,
            v.barcode || null,
            v.size || null,
            v.color || null,
            Math.round(v.buying_price || 0),
            Math.round(v.selling_price),
            v.minimum_stock ?? 2
          ).run();
        }
      }
    }

    await recordAuditLog(env.DB, user, 'products', 'update_product', productId, `Updated product ${body.name}`);
    return jsonResponse({ success: true, id: productId });
  }

  // DELETE /api/products/:id - Soft-delete / archive product
  const deleteMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (deleteMatch && request.method === 'DELETE') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
    const productId = deleteMatch[1];
    await env.DB.prepare("UPDATE products SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(productId).run();
    await recordAuditLog(env.DB, user, 'products', 'archive_product', productId, `Archived product ${productId}`);
    return jsonResponse({ success: true, id: productId });
  }

  return errorResponse('Not Found', 404);
}
