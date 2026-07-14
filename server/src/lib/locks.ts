import { randomBytes } from 'node:crypto';

import { AppError } from './errors.js';
import { getRedis } from './redis.js';

const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export async function acquireLock(
  name: string,
  ttlMs = 10_000,
): Promise<string | null> {
  const token = randomBytes(16).toString('hex');
  const key = `lock:${name}`;
  const ok = await getRedis().set(key, token, 'PX', ttlMs, 'NX');
  return ok === 'OK' ? token : null;
}

export async function releaseLock(name: string, token: string): Promise<void> {
  const key = `lock:${name}`;
  try {
    await getRedis().eval(RELEASE_LUA, 1, key, token);
  } catch (err) {
    console.error('[lock] release failed', name, err);
  }
}

/**
 * Cross-replica mutual exclusion. Postgres FOR UPDATE still required inside.
 * Fail-fast with 409 if another worker holds the lock (avoids stampedes).
 */
export async function withLock<T>(
  name: string,
  fn: () => Promise<T>,
  ttlMs = 15_000,
): Promise<T> {
  const token = await acquireLock(name, ttlMs);
  if (!token) {
    throw new AppError(
      409,
      'This action is already in progress. Try again.',
      'lock_busy',
    );
  }
  try {
    return await fn();
  } finally {
    await releaseLock(name, token);
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
