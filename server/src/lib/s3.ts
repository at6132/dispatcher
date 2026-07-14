import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

import { env } from '../config/env.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!env.s3Enabled) {
    throw new Error('Object storage is not configured');
  }
  if (!client) {
    client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: Boolean(env.S3_FORCE_PATH_STYLE),
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

export function isAllowedContentType(ct: string): boolean {
  return ALLOWED_TYPES.has(ct.toLowerCase());
}

export function maxPhotoBytes(): number {
  return MAX_BYTES;
}

export function buildObjectKey(userId: string, kind: string, ext: string): string {
  return `users/${userId}/${kind}/${randomUUID()}.${ext}`;
}

export function extForContentType(ct: string): string {
  switch (ct.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

export async function presignPut(input: {
  key: string;
  contentType: string;
}): Promise<{ uploadUrl: string; expiresIn: number }> {
  const expiresIn = 600;
  const url = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: MAX_BYTES,
    }),
    { expiresIn },
  );
  return { uploadUrl: url, expiresIn };
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function presignGet(key: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: 3600 },
  );
}

export function publicOrSignedPhotoUrl(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  // Client will call endpoint that returns signed URL; store key as opaque for now
  // but AuthUser shape expects URI — we resolve at read time in user mapper.
  return key.startsWith('http') ? key : undefined;
}
