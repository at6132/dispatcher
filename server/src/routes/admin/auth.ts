import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { AppError, sendError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { assertRateLimit, requireJsonContentType } from '../../lib/security.js';
import {
  requireAdmin,
  requireAdminSession,
} from '../../middleware/adminAuth.js';
import * as adminAuth from '../../services/adminAuth.js';

export const adminAuthRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request) => {
    requireJsonContentType(request);
  });

  app.post('/login', async (request, reply) => {
    if (!env.adminEnabled) {
      return sendError(reply, 503, 'Admin login disabled', 'admin_disabled');
    }

    const body = z
      .object({ password: z.string().min(1).max(128) })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    try {
      await assertRateLimit(
        {
          key: `admin_login:ip:${request.ip}`,
          limit: 8,
          windowSec: 3600,
          failClosed: true,
        },
        reply,
      );
      await assertRateLimit(
        {
          key: 'admin_login:global',
          limit: 40,
          windowSec: 3600,
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
      const result = await adminAuth.startAdminLogin({
        password: body.data.password,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.get('/challenge/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, 'Invalid challenge id', 'invalid_body');
    }

    try {
      await assertRateLimit(
        {
          key: `admin_poll:ip:${request.ip}`,
          limit: 120,
          windowSec: 60,
          failClosed: true,
        },
        reply,
      );
      const result = await adminAuth.getChallengeStatus({
        challengeId: params.data.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post(
    '/logout',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const session = requireAdminSession(request);
      await adminAuth.revokeAdminSession(session.id);
      writeAudit({
        actorType: 'admin',
        actorId: session.id,
        sessionId: session.id,
        action: 'admin.logout',
        requestId: request.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return reply.send({ ok: true });
    },
  );

  app.get('/me', { preHandler: requireAdmin }, async (request, reply) => {
    const session = requireAdminSession(request);
    return reply.send({
      sessionId: session.id,
      ip: session.ip,
      expiresAt: session.expiresAt.toISOString(),
      loginIp: session.ip,
    });
  });

  /** Lightweight admin-only status for debugging Telegram 2FA (no secrets). */
  app.get('/debug', { preHandler: requireAdmin }, async (_request, reply) => {
    const { getTelegramAdminWorkerDebug } = await import(
      '../../workers/telegramAdmin.js'
    );
    const { countPendingAdminChallenges } = await import(
      '../../services/adminAuth.js'
    );
    return reply.send({
      adminEnabled: env.adminEnabled,
      telegramConfigured: Boolean(
        env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_ID,
      ),
      approvedChatCount: (env.TELEGRAM_CHAT_IDS ?? '')
        .split(/[,\s]+/)
        .filter(Boolean).length,
      pendingChallenges: await countPendingAdminChallenges(),
      worker: getTelegramAdminWorkerDebug(),
    });
  });
};
