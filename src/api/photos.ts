import { logger } from '../debug/logger';
import { apiFetch, getApiBaseUrl } from './client';

type PresignResponse = {
  uploadId: string;
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
  maxBytes: number;
};

type ConfirmResponse = {
  objectKey: string;
  kind: 'self' | 'interior' | 'exterior';
};

const UPLOAD_TIMEOUT_MS = 25_000;

function guessContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * If uri is already remote/http or API unset, return undefined (skip key).
 * Otherwise presign → PUT → confirm and return object key.
 */
export async function uploadLocalPhotoIfNeeded(
  uri: string,
  kind: 'self' | 'interior' | 'exterior',
): Promise<string | undefined> {
  if (!uri) return undefined;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return undefined;
  if (!getApiBaseUrl()) return undefined;

  logger.info('photos', 'upload.start', { kind });
  try {
    const contentType = guessContentType(uri);
    const presign = await apiFetch<PresignResponse>('/v1/me/photos/presign', {
      method: 'POST',
      body: JSON.stringify({ kind, contentType }),
    });
    logger.debug('photos', 'presign.ok', {
      kind,
      uploadId: presign.uploadId,
    });

    const fileRes = await fetchWithTimeout(uri, undefined, UPLOAD_TIMEOUT_MS);
    const blob = await fileRes.blob();
    let put: Response;
    try {
      put = await fetchWithTimeout(
        presign.uploadUrl,
        {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: blob,
        },
        UPLOAD_TIMEOUT_MS,
      );
    } catch (err) {
      logger.warn('photos', 's3_put.network_error', {
        kind,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new Error('Photo upload failed');
    }
    if (!put.ok) {
      logger.warn('photos', 's3_put.http_error', {
        kind,
        status: put.status,
      });
      throw new Error('Photo upload failed');
    }

    const confirmed = await apiFetch<ConfirmResponse>('/v1/me/photos/confirm', {
      method: 'POST',
      body: JSON.stringify({ uploadId: presign.uploadId }),
    });
    logger.info('photos', 'upload.ok', {
      kind,
      objectKey: confirmed.objectKey,
    });
    return confirmed.objectKey;
  } catch (err) {
    // Photos are optional — never block onboarding if upload fails
    const code = (err as { code?: string; requestId?: string }).code;
    const requestId = (err as { requestId?: string }).requestId;
    logger.warn('photos', 'upload.skipped', {
      kind,
      code,
      requestId,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
