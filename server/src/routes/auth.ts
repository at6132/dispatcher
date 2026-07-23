import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { trackEvent } from '../lib/analytics.js';
import { AppError, sendError } from '../lib/errors.js';
import { logDomain, logDomainWarn, maskPhone, shortId } from '../lib/log.js';
import { normalizePhone } from '../lib/phone.js';
import {
  assertRateLimit,
  requireJsonContentType,
  tokenBucketKey,
} from '../lib/security.js';
import { recordSecurityEvent } from '../lib/securityEvents.js';
import { claimAlertOnce, trackDistinctInWindow } from '../lib/redis.js';
import * as auth from '../services/auth.js';

/** Distinct phones per IP before credential-stuffing alert (tunable). */
const CREDENTIAL_STUFFING_PHONE_THRESHOLD = 5;
const CREDENTIAL_STUFFING_WINDOW_SEC = 3600;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request) => {
    requireJsonContentType(request);
  });

  app.post('/signup', async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        phone: z.string().min(5).max(32),
        password: z.string().min(1).max(128),
        pin: z.string().min(1).max(16),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const ip = request.ip;
    const phoneKey = normalizePhone(body.data.phone) || 'invalid';
    try {
      await assertRateLimit(
        {
          key: `signup:ip:${ip}`,
          limit: 8,
          windowSec: 3600,
          failClosed: true,
        },
        reply,
      );
      await assertRateLimit(
        {
          key: `signup:phone:${phoneKey}`,
          limit: 3,
          windowSec: 3600,
          failClosed: true,
        },
        reply,
      );
    } catch (err) {
      if (err instanceof AppError && err.code === 'rate_limited') {
        logDomainWarn(request.log, 'auth.signup.rate_limited', {
          requestId: request.id,
          phone: maskPhone(phoneKey),
          ip,
        });
        return sendError(reply, 429, 'Too many attempts', 'rate_limited');
      }
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }

    try {
      const tokens = await auth.signup(body.data);
      logDomain(request.log, 'auth.signup.ok', {
        requestId: request.id,
        userId: shortId(tokens.user.id),
        phone: maskPhone(tokens.user.phone),
        onboardingComplete: tokens.user.onboardingComplete,
      });
      trackEvent({
        name: 'auth.signup',
        userId: tokens.user.id,
        requestId: request.id,
        ip: request.ip,
      });
      return reply.status(201).send(tokens);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'auth.signup.fail', {
          requestId: request.id,
          phone: maskPhone(phoneKey),
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/login', async (request, reply) => {
    const body = z
      .object({
        phone: z.string().min(5).max(32),
        password: z.string().min(1).max(128),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const phoneKey = normalizePhone(body.data.phone) || 'invalid';
    try {
      await assertRateLimit(
        {
          key: `login:ip:${request.ip}`,
          limit: 30,
          windowSec: 900,
          failClosed: true,
        },
        reply,
      );
      await assertRateLimit(
        {
          key: `login:phone:${phoneKey}`,
          limit: 10,
          windowSec: 900,
          failClosed: true,
        },
        reply,
      );
    } catch (err) {
      if (err instanceof AppError && err.code === 'rate_limited') {
        logDomainWarn(request.log, 'auth.login.rate_limited', {
          requestId: request.id,
          phone: maskPhone(phoneKey),
        });
        return sendError(reply, 429, 'Too many attempts', 'rate_limited');
      }
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }

    // Credential-stuffing signal: many distinct phones from one IP (additive;
    // does not replace login:ip / login:phone rate limits above).
    const distinctPhones = await trackDistinctInWindow({
      key: `distinct_phones:ip:${request.ip}`,
      member: phoneKey,
      windowSec: CREDENTIAL_STUFFING_WINDOW_SEC,
    });
    if (distinctPhones >= CREDENTIAL_STUFFING_PHONE_THRESHOLD) {
      const shouldAlert = await claimAlertOnce({
        key: `credential_stuffing:ip:${request.ip}`,
        ttlSec: CREDENTIAL_STUFFING_WINDOW_SEC,
      });
      if (shouldAlert) {
        recordSecurityEvent({
          kind: 'credential_stuffing_suspected',
          severity: 'critical',
          alert: true,
          ip: request.ip,
          requestId: request.id,
          detail: {
            distinctPhonesAttempted: distinctPhones,
            windowSec: CREDENTIAL_STUFFING_WINDOW_SEC,
          },
        });
      }
    }

    try {
      const tokens = await auth.login(body.data);
      logDomain(request.log, 'auth.login.ok', {
        requestId: request.id,
        userId: shortId(tokens.user.id),
        phone: maskPhone(tokens.user.phone),
        onboardingComplete: tokens.user.onboardingComplete,
        status: tokens.user.status,
      });
      trackEvent({
        name: 'auth.login',
        userId: tokens.user.id,
        requestId: request.id,
        ip: request.ip,
      });
      return reply.send(tokens);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'auth.login.fail', {
          requestId: request.id,
          phone: maskPhone(phoneKey),
          code: err.code,
        });
        if (err.code === 'invalid_credentials') {
          recordSecurityEvent({
            kind: 'user_login_fail',
            severity: 'info',
            ip: request.ip,
            requestId: request.id,
            detail: { phone: maskPhone(phoneKey) },
          });
          return sendError(
            reply,
            401,
            'Invalid phone or password.',
            'invalid_credentials',
          );
        }
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/refresh', async (request, reply) => {
    const body = z
      .object({ refreshToken: z.string().min(1).max(4096) })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    try {
      await assertRateLimit(
        {
          key: `refresh:ip:${request.ip}`,
          limit: 60,
          windowSec: 600,
          failClosed: true,
        },
        reply,
      );
      await assertRateLimit(
        {
          key: tokenBucketKey('refresh:tok', body.data.refreshToken),
          limit: 30,
          windowSec: 600,
          failClosed: true,
        },
        reply,
      );
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }

    try {
      const tokens = await auth.refresh(body.data.refreshToken, {
        ip: request.ip,
        requestId: request.id,
      });
      logDomain(request.log, 'auth.refresh.ok', {
        requestId: request.id,
        userId: shortId(tokens.user.id),
        onboardingComplete: tokens.user.onboardingComplete,
      });
      return reply.send(tokens);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'auth.refresh.fail', {
          requestId: request.id,
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/logout', async (request, reply) => {
    try {
      await assertRateLimit(
        {
          key: `logout:ip:${request.ip}`,
          limit: 60,
          windowSec: 600,
          failClosed: false,
        },
        reply,
      );
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }

    const body = z
      .object({ refreshToken: z.string().max(4096).optional() })
      .safeParse(request.body ?? {});
    await auth.logout(body.success ? body.data.refreshToken : undefined);
    logDomain(request.log, 'auth.logout', { requestId: request.id });
    return reply.status(204).send();
  });
};
