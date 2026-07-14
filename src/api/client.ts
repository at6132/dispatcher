import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokenStore';

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

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

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: unknown;
};

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!API_URL) return false;
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await clearTokens();
      return false;
    }
    const data = (await res.json()) as TokenResponse;
    await setTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  if (!API_URL) {
    throw new ApiError(
      'API URL is not configured. Set EXPO_PUBLIC_API_URL.',
      0,
      'no_api_url',
    );
  }

  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (init.auth !== false) {
    const access = await getAccessToken();
    if (access) headers.set('Authorization', `Bearer ${access}`);
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401 && init.auth !== false && init.retry !== false) {
    if (!refreshInFlight) refreshInFlight = refreshSession().finally(() => {
      refreshInFlight = null;
    });
    const ok = await refreshInFlight;
    if (ok) {
      return apiFetch<T>(path, { ...init, retry: false });
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: { message: text } };
    }
  }

  if (!res.ok) {
    const errObj = json as { error?: { message?: string; code?: string } } | null;
    throw new ApiError(
      errObj?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      errObj?.error?.code,
    );
  }

  return json as T;
}

export function getApiBaseUrl(): string {
  return API_URL;
}

export type { TokenResponse };
