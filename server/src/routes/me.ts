import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { AppError, sendError } from '../lib/errors.js';
import { trackEvent } from '../lib/analytics.js';
import { logDomain, logDomainWarn, shortId } from '../lib/log.js';
import { assertClientLimits, requireJsonContentType } from '../lib/security.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import { toAuthUser } from '../services/auth.js';
import {
  confirmPhoto,
  createPhotoPresign,
  saveOnboarding,
} from '../services/onboarding.js';
import {
  getNotificationPrefs,
  updateNotificationPrefs,
} from '../services/notificationPrefs.js';
import {
  deletePushToken,
  upsertPushToken,
} from '../services/pushNotifications.js';
import { updatePresence } from '../services/profiles.js';

const vehicleClass = z.enum([
  'sedan',
  'suv',
  'large_suv',
  'minivan',
  'sprinter',
]);

const notificationPrefMode = z.enum(['off', 'all', 'favorites']);

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', async (request) => {
    requireJsonContentType(request);
  });

  app.get('/', async (request, reply) => {
    try {
      await assertClientLimits(request, reply, {
        name: 'me_get',
        ipLimit: 120,
        userLimit: 60,
        windowSec: 60,
      });
      const user = requireUser(request);
      const dto = await toAuthUser(user.id);
      logDomain(request.log, 'me.get', {
        requestId: request.id,
        userId: shortId(dto.id),
        onboardingComplete: dto.onboardingComplete,
        status: dto.status,
        hasProfile: Boolean(dto.onboarding),
      });
      return reply.send({ user: dto });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.patch('/', async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'me_patch',
        ipLimit: 30,
        userLimit: 20,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      const name = body.data.name.trim();
      if (name.length < 2) {
        return sendError(reply, 400, 'Enter a valid name', 'invalid_name');
      }
      await db
        .update(users)
        .set({ name, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      const dto = await toAuthUser(user.id);
      logDomain(request.log, 'me.patch.ok', {
        requestId: request.id,
        userId: shortId(dto.id),
      });
      return reply.send({ user: dto });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.put('/presence', async (request, reply) => {
    const body = z
      .object({
        availability: z.enum(['available', 'busy', 'offline']).optional(),
        lat: z.number().finite().optional(),
        lng: z.number().finite().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'me_presence',
        ipLimit: 120,
        userLimit: 90,
        windowSec: 60,
        failClosed: true,
      });
      const dto = await updatePresence(user.id, body.data);
      return reply.send({ user: dto });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.put('/onboarding', async (request, reply) => {
    const body = z
      .object({
        vehicleClass,
        vehicleType: z.string().min(1).max(60),
        // coerce: some clients briefly serialize numbers as strings
        seats: z.coerce.number().int().min(1).max(20),
        yearsDrivingUpstate: z.coerce.number().min(0).max(80),
        extraInfo: z.string().max(2000).optional(),
        zelle: z.string().max(120).optional(),
        selfPhotoKey: z.string().max(512).optional(),
        vehicleInteriorKey: z.string().max(512).optional(),
        vehicleExteriorKey: z.string().max(512).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      logDomainWarn(request.log, 'onboarding.invalid_body', {
        requestId: request.id,
        userId: shortId(request.user?.id),
        issues: body.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
        })),
      });
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'onboarding',
        ipLimit: 30,
        userLimit: 20,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      logDomain(request.log, 'onboarding.save.start', {
        requestId: request.id,
        userId: shortId(user.id),
        vehicleClass: body.data.vehicleClass,
        seats: body.data.seats,
        yearsDrivingUpstate: body.data.yearsDrivingUpstate,
        hasZelle: Boolean(body.data.zelle),
        hasSelfPhoto: Boolean(body.data.selfPhotoKey),
        hasInterior: Boolean(body.data.vehicleInteriorKey),
        hasExterior: Boolean(body.data.vehicleExteriorKey),
      });
      const dto = await saveOnboarding(user.id, body.data);
      logDomain(request.log, 'onboarding.save.ok', {
        requestId: request.id,
        userId: shortId(dto.id),
        onboardingComplete: dto.onboardingComplete,
      });
      if (dto.onboardingComplete) {
        trackEvent({
          name: 'onboarding.complete',
          userId: dto.id,
          requestId: request.id,
          ip: request.ip,
        });
      }
      return reply.send({ user: dto });
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'onboarding.save.fail', {
          requestId: request.id,
          userId: shortId(request.user?.id),
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/photos/presign', async (request, reply) => {
    const body = z
      .object({
        kind: z.enum(['self', 'interior', 'exterior', 'payment_proof']),
        contentType: z.string().max(100),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'photo_presign',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      const result = await createPhotoPresign(user.id, body.data);
      logDomain(request.log, 'photos.presign.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        kind: body.data.kind,
        uploadId: result.uploadId,
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'photos.presign.fail', {
          requestId: request.id,
          userId: shortId(request.user?.id),
          kind: body.data.kind,
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/photos/confirm', async (request, reply) => {
    const body = z
      .object({ uploadId: z.string().uuid() })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'photo_confirm',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      const result = await confirmPhoto(user.id, body.data);
      logDomain(request.log, 'photos.confirm.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        kind: result.kind,
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'photos.confirm.fail', {
          requestId: request.id,
          userId: shortId(request.user?.id),
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.get('/notifications', async (request, reply) => {
    try {
      await assertClientLimits(request, reply, {
        name: 'me_notifications_get',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 60,
      });
      const user = requireUser(request);
      const preferences = await getNotificationPrefs(user.id);
      return reply.send({ preferences });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.patch('/notifications', async (request, reply) => {
    const body = z
      .object({
        newApplication: notificationPrefMode.optional(),
        driveStatus: z.enum(['off', 'all']).optional(),
        applicationAccepted: notificationPrefMode.optional(),
        newDrivePosted: notificationPrefMode.optional(),
        cancelRequest: notificationPrefMode.optional(),
        applicationCleared: notificationPrefMode.optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'me_notifications_patch',
        ipLimit: 30,
        userLimit: 20,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      const preferences = await updateNotificationPrefs(user.id, body.data);
      logDomain(request.log, 'me.notifications.patch', {
        requestId: request.id,
        userId: shortId(user.id),
      });
      return reply.send({ preferences });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.put('/push-token', async (request, reply) => {
    const body = z
      .object({
        token: z.string().min(8).max(512),
        platform: z.enum(['ios', 'android', 'web']).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'me_push_token_put',
        ipLimit: 30,
        userLimit: 20,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      await upsertPushToken(user.id, body.data.token, body.data.platform);
      logDomain(request.log, 'me.push_token.put', {
        requestId: request.id,
        userId: shortId(user.id),
        platform: body.data.platform,
      });
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.delete('/push-token', async (request, reply) => {
    const body = z
      .object({
        token: z.string().min(8).max(512),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      const user = requireUser(request);
      await deletePushToken(user.id, body.data.token);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });
};
