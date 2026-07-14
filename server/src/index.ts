import { env } from './config/env.js';
import { buildApp } from './app.js';
import { closeDb } from './db/client.js';
import { closeRedis } from './lib/redis.js';
import { startSundayLockWorker } from './workers/sundayLock.js';

async function main() {
  const app = await buildApp();
  const worker = startSundayLockWorker();

  const shutdown = async (signal: string) => {
    console.log(`Shutting down on ${signal}`);
    clearInterval(worker);
    await app.close();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`API listening on :${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
