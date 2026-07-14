import { logger, newRequestId } from '../debug/logger';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokenStore';

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public requestId?: string,
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
  const requestId = newRequestId();
  logger.info('api', 'refresh.start', { requestId });
  try {
    const res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({ refreshToken }),
    });
    const serverRequestId = res.headers.get('x-request-id') ?? requestId;
    if (!res.ok) {
      logger.warn('api', 'refresh.fail', {
        requestId: serverRequestId,
        status: res.status,
      });
      await clearTokens();
      return false;
    }
    const data = (await res.json()) as TokenResponse;
    await setTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    logger.info('api', 'refresh.ok', { requestId: serverRequestId });
    return true;
  } catch (err) {
    logger.warn('api', 'refresh.network_error', {
      requestId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  if (!API_URL) {
    logger.error('api', 'no_api_url', { path });
    throw new ApiError(
      'API URL is not configured. Set EXPO_PUBLIC_API_URL.',
      0,
      'no_api_url',
    );
  }

  const requestId = newRequestId();
  const method = (init.method ?? 'GET').toUpperCase();
  const started = Date.now();

  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Request-Id', requestId);

  if (init.auth !== false) {
    const access = await getAccessToken();
    if (access) headers.set('Authorization', `Bearer ${access}`);
  }

  logger.debug('api', 'request', {
    requestId,
    method,
    path,
    auth: init.auth !== false,
    bodyBytes:
      typeof init.body === 'string' ? init.body.length : init.body ? 1 : 0,
  });

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (err) {
    logger.error('api', 'network_error', {
      requestId,
      method,
      path,
      ms: Date.now() - started,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new ApiError(
      'Can’t reach the server. Check your connection and try again.',
      0,
      'network_error',
      requestId,
    );
  }

  const serverRequestId = res.headers.get('x-request-id') ?? requestId;

  if (res.status === 401 && init.auth !== false && init.retry !== false) {
    logger.info('api', 'unauthorized_retry_refresh', {
      requestId: serverRequestId,
      path,
    });
    if (!refreshInFlight) {
      refreshInFlight = refreshSession().finally(() => {
        refreshInFlight = null;
      });
    }
    const ok = await refreshInFlight;
    if (ok) {
      return apiFetch<T>(path, { ...init, retry: false });
    }
  }

  if (res.status === 204) {
    logger.info('api', 'response', {
      requestId: serverRequestId,
      method,
      path,
      status: 204,
      ms: Date.now() - started,
    });
    return undefined as T;
  }

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
    const errObj = json as {
      error?: { message?: string; code?: string; requestId?: string };
    } | null;
    const code = errObj?.error?.code;
    logger.warn('api', 'response_error', {
      requestId: errObj?.error?.requestId ?? serverRequestId,
      method,
      path,
      status: res.status,
      code,
      message: errObj?.error?.message,
      ms: Date.now() - started,
    });
    throw new ApiError(
      errObj?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      code,
      errObj?.error?.requestId ?? serverRequestId,
    );
  }

  logger.info('api', 'response', {
    requestId: serverRequestId,
    method,
    path,
    status: res.status,
    ms: Date.now() - started,
  });

  return json as T;
}

export function getApiBaseUrl(): string {
  return API_URL;
}

export type { TokenResponse };
