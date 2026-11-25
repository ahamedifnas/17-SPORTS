import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, recordAuditLog } from '../helpers';

interface CategoryRow {
  id: string;
  branch_id: string;
  name: string;
  description?: string;
}

interface BrandRow {
  id: string;
  branch_id: string;
  name: string;
  description?: string;
}

export async function handleCatalogRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // GET /api/catalog/pos - Fast catalog query for POS billing with Cashier Privacy Shield
  if (path === '/api/catalog/pos' && request.method === 'GET') {
    if (!user) return errorResponse('Unauthorized', 401);

    const isCashier = user.role === 'cashier';

    // Fetch active products
    const productQuery = `
      SELECT id, branch_id, name, sku, barcode, category_id, brand_id, description, image_url,
             unit, selling_price, wholesale_price, minimum_selling_price, stock, minimum_stock, status
             ${!isCashier ? ', buying_price, average_cost' : ''}
      FROM products
      WHERE status = 'active'
      ORDER BY name ASC
    `;
    const productsRes = await env.DB.prepare(productQuery).all();

    // Fetch active variants
    const variantQuery = `
      SELECT id, product_id, sku, barcode, size, color, selling_price, stock, minimum_stock, status
             ${!isCashier ? ', buying_price' : ''}
      FROM product_variants
      WHERE status = 'active'
      ORDER BY size ASC, color ASC
    `;
    const variantsRes = await env.DB.prepare(variantQuery).all();

    // Group variants by product_id
    const variantsByProduct: Record<string, unknown[]> = {};
    for (const v of variantsRes.results as Record<string, unknown>[]) {
      const pid = v.product_id as string;
      if (!variantsByProduct[pid]) variantsByProduct[pid] = [];
      variantsByProduct[pid].push(v);
    }

    const catalog = (productsRes.results as Record<string, unknown>[]).map((p) => ({
      ...p,
      // Strictly guarantee buying_price / average_cost are undefined or 0 for cashiers
      buying_price: isCashier ? 0 : p.buying_price,
      average_cost: isCashier ? 0 : p.average_cost,
      variants: variantsByProduct[p.id as string] || [],
    }));

    return jsonResponse({
      products: catalog,
      timestamp: new Date().toISOString(),
    });
  }

  // --- CATEGORIES ---
  if (path === '/api/categories') {
    if (request.method === 'GET') {
      const list = await env.DB.prepare('SELECT * FROM categories ORDER BY name ASC').all();
      return jsonResponse(list.results);
    }

    if (request.method === 'POST') {
      if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
      const body = (await request.json()) as Partial<CategoryRow>;
      if (!body.name) return errorResponse('Name is required');

      const id = body.id || `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await env.DB
        .prepare('INSERT INTO categories (id, branch_id, name, description) VALUES (?, ?, ?, ?)')
        .bind(id, user.branch_id || 'main', body.name, body.description || '')
        .run();

      await recordAuditLog(env.DB, user, 'catalog', 'create_category', id, `Created category: ${body.name}`);
      return jsonResponse({ id, name: body.name, description: body.description }, 201);
    }
  }

  const catMatch = path.match(/^\/api\/categories\/([^/]+)$/);
  if (catMatch) {
    const id = catMatch[1];
    if (request.method === 'PUT') {
      if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
      const body = (await request.json()) as Partial<CategoryRow>;
      await env.DB
        .prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?')
        .bind(body.name, body.description || '', id)
        .run();
      return jsonResponse({ id, success: true });
    }

    if (request.method === 'DELETE') {
      if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
      await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
      return jsonResponse({ success: true });
    }
  }

  // --- BRANDS ---
  if (path === '/api/brands') {
    if (request.method === 'GET') {
      const list = await env.DB.prepare('SELECT * FROM brands ORDER BY name ASC').all();
      return jsonResponse(list.results);
    }

    if (request.method === 'POST') {
      if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
      const body = (await request.json()) as Partial<BrandRow>;
      if (!body.name) return errorResponse('Name is required');

      const id = body.id || `brand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await env.DB
        .prepare('INSERT INTO brands (id, branch_id, name, description) VALUES (?, ?, ?, ?)')
        .bind(id, user.branch_id || 'main', body.name, body.description || '')
        .run();

      await recordAuditLog(env.DB, user, 'catalog', 'create_brand', id, `Created brand: ${body.name}`);
      return jsonResponse({ id, name: body.name, description: body.description }, 201);
    }
  }

  const brandMatch = path.match(/^\/api\/brands\/([^/]+)$/);
  if (brandMatch) {
    const id = brandMatch[1];
    if (request.method === 'PUT') {
      if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
      const body = (await request.json()) as Partial<BrandRow>;
      await env.DB
        .prepare('UPDATE brands SET name = ?, description = ? WHERE id = ?')
        .bind(body.name, body.description || '', id)
        .run();
      return jsonResponse({ id, success: true });
    }

    if (request.method === 'DELETE') {
      if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
      await env.DB.prepare('DELETE FROM brands WHERE id = ?').bind(id).run();
      return jsonResponse({ success: true });
    }
  }

  return errorResponse('Not Found', 404);
}
