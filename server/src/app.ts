import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from './config/env.js';
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
  // Behind Railway (or similar) there is exactly one trusted proxy hop.
  // Spoofed X-Forwarded-For further left is ignored by hop count 1.
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'body.password',
          'body.refreshToken',
          'body.passengerPhone',
          'body.zelle',
        ],
        remove: true,
      },
    },
    trustProxy: 1,
    bodyLimit: 1_048_576,
    requestTimeout: 30_000,
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });

  // Mobile app does not need reflective CORS. Keep empty allowlist (blocks browsers)
  // unless explicitly configured — Expo native fetches are not CORS-bound.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: allowedOrigins.length
      ? (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin)) {
            cb(null, true);
            return;
          }
          cb(null, false);
        }
      : false,
    credentials: false,
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
