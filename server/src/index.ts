import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { env } from './config/env.js';
import { buildApp } from './app.js';
import { closeDb, db } from './db/client.js';
import { closeRedis } from './lib/redis.js';
import {
  notifyTelegramForce,
  telegramAlertsEnabled,
} from './lib/telegram.js';
import { startSundayLockWorker } from './workers/sundayLock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsFolder = path.join(__dirname, '../drizzle');
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
  const worker = startSundayLockWorker(app.log);

  const shutdown = async (signal: string) => {
    app.log.info({ event: 'boot.shutdown', signal }, 'boot.shutdown');
    clearInterval(worker);
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

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
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
