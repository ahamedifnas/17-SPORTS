import { assertChanged } from '../checkout'
import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, recordAuditLog } from '../helpers';
import { verifyFirebaseIdToken } from '../auth';

export async function handleAuthRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // GET /api/auth/me - Return current user & store settings
  if (path === '/api/auth/me' && request.method === 'GET') {
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const settings = await env.DB
      .prepare('SELECT * FROM settings WHERE branch_id = ?')
      .bind(user.branch_id || 'main')
      .first();

    return jsonResponse({
      user,
      settings: settings || {
        branch_id: user.branch_id || 'main',
        business_name: 'Z17 SPORTS',
        invoice_prefix: 'INV',
        currency: 'LKR',
        tax_enabled: 0,
        tax_rate: 0,
        paper_size: '80mm',
        require_manager_below_minimum: 0,
      },
    });
  }

  // POST /api/auth/offline-session - Cashier starts authorized offline shift
  if (path === '/api/auth/offline-session' && request.method === 'POST') {
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const body = (await request.json().catch(() => ({}))) as { deviceId?: string };
    if(!['admin','manager','cashier'].includes(user.role)||user.status!=='active')return errorResponse('Forbidden',403);
    if(!body.deviceId||!/^[\w-]{1,128}$/.test(body.deviceId))return errorResponse('Valid deviceId required');
    const deviceId = body.deviceId;
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 12 * 3600 * 1000).toISOString();

    await env.DB
      .prepare(
        `INSERT INTO offline_sessions (id, uid, device_id, branch_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(sessionId, user.uid, deviceId, user.branch_id || 'main', expiresAt)
      .run();

    await recordAuditLog(
      env.DB,
      user,
      'auth',
      'begin_offline_session',
      sessionId,
      `User ${user.name} initialized offline session for device ${deviceId}`
    );

    return jsonResponse({
      sessionId,
      uid: user.uid,
      deviceId,
      branchId: user.branch_id || 'main',
      expiresAt,
    });
  }

  // POST /api/auth/bootstrap - First-time owner setup
  if (path === '/api/auth/bootstrap' && request.method === 'POST') {
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Missing Authorization token', 401);
    }
    const token = authHeader.substring(7).trim();

    let verified;
    try {
      verified = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID || 'z17-sports', env.ENVIRONMENT);
    } catch {
      return errorResponse('Invalid Firebase token', 401);
    }

    const body = await request.json().catch(()=>({})) as {secret?:string;name?:string;phone?:string};
    if(!env.BOOTSTRAP_SECRET||!env.BOOTSTRAP_OWNER_UID||verified.uid!==env.BOOTSTRAP_OWNER_UID||body.secret!==env.BOOTSTRAP_SECRET)return errorResponse('Trusted owner provisioning is required.',403);
    const name=body.name||verified.name||'Owner',email=verified.email;
    if(!email)return errorResponse('Owner token must include an email.',403);
    const guard=crypto.randomUUID();
    try {await env.DB.batch([
      env.DB.prepare("INSERT INTO owner_provisioning(id,uid) SELECT 1,? WHERE NOT EXISTS(SELECT 1 FROM users WHERE role='admin')").bind(verified.uid),
      assertChanged(env.DB,guard),
      env.DB.prepare("INSERT INTO users(uid,email,name,phone,role,status,branch_id) VALUES(?,?,?,?,'admin','active','main')").bind(verified.uid,email,name,body.phone||''),
      env.DB.prepare("INSERT OR IGNORE INTO settings(branch_id,business_name) VALUES('main','Z17 SPORTS')"),
      env.DB.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard),
    ])}catch(error){if(/constraint/i.test(String(error)))return errorResponse('Owner provisioning has already been consumed or an owner exists.',409);throw error}

    return jsonResponse({
      success: true,
      message: 'Owner successfully provisioned',
      user: {
        uid: verified.uid,
        email,
        name,
        role: 'admin',
        status: 'active',
        branch_id: 'main',
      },
    });
  }

  return errorResponse('Not Found', 404);
}
