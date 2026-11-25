import { AuthUser, D1Database } from './types';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

export function errorResponse(message: string, status = 400, details: unknown = null): Response {
  return jsonResponse({ error: message, details }, status);
}

/**
 * Atomically increment and get the next sequential number formatted with year and padded sequence.
 * Example: INV-2026-000001
 */
export async function getNextSequence(
  db: D1Database,
  counterType: string,
  prefix: string,
  padLength = 6
): Promise<string> {
  const currentYear = new Date().getFullYear();
  const key = `${counterType}-${currentYear}`;

  try {
    // Attempt SQLite 3.35+ RETURNING statement
    const res = await db
      .prepare(
        `INSERT INTO counters (key, sequence, updated_at) 
         VALUES (?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET sequence = sequence + 1, updated_at = CURRENT_TIMESTAMP
         RETURNING sequence`
      )
      .bind(key)
      .first<{ sequence: number }>();

    const seq = res?.sequence ?? 1;
    return `${prefix}-${currentYear}-${String(seq).padStart(padLength, '0')}`;
  } catch {
    // Fallback if RETURNING clause is unsupported in older SQLite runtime
    await db
      .prepare(
        `INSERT INTO counters (key, sequence, updated_at) 
         VALUES (?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET sequence = sequence + 1, updated_at = CURRENT_TIMESTAMP`
      )
      .bind(key)
      .run();

    const row = await db
      .prepare('SELECT sequence FROM counters WHERE key = ?')
      .bind(key)
      .first<{ sequence: number }>();

    const seq = row?.sequence ?? 1;
    return `${prefix}-${currentYear}-${String(seq).padStart(padLength, '0')}`;
  }
}

/**
 * Record an immutable audit log entry.
 */
export async function recordAuditLog(
  db: D1Database,
  user: AuthUser,
  module: string,
  action: string,
  referenceId: string | null,
  description: string
): Promise<void> {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db
    .prepare(
      `INSERT INTO audit_logs (id, branch_id, user_id, user_name, action, module, reference_id, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      id,
      user.branch_id || 'main',
      user.uid,
      user.name || user.email,
      action,
      module,
      referenceId,
      description
    )
    .run();
}
