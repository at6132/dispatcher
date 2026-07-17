import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { env } from './config/env.js';
import { buildApp } from './app.js';
import { closeDb, db } from './db/client.js';
import { closeRedis, ensureRedisConnected } from './lib/redis.js';
import {
  notifyTelegramForce,
  telegramAlertsEnabled,
} from './lib/telegram.js';
import { startLatencyAlertsWorker } from './workers/latencyAlerts.js';
import { startScheduledReminderWorker } from './workers/scheduledReminders.js';
import { startSundayLockWorker } from './workers/sundayLock.js';
import { startTelegramAdminWorker } from './workers/telegramAdmin.js';

async function main() {
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: 'boot.migrate.start',
      migrationsFolder,
    }),
  );
  await migrate(db, { migrationsFolder });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event: 'boot.migrate.ok' }));

  const app = await buildApp();

  let worker: NodeJS.Timeout | undefined;
  let latencyWorker: NodeJS.Timeout | undefined;
  let reminderWorker: NodeJS.Timeout | undefined;
  let tgAdmin: { stop: () => void } | undefined;

  const shutdown = async (signal: string) => {
    app.log.info({ event: 'boot.shutdown', signal }, 'boot.shutdown');
    if (worker) clearInterval(worker);
    if (latencyWorker) clearInterval(latencyWorker);
    if (reminderWorker) clearInterval(reminderWorker);
    tgAdmin?.stop();
    await app.close();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    app.log.error({ event: 'process.uncaughtException', err }, 'uncaught');
    notifyTelegramForce({
      title: 'uncaughtException',
      statusCode: 500,
      code: 'uncaughtException',
      error: err,
    });
    setTimeout(() => process.exit(1), 1500);
  });
  process.on('unhandledRejection', (reason) => {
    app.log.error(
      { event: 'process.unhandledRejection', err: reason },
      'unhandledRejection',
    );
    notifyTelegramForce({
      title: 'unhandledRejection',
      statusCode: 500,
      code: 'unhandledRejection',
      error: reason,
    });
    setTimeout(() => process.exit(1), 1500);
  });

  // Railway public networking expects IPv6 (`::`), which dual-stacks IPv4 too.
  await app.listen({ port: env.PORT, host: '::' });
  // keepAlive above Railway proxy idle so responses don't stall mid-flight
  app.server.keepAliveTimeout = 65_000;
  app.server.headersTimeout = 66_000;
  app.log.info(
    {
      event: 'boot.listen',
      port: env.PORT,
      s3Enabled: env.s3Enabled,
      telegramAlerts: telegramAlertsEnabled(),
      nodeEnv: env.NODE_ENV,
    },
    'boot.listen',
  );

  if (process.env.SKIP_WORKERS === '1') {
    app.log.info({ event: 'boot.workers', skipped: true }, 'boot.workers');
    return;
  }

  const redisOk = await ensureRedisConnected();
  app.log.info({ event: 'boot.redis', ok: redisOk }, 'boot.redis');

  // Defer background workers until after the first tick so boot probing
  // isn't competing with Redis/DB work on a cold private network.
  setTimeout(() => {
    worker = startSundayLockWorker(app.log);
    latencyWorker = startLatencyAlertsWorker(app.log);
    reminderWorker = startScheduledReminderWorker(app.log);
    tgAdmin = startTelegramAdminWorker(app.log);
  }, 1500);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ event: 'boot.fatal', err: String(err) }));
  // eslint-disable-next-line no-console
  console.error(err);
  notifyTelegramForce({
    title: 'boot.fatal',
    statusCode: 500,
    code: 'boot_fatal',
    error: err,
  });
  // Give Telegram a moment before exit
  setTimeout(() => process.exit(1), 1500);
});
