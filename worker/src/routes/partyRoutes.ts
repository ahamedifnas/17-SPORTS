import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, recordAuditLog } from '../helpers';

export async function handlePartyRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // --- CUSTOMERS ---
  if (path === '/api/customers') {
    if (request.method === 'GET') {
      const list = await env.DB.prepare('SELECT * FROM customers ORDER BY name ASC').all();
      return jsonResponse(list.results);
    }

    if (request.method === 'POST') {
      if (!user) return errorResponse('Unauthorized', 401);
      const body = (await request.json()) as {
        name: string;
        phone?: string;
        email?: string;
        address?: string;
        creditLimit?: number;
      };

      if (!body.name) return errorResponse('Customer name is required');
      const id = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const code = `CUST-${Date.now().toString().slice(-4)}`;

      await env.DB.prepare(
        `INSERT INTO customers (
          id, branch_id, code, name, phone, email, address,
          credit_limit, status, created_at, updated_at
        ) VALUES (?, 'main', ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(
        id,
        code,
        body.name,
        body.phone || null,
        body.email || null,
        body.address || null,
        Math.round(body.creditLimit || 0)
      ).run();

      await recordAuditLog(env.DB, user, 'customers', 'create_customer', id, `Created customer ${body.name}`);
      return jsonResponse({ id, code, name: body.name, success: true }, 201);
    }
  }

  const custMatch = path.match(/^\/api\/customers\/([^/]+)$/);
  if (custMatch && request.method === 'PUT') {
    if (!user) return errorResponse('Unauthorized', 401);
    const id = custMatch[1];
    const body = (await request.json()) as {
      name: string;
      phone?: string;
      email?: string;
      address?: string;
      creditLimit?: number;
      status?: string;
    };

    await env.DB.prepare(
      `UPDATE customers SET
        name = ?, phone = ?, email = ?, address = ?,
        credit_limit = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      body.name,
      body.phone || null,
      body.email || null,
      body.address || null,
      Math.round(body.creditLimit || 0),
      body.status || 'active',
      id
    ).run();

    return jsonResponse({ id, success: true });
  }

  // --- SUPPLIERS ---
  if (path === '/api/suppliers') {
    if (request.method === 'GET') {
      const list = await env.DB.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
      return jsonResponse(list.results);
    }

    if (request.method === 'POST') {
      if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
      const body = (await request.json()) as {
        name: string;
        phone?: string;
        email?: string;
        address?: string;
      };

      if (!body.name) return errorResponse('Supplier name is required');
      const id = `supp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const code = `SUPP-${Date.now().toString().slice(-4)}`;

      await env.DB.prepare(
        `INSERT INTO suppliers (
          id, branch_id, code, name, phone, email, address,
          status, created_at, updated_at
        ) VALUES (?, 'main', ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(
        id,
        code,
        body.name,
        body.phone || null,
        body.email || null,
        body.address || null
      ).run();

      await recordAuditLog(env.DB, user, 'suppliers', 'create_supplier', id, `Created supplier ${body.name}`);
      return jsonResponse({ id, code, name: body.name, success: true }, 201);
    }
  }

  const suppMatch = path.match(/^\/api\/suppliers\/([^/]+)$/);
  if (suppMatch && request.method === 'PUT') {
    if (!user || user.role === 'cashier') return errorResponse('Forbidden', 403);
    const id = suppMatch[1];
    const body = (await request.json()) as {
      name: string;
      phone?: string;
      email?: string;
      address?: string;
      status?: string;
    };

    await env.DB.prepare(
      `UPDATE suppliers SET
        name = ?, phone = ?, email = ?, address = ?,
        status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      body.name,
      body.phone || null,
      body.email || null,
      body.address || null,
      body.status || 'active',
      id
    ).run();

    return jsonResponse({ id, success: true });
  }

  return errorResponse('Not Found', 404);
}
