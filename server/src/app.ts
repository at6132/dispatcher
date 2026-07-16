import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

import { env } from './config/env.js';
import { checkDb } from './db/client.js';
import { AppError } from './lib/errors.js';
import {
  isQuietPath,
  logDomain,
  requestContext,
  shortId,
  summarizeBody,
} from './lib/log.js';
import { checkRedis } from './lib/redis.js';
import { rejectScanPath } from './lib/security.js';
import {
  notifyTelegram,
  shouldTelegramAlert,
  telegramAlertsEnabled,
} from './lib/telegram.js';
import { adminRoutes } from './routes/admin/index.js';
import { analyticsRoutes } from './routes/analytics.js';
import { authRoutes } from './routes/auth.js';
import {
  balanceRoutes,
  driveRoutes,
  profileRoutes,
} from './routes/drives.js';
import { favoriteRoutes } from './routes/favorites.js';
import { meRoutes } from './routes/me.js';
import { platformFeeRoutes } from './routes/platformFees.js';

declare module 'fastify' {
  interface FastifyRequest {
    _startedAt?: number;
    _telegramAlerted?: boolean;
  }
}

export async function buildApp() {
  // Behind Railway (or similar) there is exactly one trusted proxy hop.
  const app = Fastify({
    logger: {
      level:
        env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'body.password',
          'body.refreshToken',
          'body.accessToken',
          'body.passengerPhone',
          'body.zelle',
          'body.phone',
          'body.name',
          'body.extraInfo',
        ],
        remove: true,
      },
    },
    genReqId: (req) => {
      const raw = req.headers['x-request-id'];
      if (typeof raw === 'string' && raw.trim().length > 0 && raw.length < 80) {
        return raw.trim().replace(/[^\w.-]/g, '');
      }
      return randomUUID();
    },
    disableRequestLogging: true,
    trustProxy: true,
    bodyLimit: 256_000,
  });

  // Bind health earliest so Railway probes never wait on plugins.
  app.get('/healthz', async () => ({ ok: true }));

  app.addHook('onRequest', async (request, reply) => {
    rejectScanPath(request);
    request._startedAt = Date.now();
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'permissions-policy',
      'geolocation=(), microphone=(), camera=()',
    );
    if (isQuietPath(request.url)) return;
    request.log.info(
      {
        event: 'http.request',
        ...requestContext(request),
      },
      'http.request',
    );
  });

  app.addHook('preHandler', async (request) => {
    if (isQuietPath(request.url)) return;
    if (request.method === 'GET' || request.method === 'HEAD') return;
    const allowBodies =
      env.LOG_REQUEST_BODIES === true || env.NODE_ENV !== 'production';
    if (!allowBodies) return;
    const summary = summarizeBody(request.body);
    if (summary) {
      request.log.debug(
        { event: 'http.body', requestId: request.id, body: summary },
        'http.body',
      );
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    if (isQuietPath(request.url)) return;
    const ms = Date.now() - (request._startedAt ?? Date.now());
    const level =
      reply.statusCode >= 500
        ? 'error'
        : reply.statusCode >= 400
          ? 'warn'
          : 'info';
    request.log[level](
      {
        event: 'http.response',
        ...requestContext(request),
        statusCode: reply.statusCode,
        ms,
      },
      'http.response',
    );

    if (
      shouldTelegramAlert({ statusCode: reply.statusCode }) &&
      !request._telegramAlerted
    ) {
      request._telegramAlerted = true;
      notifyTelegram({
        title: 'HTTP 5xx response',
        statusCode: reply.statusCode,
        requestId: request.id,
        path: (request.url ?? '').split('?')[0],
        method: request.method,
        userId: shortId(request.user?.id),
        details: { ms },
      });
    }
  });

  // Optional lean boot for diagnosing Railway proxy hangs.
  if (process.env.SKIP_EDGE_PLUGINS !== '1') {
    await app.register(helmet, {
      global: true,
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts:
        env.NODE_ENV === 'production'
          ? { maxAge: 15552000, includeSubDomains: true }
          : false,
    });

    const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s: string) => s.trim())
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
        : true,
      credentials: false,
    });

    await app.register(rateLimit, {
      global: true,
      max: 180,
      timeWindow: '1 minute',
      nameSpace: 'rl-global:',
      allowList: (req) => isQuietPath(req.url),
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
      errorResponseBuilder: (_req, context) => ({
        error: {
          message: 'Too many requests',
          code: 'rate_limited',
          retryAfter: Math.ceil(context.ttl / 1000),
        },
      }),
    });
  }

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
  await app.register(platformFeeRoutes, { prefix: '/v1/platform-fees' });
  await app.register(profileRoutes, { prefix: '/v1/profiles' });
  await app.register(favoriteRoutes, { prefix: '/v1/favorites' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(analyticsRoutes, { prefix: '/v1/analytics' });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.removeHeader('x-powered-by');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      req.log.warn(
        {
          event: 'http.app_error',
          ...requestContext(req),
          statusCode: err.statusCode,
          code: err.code,
          message: err.message,
        },
        `http.app_error ${err.code ?? 'error'}`,
      );
      if (
        shouldTelegramAlert({
          statusCode: err.statusCode,
          code: err.code,
        }) &&
        !req._telegramAlerted
      ) {
        req._telegramAlerted = true;
        notifyTelegram({
          title: 'AppError',
          statusCode: err.statusCode,
          code: err.code,
          requestId: req.id,
          path: (req.url ?? '').split('?')[0],
          method: req.method,
          userId: shortId(req.user?.id),
          error: err.message,
        });
      }
      return reply.status(err.statusCode).send({
        error: {
          message: err.message,
          code: err.code ?? 'error',
          requestId: req.id,
        },
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      req.log.warn(
        { event: 'http.rate_limited', ...requestContext(req) },
        'http.rate_limited',
      );
      return reply.status(429).send({
        error: {
          message: 'Too many requests',
          code: 'rate_limited',
          requestId: req.id,
        },
      });
    }
    req.log.error(
      {
        event: 'http.unhandled',
        ...requestContext(req),
        err,
      },
      'http.unhandled',
    );
    if (!req._telegramAlerted) {
      req._telegramAlerted = true;
      notifyTelegram({
        title: 'Unhandled server error',
        statusCode: 500,
        code: 'internal',
        requestId: req.id,
        path: (req.url ?? '').split('?')[0],
        method: req.method,
        userId: shortId(req.user?.id),
        error: err,
      });
    }
    return reply.status(500).send({
      error: {
        message: 'Internal server error',
        code: 'internal',
        requestId: req.id,
      },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({
      error: { message: 'Not found', code: 'not_found' },
    });
  });

  logDomain(app.log, 'app.ready', {
    nodeEnv: env.NODE_ENV,
    s3Enabled: env.s3Enabled,
    telegramAlerts: telegramAlertsEnabled(),
    adminEnabled: env.adminEnabled,
    logLevel:
      env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  });

  return app;
}
