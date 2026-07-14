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

function guessContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
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

  try {
    const contentType = guessContentType(uri);
    const presign = await apiFetch<PresignResponse>('/v1/me/photos/presign', {
      method: 'POST',
      body: JSON.stringify({ kind, contentType }),
    });

    const fileRes = await fetch(uri);
    const blob = await fileRes.blob();
    const put = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
    if (!put.ok) {
      throw new Error('Photo upload failed');
    }

    const confirmed = await apiFetch<ConfirmResponse>('/v1/me/photos/confirm', {
      method: 'POST',
      body: JSON.stringify({ uploadId: presign.uploadId }),
    });
    return confirmed.objectKey;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Allow onboarding without photos if storage isn't configured yet
    if (code === 's3_disabled') return undefined;
    throw err;
  }
}
