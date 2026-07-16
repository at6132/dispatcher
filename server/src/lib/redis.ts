import { Redis } from 'ioredis';

import { env } from '../config/env.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      // Don't block Fastify ready/listen on Redis connect.
      lazyConnect: true,
      connectTimeout: 10_000,
      retryStrategy: (times) => {
        if (times > 20) return null;
        return Math.min(times * 200, 2000);
      },
    });
    redis.on('error', (err: Error) => {
      console.error('[redis]', err.message);
    });
  }
  return redis;
}

/** Soft-connect Redis; never throw so the HTTP server can still bind. */
export async function ensureRedisConnected(): Promise<boolean> {
  try {
    const r = getRedis();
    if (r.status === 'wait' || r.status === 'end') {
      await r.connect();
    }
    const pong = await r.ping();
    return pong === 'PONG';
  } catch (err) {
    console.error(
      '[redis] connect failed',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

export async function checkRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    const pong = await r.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/** Sliding window rate limit. Returns remaining wait ms if limited, else null.
 * When Redis is down: failClosed → throws AppError(503); otherwise allow (open).
 */
export async function rateLimit(input: {
  key: string;
  limit: number;
  windowSec: number;
  failClosed?: boolean;
}): Promise<number | null> {
  try {
    const r = getRedis();
    const now = Date.now();
    const windowMs = input.windowSec * 1000;
    const redisKey = `rl:${input.key}`;
    const pipeline = r.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, now - windowMs);
    pipeline.zadd(redisKey, now, `${now}:${Math.random()}`);
    pipeline.zcard(redisKey);
    pipeline.pexpire(redisKey, windowMs);
    const results = await pipeline.exec();
    const count = Number(results?.[2]?.[1] ?? 0);
    if (count > input.limit) {
      const oldest = await r.zrange(redisKey, 0, 0, 'WITHSCORES');
      const oldestScore = Number(oldest[1] ?? now);
      return Math.max(windowMs - (now - oldestScore), 1000);
    }
    return null;
  } catch (err) {
    if (input.failClosed) {
      const { AppError } = await import('./errors.js');
      throw new AppError(
        503,
        'Service temporarily unavailable',
        'rate_limit_unavailable',
      );
    }
    console.error('[redis] rateLimit failed (open)', (err as Error).message);
    return null;
  }
}
