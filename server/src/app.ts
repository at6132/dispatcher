import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { checkDb } from './db/client.js';
import { AppError } from './lib/errors.js';
import { checkRedis } from './lib/redis.js';
import { authRoutes } from './routes/auth.js';
import {
  balanceRoutes,
  driveRoutes,
  profileRoutes,
} from './routes/drives.js';
import { meRoutes } from './routes/me.js';

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 1_048_576,
    requestTimeout: 30_000,
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (_req, reply) => {
    const [dbOk, redisOk] = await Promise.all([checkDb(), checkRedis()]);
    if (!dbOk || !redisOk) {
      return reply.status(503).send({
        ok: false,
        db: dbOk,
        redis: redisOk,
      });
    }
    return { ok: true, db: true, redis: true };
  });

  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(meRoutes, { prefix: '/v1/me' });
  await app.register(driveRoutes, { prefix: '/v1/drives' });
  await app.register(balanceRoutes, { prefix: '/v1/balances' });
  await app.register(profileRoutes, { prefix: '/v1/profiles' });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { message: err.message, code: err.code ?? 'error' },
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { message: 'Too many requests', code: 'rate_limited' },
      });
    }
    app.log.error(err);
    return reply.status(500).send({
      error: { message: 'Internal server error', code: 'internal' },
    });
  });

  return app;
}
