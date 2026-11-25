import { Env, AuthUser, UserRole } from './types';

interface JwkKey {
  kty: string;
  n: string;
  e: string;
  alg: string;
  use?: string;
  kid: string;
}

interface JwksResponse {
  keys: JwkKey[];
}

let cachedJwks: { keys: JwkKey[]; expiresAt: number } | null = null;

function base64UrlToUint8Array(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Fetch and cache Google's public JWKS for Firebase Auth token verification.
 */
async function getGoogleJwks(): Promise<JwkKey[]> {
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  try {
    const res = await fetch(
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch JWKS: ${res.status}`);
    }
    const data = (await res.json()) as JwksResponse;
    cachedJwks = {
      keys: data.keys || [],
      // Cache for 1 hour
      expiresAt: now + 3600 * 1000,
    };
    return cachedJwks.keys;
  } catch (err) {
    console.error('Error fetching Google JWKS:', err);
    if (cachedJwks) return cachedJwks.keys;
    throw err;
  }
}

export interface VerifiedFirebaseToken {
  uid: string;
  email?: string;
  name?: string;
}

/**
 * Pure Web Crypto RS256 JWT verifier for Firebase Auth.
 * Zero external dependencies. Works on Cloudflare Edge and modern runtimes.
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  _environment = 'production'
): Promise<VerifiedFirebaseToken> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const headerJson = new TextDecoder().decode(base64UrlToUint8Array(headerB64));
  const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadB64));

  const header = JSON.parse(headerJson) as { alg: string; kid?: string };
  const payload = JSON.parse(payloadJson) as {
    sub?: string;
    aud?: string;
    iss?: string;
    exp?: number;
    auth_time?: number;
    email?: string;
    name?: string;
  };

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }

  if (!header.kid) {
    throw new Error('Missing kid in JWT header');
  }

  // Claim verifications
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp! <= nowSeconds) {
    throw new Error('Token has expired');
  }

  if (payload.aud !== projectId) {
    throw new Error(`Token audience mismatch. Expected ${projectId}, got ${payload.aud}`);
  }

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error(`Token issuer mismatch: ${payload.iss}`);
  }

  if (!payload.sub) {
    throw new Error('Token missing sub (uid)');
  }

  // In test environment, skip remote Google JWKS fetching
  if (_environment === 'test') {
    return {
      uid: payload.sub,
      email: payload.email,
      name: payload.name,
    };
  }

  // Cryptographic signature verification using Web Crypto API
  const keys = await getGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(`No matching public key found for kid: ${header.kid}`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    false,
    ['verify']
  );

  const signatureBytes = base64UrlToUint8Array(signatureB64);
  const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureBytes,
    dataBytes
  );

  if (!isValid) {
    throw new Error('Invalid JWT cryptographic signature');
  }

  return {
    uid: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}

/**
 * Authenticate incoming request and load authoritative user from D1 database.
 */
export async function authenticate(
  request: Request,
  env: Env
): Promise<AuthUser | null> {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  if (!token) return null;

  try {
    const verified = await verifyFirebaseIdToken(
      token,
      env.FIREBASE_PROJECT_ID || 'z17-sports',
      env.ENVIRONMENT
    );

    const userRow = await env.DB
      .prepare('SELECT uid, email, name, phone, role, status, branch_id FROM users WHERE uid = ?')
      .bind(verified.uid)
      .first<AuthUser>();

    if (!userRow) {
      return null;
    }

    if (userRow.status !== 'active') {
      return null;
    }

    return userRow;
  } catch (err) {
    console.error('Edge auth error:', err);
    return null;
  }
}

/**
 * Enforce minimum role access.
 */
export function requireRole(user: AuthUser, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(user.role);
}
