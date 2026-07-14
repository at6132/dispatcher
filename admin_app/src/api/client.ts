const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const TOKEN_KEY = 'dispatcher_admin_token';
const EXPIRES_KEY = 'dispatcher_admin_expires';

export function getApiUrl(): string {
  return API_URL;
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, expiresAt?: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  if (expiresAt) sessionStorage.setItem(EXPIRES_KEY, expiresAt);
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_KEY);
}

export function isSessionPresent(): boolean {
  const token = getToken();
  if (!token) return false;
  const exp = sessionStorage.getItem(EXPIRES_KEY);
  if (exp && new Date(exp).getTime() < Date.now()) {
    clearSession();
    return false;
  }
  return true;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  if (!API_URL) {
    throw new ApiError('VITE_API_URL is not set', 0, 'no_api_url');
  }
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.auth !== false) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && init.auth !== false) {
    clearSession();
  }
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const data = (await res.json()) as {
        error?: { message?: string; code?: string };
      };
      message = data.error?.message ?? message;
      code = data.error?.code;
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function fmtDate(value?: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString();
}
