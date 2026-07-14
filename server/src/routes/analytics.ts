import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { trackEvent } from '../lib/analytics.js';
import { AppError, sendError } from '../lib/errors.js';
import { assertRateLimit, requireJsonContentType } from '../lib/security.js';

/** Public(ish) client analytics ingest — user JWT optional. */
export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request) => {
    requireJsonContentType(request);
  });

  app.post('/track', async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(120),
        anonymousId: z.string().max(128).optional(),
        props: z.record(z.unknown()).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    try {
      await assertRateLimit(
        {
          key: `analytics:ip:${request.ip}`,
          limit: 120,
          windowSec: 60,
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

    trackEvent({
      name: body.data.name,
      userId: request.user?.id,
      anonymousId: body.data.anonymousId,
      requestId: request.id,
      ip: request.ip,
      props: body.data.props,
    });

    return reply.status(202).send({ ok: true });
  });
};
