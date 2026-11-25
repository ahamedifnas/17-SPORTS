import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, recordAuditLog } from '../helpers';

export async function handleAdminRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // --- SETTINGS ---
  if (path === '/api/settings') {
    if (request.method === 'GET') {
      const branchId = user?.branch_id || 'main';
      const settings = await env.DB
        .prepare('SELECT * FROM settings WHERE branch_id = ?')
        .bind(branchId)
        .first();

      return jsonResponse(
        settings || {
          branch_id: branchId,
          business_name: 'Z17 SPORTS',
          invoice_prefix: 'INV',
          currency: 'LKR',
          tax_enabled: 0,
          tax_rate: 0,
          paper_size: '80mm',
          require_manager_below_minimum: 0,
        }
      );
    }

    if (request.method === 'PUT') {
      if (!user || user.role !== 'admin') return errorResponse('Forbidden: Admin only', 403);
      const body = (await request.json()) as {
        business_name?: string;
        address?: string;
        phone?: string;
        email?: string;
        invoice_prefix?: string;
        currency?: string;
        tax_enabled?: boolean | number;
        tax_rate?: number;
        invoice_footer?: string;
        paper_size?: string;
        require_manager_below_minimum?: boolean | number;
      };

      const branchId = user.branch_id || 'main';

      await env.DB.prepare(
        `INSERT INTO settings (
          branch_id, business_name, address, phone, email, invoice_prefix,
          currency, tax_enabled, tax_rate, invoice_footer, paper_size,
          require_manager_below_minimum, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(branch_id) DO UPDATE SET
          business_name = excluded.business_name,
          address = excluded.address,
          phone = excluded.phone,
          email = excluded.email,
          invoice_prefix = excluded.invoice_prefix,
          currency = excluded.currency,
          tax_enabled = excluded.tax_enabled,
          tax_rate = excluded.tax_rate,
          invoice_footer = excluded.invoice_footer,
          paper_size = excluded.paper_size,
          require_manager_below_minimum = excluded.require_manager_below_minimum,
          updated_at = CURRENT_TIMESTAMP`
      ).bind(
        branchId,
        body.business_name || 'Z17 SPORTS',
        body.address || '',
        body.phone || '',
        body.email || '',
        body.invoice_prefix || 'INV',
        body.currency || 'LKR',
        body.tax_enabled ? 1 : 0,
        body.tax_rate || 0,
        body.invoice_footer || '',
        body.paper_size || '80mm',
        body.require_manager_below_minimum ? 1 : 0
      ).run();

      await recordAuditLog(env.DB, user, 'settings', 'update_settings', branchId, 'Updated store settings');
      return jsonResponse({ success: true });
    }
  }

  // --- STAFF (RBAC) ---
  if (path === '/api/staff') {
    if (!user || user.role !== 'admin') return errorResponse('Forbidden: Admin only', 403);

    if (request.method === 'GET') {
      const staffList = await env.DB
        .prepare('SELECT uid, email, name, phone, role, status, branch_id, created_at, updated_at FROM users ORDER BY name ASC')
        .all();
      return jsonResponse(staffList.results);
    }

    if (request.method === 'POST') {
      const body = (await request.json()) as {
        uid: string;
        email: string;
        name: string;
        phone?: string;
        role: string;
      };

      if (!body.uid || !body.email || !body.name || !body.role) {
        return errorResponse('uid, email, name, and role are required');
      }

      await env.DB.prepare(
        `INSERT INTO users (
          uid, email, name, phone, role, status, branch_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', 'main', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(uid) DO UPDATE SET
          name = excluded.name,
          phone = excluded.phone,
          role = excluded.role,
          status = 'active',
          updated_at = CURRENT_TIMESTAMP`
      ).bind(
        body.uid,
        body.email,
        body.name,
        body.phone || null,
        body.role
      ).run();

      await recordAuditLog(env.DB, user, 'staff', 'save_staff', body.uid, `Provisioned staff ${body.name} as ${body.role}`);
      return jsonResponse({ success: true, uid: body.uid }, 201);
    }
  }

  const staffMatch = path.match(/^\/api\/staff\/([^/]+)$/);
  if (staffMatch && request.method === 'PUT') {
    if (!user || user.role !== 'admin') return errorResponse('Forbidden: Admin only', 403);
    const targetUid = staffMatch[1];
    const body = (await request.json()) as {
      name?: string;
      phone?: string;
      role?: string;
      status?: 'active' | 'inactive';
    };

    await env.DB.prepare(
      `UPDATE users SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        role = COALESCE(?, role),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
       WHERE uid = ?`
    ).bind(
      body.name || null,
      body.phone || null,
      body.role || null,
      body.status || null,
      targetUid
    ).run();

    await recordAuditLog(env.DB, user, 'staff', 'update_staff', targetUid, `Updated staff profile ${targetUid}`);
    return jsonResponse({ success: true, uid: targetUid });
  }

  // --- AUDIT LOGS ---
  if (path === '/api/audit-logs' && request.method === 'GET') {
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      return errorResponse('Forbidden: Admin or Manager only', 403);
    }

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const module = url.searchParams.get('module');

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: unknown[] = [];
    if (module) {
      query += ' AND module = ?';
      params.push(module);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = await env.DB.prepare(query).bind(...params).all();
    return jsonResponse(logs.results);
  }

  return errorResponse('Not Found', 404);
}
