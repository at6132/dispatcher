import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

import { env } from './config/env.js';
import { checkDb } from './db/client.js';
import { AppError } from './lib/errors.js';
import { recordLatency } from './lib/latencyStats.js';
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
    /** Stashed for Telegram 5xx alerts (message / Error / response body). */
    _alertError?: unknown;
    _alertCode?: string;
  }
}

function stashAlertError(
  req: FastifyRequest,
  err: unknown,
  code?: string,
): void {
  if (req._alertError == null && err != null) req._alertError = err;
  if (code && !req._alertCode) req._alertCode = code;
}

function extractErrorFromPayload(payload: unknown): {
  message?: string;
  code?: string;
} | null {
  try {
    let raw: unknown = payload;
    if (typeof payload === 'string') {
      raw = JSON.parse(payload);
    } else if (Buffer.isBuffer(payload)) {
      raw = JSON.parse(payload.toString('utf8'));
    }
    if (!raw || typeof raw !== 'object') return null;
    const err = (raw as { error?: unknown }).error;
    if (!err || typeof err !== 'object') return null;
    const obj = err as { message?: unknown; code?: unknown };
    return {
      message: typeof obj.message === 'string' ? obj.message : undefined,
      code: typeof obj.code === 'string' ? obj.code : undefined,
    };
  } catch {
    return null;
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

    const routePath =
      request.routeOptions?.url ?? (request.url ?? '').split('?')[0] ?? '';
    recordLatency(`${request.method} ${routePath}`, ms);

    const isErrorAlert = shouldTelegramAlert({
      statusCode: reply.statusCode,
      code: request._alertCode,
    });
    const isSlow = ms > env.SLOW_REQUEST_MS;
    const shouldSlowAlert = isSlow && telegramAlertsEnabled();
    if ((isErrorAlert || shouldSlowAlert) && !request._telegramAlerted) {
      request._telegramAlerted = true;
      const title =
        isErrorAlert && isSlow
          ? 'HTTP 5xx + slow request'
          : isErrorAlert
            ? 'HTTP 5xx response'
            : 'Slow request';
      notifyTelegram({
        title,
        statusCode: reply.statusCode,
        code: isErrorAlert ? request._alertCode : 'slow_request',
        requestId: request.id,
        path: (request.url ?? '').split('?')[0],
        method: request.method,
        userId: shortId(request.user?.id),
        error: isErrorAlert ? request._alertError : undefined,
        details: isSlow
          ? { ms, thresholdMs: env.SLOW_REQUEST_MS }
          : { ms },
      });
    }
  });

  // Capture thrown errors even when a route swallows Telegram elsewhere.
  app.addHook('onError', async (request, _reply, err) => {
    stashAlertError(
      request,
      err,
      err instanceof AppError ? err.code : (err as { code?: string }).code,
    );
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

    const allowedOrigins = (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    await app.register(cors, {
      // When allowlisted: browsers must match; requests with no Origin
      // (native Expo / curl) still pass — mobile drivers are unaffected.
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
      // Pre-auth outer DoS backstop — keyed on IP only (no user yet). Ceiling
      // is high enough that carrier CGNAT / shared public IPs don't starve
      // legitimate drivers; per-user limits live in requireAuth.
      max: 400,
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

  app.addHook('onSend', async (req, reply, payload) => {
    reply.removeHeader('x-powered-by');
    if (reply.statusCode >= 500 && req._alertError == null) {
      const extracted = extractErrorFromPayload(payload);
      if (extracted?.message) {
        stashAlertError(req, extracted.message, extracted.code);
      }
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      stashAlertError(req, err, err.code);
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
    stashAlertError(req, err, 'internal');
    req.log.error(
      {
        event: 'http.unhandled',
        ...requestContext(req),
        err,
      },
      'http.unhandled',
    );
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
    slowRequestThresholdMs: env.SLOW_REQUEST_MS,
    logLevel:
      env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  });

  return app;
}
