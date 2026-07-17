/**
 * Simulates two near-simultaneous accept paths for the same driver on two
 * different drives. Mirrors withLock fail-fast semantics in-memory so this
 * runs without Redis: the second attempt must get lock_busy rather than both
 * entering the critical section.
 *
 * Usage: cd server && npx tsx scripts/test-driver-schedule-lock.ts
 */
import { AppError } from '../src/lib/errors.js';

const DRIVER = '00000000-0000-4000-8000-000000000001';
const DRIVE_A = '00000000-0000-4000-8000-0000000000aa';
const DRIVE_B = '00000000-0000-4000-8000-0000000000bb';

const held = new Set<string>();

/** Same fail-fast behavior as lib/locks.withLock (409 lock_busy if held). */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (held.has(name)) {
    throw new AppError(
      409,
      'This action is already in progress. Try again.',
      'lock_busy',
    );
  }
  held.add(name);
  try {
    return await fn();
  } finally {
    held.delete(name);
  }
}

/** Same nest order as services/drives.withAssignmentLocks. */
async function withAssignmentLocks<T>(
  driverId: string,
  driveId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withLock(`driver:${driverId}:schedule`, () =>
    withLock(`drive:${driveId}:mutate`, fn),
  );
}

async function main() {
  let entered = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const holdMs = 50;
  const order: string[] = [];

  const run = async (label: string, driveId: string) => {
    await withAssignmentLocks(DRIVER, driveId, async () => {
      order.push(`${label}:enter`);
      entered += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, holdMs));
      concurrent -= 1;
      order.push(`${label}:exit`);
    });
  };

  const results = await Promise.allSettled([
    run('A', DRIVE_A),
    (async () => {
      await new Promise((r) => setTimeout(r, 5));
      return run('B', DRIVE_B);
    })(),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const busyRejects = results.filter(
    (r) =>
      r.status === 'rejected' &&
      r.reason instanceof AppError &&
      r.reason.code === 'lock_busy',
  );

  console.log(
    JSON.stringify(
      {
        order,
        entered,
        maxConcurrent,
        fulfilled,
        lockBusy: busyRejects.length,
      },
      null,
      2,
    ),
  );

  if (maxConcurrent !== 1) {
    throw new Error(
      `Expected maxConcurrent=1 (serialized), got ${maxConcurrent}`,
    );
  }
  if (fulfilled !== 1 || busyRejects.length !== 1) {
    throw new Error(
      `Expected 1 success + 1 lock_busy, got fulfilled=${fulfilled} lockBusy=${busyRejects.length}`,
    );
  }

  console.log('ok: driver schedule lock serializes concurrent accepts');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
