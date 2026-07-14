import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, sendError } from '../lib/errors.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import { toAuthUser } from '../services/auth.js';
import {
  confirmPhoto,
  createPhotoPresign,
  saveOnboarding,
} from '../services/onboarding.js';

const vehicleClass = z.enum([
  'sedan',
  'suv',
  'large_suv',
  'minivan',
  'sprinter',
]);

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request, reply) => {
    try {
      const user = requireUser(request);
      const dto = await toAuthUser(user.id);
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
        vehicleType: z.string(),
        seats: z.number().int(),
        yearsDrivingUpstate: z.number(),
        extraInfo: z.string().optional(),
        zelle: z.string().optional(),
        selfPhotoKey: z.string().optional(),
        vehicleInteriorKey: z.string().optional(),
        vehicleExteriorKey: z.string().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      const user = requireUser(request);
      const dto = await saveOnboarding(user.id, body.data);
      return reply.send({ user: dto });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/photos/presign', async (request, reply) => {
    const body = z
      .object({
        kind: z.enum(['self', 'interior', 'exterior']),
        contentType: z.string(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      const user = requireUser(request);
      const result = await createPhotoPresign(user.id, body.data);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AppError) {
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
      const user = requireUser(request);
      const result = await confirmPhoto(user.id, body.data);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });
};
