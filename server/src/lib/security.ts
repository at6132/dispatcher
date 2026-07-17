import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { rateLimit } from './redis.js';
import { sha256 } from './crypto.js';

/** True when load-test harness presents the configured bypass secret. */
export function isLoadTestRequest(request: FastifyRequest): boolean {
  const secret = env.LOAD_TEST_BYPASS_SECRET;
  if (!secret) return false;
  const header = request.headers['x-load-test'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value === secret;
}

export type RateLimitOpts = {
  /** Logical bucket, e.g. `login:ip` — full redis key is built for you */
  key: string;
  limit: number;
  windowSec: number;
  /** Auth endpoints should fail closed if Redis is down */
  failClosed?: boolean;
};

/**
 * Throws AppError(429) when over limit. Sets Retry-After when reply is passed.
 */
export async function assertRateLimit(
  opts: RateLimitOpts,
  reply?: FastifyReply,
): Promise<void> {
  const wait = await rateLimit({
    key: opts.key,
    limit: opts.limit,
    windowSec: opts.windowSec,
    failClosed: opts.failClosed,
  });
  if (wait == null) return;
  if (reply) {
    reply.header('Retry-After', Math.ceil(wait / 1000));
  }
  throw new AppError(429, 'Too many requests', 'rate_limited');
}

/** Per-IP + optional per-user buckets for authenticated mutation traffic. */
export async function assertClientLimits(
  request: FastifyRequest,
  reply: FastifyReply,
  buckets: {
    name: string;
    ipLimit: number;
    userLimit?: number;
    windowSec: number;
    failClosed?: boolean;
  },
): Promise<void> {
  // Load-test bots share one egress IP — skip IP bucket so capacity matches
  // real multi-IP traffic. Per-user ceilings still enforce realistic abuse caps.
  if (!isLoadTestRequest(request)) {
    await assertRateLimit(
      {
        key: `${buckets.name}:ip:${request.ip}`,
        limit: buckets.ipLimit,
        windowSec: buckets.windowSec,
        failClosed: buckets.failClosed,
      },
      reply,
    );
  }
  if (buckets.userLimit != null && request.user?.id) {
    await assertRateLimit(
      {
        key: `${buckets.name}:user:${request.user.id}`,
        limit: buckets.userLimit,
        windowSec: buckets.windowSec,
        failClosed: buckets.failClosed,
      },
      reply,
    );
  }
}

/** Reject non-JSON bodies on write endpoints (except empty logout). */
export function requireJsonContentType(request: FastifyRequest): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const ct = (request.headers['content-type'] ?? '').toLowerCase();
  // Allow empty body (Content-Length 0) without content-type
  const len = Number(request.headers['content-length'] ?? '0');
  if (!ct && (Number.isNaN(len) || len === 0) && !request.body) return;
  if (!ct.includes('application/json')) {
    throw new AppError(415, 'Content-Type must be application/json', 'unsupported_media');
  }
}

/** Stable short hash for rate-limiting opaque tokens without storing them. */
export function tokenBucketKey(prefix: string, token: string): string {
  return `${prefix}:${sha256(token).slice(0, 32)}`;
}

const SCAN_PATH =
  /(\.\.|\/etc\/|\/proc\/|wp-admin|phpmyadmin|\.env|\/\.git)/i;

/** Cheap probe rejection for common scanner paths before they hit routing. */
export function rejectScanPath(request: FastifyRequest): void {
  const url = request.url ?? '';
  if (SCAN_PATH.test(url)) {
    throw new AppError(404, 'Not found', 'not_found');
  }
}
