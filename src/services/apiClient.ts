import { auth } from '@/firebase/config';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
export class ApiError extends Error { constructor(message:string,readonly status:number){super(message)} }

export async function getAuthToken(): Promise<string | null> {
  if (!auth?.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch (err) {
    console.warn('Failed to retrieve Firebase ID token:', err);
    return null;
  }
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `Request failed: ${response.status} ${response.statusText}`;
    try {
      const errJson = (await response.json()) as { error?: string };
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // Body not JSON
    }
    throw new ApiError(errorMsg,response.status);
  }

  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<T> => {
    let query = '';
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) searchParams.append(k, String(v));
      }
      const qs = searchParams.toString();
      if (qs) query = `?${qs}`;
    }
    return apiRequest<T>(`${path}${query}`, { method: 'GET' });
  },
  post: <T>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string): Promise<T> =>
    apiRequest<T>(path, { method: 'DELETE' }),
};
