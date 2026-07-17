import type { FastifyBaseLogger } from 'fastify';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { drives } from '../db/schema.js';
import { getRedis } from '../lib/redis.js';
import { notifyTelegram } from '../lib/telegram.js';
import { notifyScheduledDriveReminder } from '../services/pushNotifications.js';

const LOCK_KEY = 'worker:scheduled-reminders';

/**
 * Push assignees 15 minutes before a scheduled assigned drive.
 * Marks reminder_sent_at so each drive fires once.
 */
export async function runScheduledReminderPass(): Promise<number> {
  const redis = getRedis();
  const got = await redis.set(LOCK_KEY, '1', 'EX', 55, 'NX');
  if (got !== 'OK') return 0;

  const due = await db
    .select({
      id: drives.id,
      assigneeId: drives.assigneeId,
      posterId: drives.posterId,
      routeText: drives.routeText,
      scheduledAt: drives.scheduledAt,
    })
    .from(drives)
    .where(
      and(
        eq(drives.status, 'assigned'),
        isNull(drives.reminderSentAt),
        sql`${drives.assigneeId} IS NOT NULL`,
        // Within the 15‑min window, and not already past start
        sql`${drives.scheduledAt} > now()`,
        lte(drives.scheduledAt, sql`now() + interval '15 minutes'`),
      ),
    )
    .limit(50);

  let sent = 0;
  for (const row of due) {
    if (!row.assigneeId) continue;
    const [claimed] = await db
      .update(drives)
      .set({ reminderSentAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(drives.id, row.id),
          eq(drives.status, 'assigned'),
          isNull(drives.reminderSentAt),
        ),
      )
      .returning({ id: drives.id });
    if (!claimed) continue;

    notifyScheduledDriveReminder({
      driverId: row.assigneeId,
      posterId: row.posterId,
      driveId: row.id,
      routeText: row.routeText,
      scheduledAt: row.scheduledAt,
    });
    sent += 1;
  }
  return sent;
}

export function startScheduledReminderWorker(
  log?: FastifyBaseLogger,
): NodeJS.Timeout {
  const tick = async () => {
    try {
      const n = await runScheduledReminderPass();
      if (n > 0) {
        log?.info(
          { event: 'worker.scheduled_reminder', sent: n },
          'worker.scheduled_reminder',
        );
      }
    } catch (err) {
      log?.error(
        { event: 'worker.scheduled_reminder.fail', err },
        'worker.scheduled_reminder.fail',
      );
      notifyTelegram({
        title: 'Scheduled reminder worker failed',
        statusCode: 500,
        code: 'worker_scheduled_reminder',
        error: err,
      });
      if (!log) {
        // eslint-disable-next-line no-console
        console.error('[worker] scheduled reminder failed', err);
      }
    }
  };

  void tick();
  return setInterval(() => void tick(), 60_000);
}
