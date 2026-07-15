import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError, sendError } from '../lib/errors.js';
import { logDomain, logDomainWarn, shortId } from '../lib/log.js';
import { assertClientLimits, requireJsonContentType } from '../lib/security.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import {
  addFavorite,
  listFavorites,
  removeFavorite,
} from '../services/favorites.js';

export const favoriteRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', async (request) => {
    requireJsonContentType(request);
  });

  app.get('/', async (request, reply) => {
    try {
      await assertClientLimits(request, reply, {
        name: 'favorites_list',
        ipLimit: 120,
        userLimit: 60,
        windowSec: 60,
      });
      const user = requireUser(request);
      const items = await listFavorites(user.id);
      logDomain(request.log, 'favorites.list', {
        requestId: request.id,
        userId: shortId(user.id),
        count: items.length,
      });
      return reply.send({ items });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/', async (request, reply) => {
    const body = z
      .object({ userId: z.string().uuid() })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'favorites_add',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      const item = await addFavorite(user.id, body.data.userId);
      logDomain(request.log, 'favorites.add', {
        requestId: request.id,
        userId: shortId(user.id),
        favoriteUserId: shortId(body.data.userId),
      });
      return reply.status(201).send({ favorite: item });
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'favorites.add.fail', {
          requestId: request.id,
          userId: shortId(request.user?.id),
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.delete('/:userId', async (request, reply) => {
    const params = z
      .object({ userId: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, 'Invalid user id', 'invalid_params');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'favorites_remove',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      await removeFavorite(user.id, params.data.userId);
      logDomain(request.log, 'favorites.remove', {
        requestId: request.id,
        userId: shortId(user.id),
        favoriteUserId: shortId(params.data.userId),
      });
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'favorites.remove.fail', {
          requestId: request.id,
          userId: shortId(request.user?.id),
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });
};
