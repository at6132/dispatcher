import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { balances, users } from '../db/schema.js';
import { getRedis } from '../lib/redis.js';

const LOCK_KEY = 'worker:sunday-lock';

export async function runSundayLockPass(): Promise<number> {
  const redis = getRedis();
  const got = await redis.set(LOCK_KEY, '1', 'EX', 55, 'NX');
  if (got !== 'OK') return 0;

  const pastDue = await db
    .select({ driverId: balances.driverId })
    .from(balances)
    .where(
      and(eq(balances.status, 'open'), sql`${balances.dueSunday} < now()`),
    )
    .groupBy(balances.driverId);

  let locked = 0;
  for (const row of pastDue) {
    // Conditional update — never overwrite an already-locked/settled race
    const result = await db
      .update(users)
      .set({ status: 'locked', updatedAt: new Date() })
      .where(and(eq(users.id, row.driverId), eq(users.status, 'active')))
      .returning({ id: users.id });
    locked += result.length;
  }
  return locked;
}

export function startSundayLockWorker(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const n = await runSundayLockPass();
      if (n > 0) console.log(`[worker] locked ${n} account(s)`);
    } catch (err) {
      console.error('[worker] sunday lock failed', err);
    }
  };
  void tick();
  return setInterval(tick, 60_000);
}
