import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { AppError, sendError } from '../lib/errors.js';
import { rateLimit } from '../lib/redis.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import {
  acceptApplication,
  applyToDrive,
  completeDrive,
  createDrive,
  getDrive,
  hideDrive,
  listApplications,
  listBalances,
  listDrives,
  settleBalance,
  unassignDrive,
} from '../services/drives.js';
import { toPublicProfile } from '../services/auth.js';

async function withIdempotency(
  userId: string,
  request: { headers: Record<string, unknown>; method: string; url: string },
  reply: {
    status: (c: number) => { send: (b: unknown) => unknown };
    header: (k: string, v: string) => void;
  },
  handler: () => Promise<{ status: number; body: unknown }>,
) {
  const raw = request.headers['idempotency-key'];
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) return handler();

  // Claim first so concurrent requests with same key cannot double-apply
  const placeholder = JSON.stringify({ pending: true });
  try {
    await db.insert(idempotencyKeys).values({
      userId,
      key,
      method: request.method,
      path: request.url,
      responseStatus: 0,
      responseBody: placeholder,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  } catch {
    // Someone else claimed — wait briefly then replay stored response
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const [hit] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
        .limit(1);
      if (hit && hit.responseStatus !== 0 && hit.expiresAt.getTime() > Date.now()) {
        reply.header('Idempotency-Replayed', 'true');
        return {
          status: hit.responseStatus,
          body: JSON.parse(hit.responseBody) as unknown,
        };
      }
    }
    throw new AppError(
      409,
      'Duplicate request in progress. Retry with the same Idempotency-Key.',
      'idempotency_in_progress',
    );
  }

  try {
    const result = await handler();
    await db
      .update(idempotencyKeys)
      .set({
        responseStatus: result.status,
        responseBody: JSON.stringify(result.body),
      })
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    return result;
  } catch (err) {
    await db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    throw err;
  }
}

export const driveRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post('/', async (request, reply) => {
    const body = z
      .object({
        routeText: z.string(),
        passengerPhone: z.string(),
        address: z.string().optional(),
        fromPlace: z.string().optional(),
        toPlace: z.string().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return sendError(reply, 400, 'Invalid body', 'invalid_body');
    try {
      const user = requireUser(request);
      const wait = await rateLimit({
        key: `drive_create:${user.id}`,
        limit: 30,
        windowSec: 3600,
      });
      if (wait) {
        reply.header('Retry-After', Math.ceil(wait / 1000));
        return sendError(reply, 429, 'Too many posts', 'rate_limited');
      }
      const result = await withIdempotency(
        user.id,
        request as never,
        reply as never,
        async () => {
          const drive = await createDrive(user.id, body.data);
          return { status: 201, body: { drive } };
        },
      );
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.get('/', async (request, reply) => {
    const query = z
      .object({
        status: z.string().optional(),
        completed: z
          .enum(['1', 'true', '0', 'false'])
          .optional()
          .transform((v) => v === '1' || v === 'true'),
        limit: z.coerce.number().int().optional(),
        cursor: z.string().optional(),
      })
      .safeParse(request.query);
    if (!query.success) {
      return sendError(reply, 400, 'Invalid query', 'invalid_query');
    }
    try {
      const user = requireUser(request);
      const result = await listDrives(user.id, query.data);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.get('/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      const drive = await getDrive(user.id, params.data.id);
      return reply.send({ drive });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/applications', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        lat: z.number().optional(),
        lng: z.number().optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid request', 'invalid_request');
    }
    try {
      const user = requireUser(request);
      const wait = await rateLimit({
        key: `apply:${user.id}`,
        limit: 60,
        windowSec: 3600,
      });
      if (wait) {
        reply.header('Retry-After', Math.ceil(wait / 1000));
        return sendError(reply, 429, 'Too many applies', 'rate_limited');
      }
      const appRow = await applyToDrive(user.id, params.data.id, body.data);
      return reply.status(201).send({
        application: {
          id: appRow!.id,
          driveId: appRow!.driveId,
          status: appRow!.status,
          createdAt: appRow!.createdAt.toISOString(),
        },
      });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.get('/:id/applications', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      const items = await listApplications(user.id, params.data.id);
      return reply.send({ items });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/accept', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({ applicationId: z.string().uuid() })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid request', 'invalid_request');
    }
    try {
      const user = requireUser(request);
      const result = await withIdempotency(
        user.id,
        request as never,
        reply as never,
        async () => {
          const drive = await acceptApplication(
            user.id,
            params.data.id,
            body.data.applicationId,
          );
          return { status: 200, body: { drive } };
        },
      );
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/unassign', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      const drive = await unassignDrive(user.id, params.data.id);
      return reply.send({ drive });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/complete', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        costCents: z.number().int(),
        miles: z.number().optional(),
        waitMinutes: z.number().int().optional(),
        note: z.string().optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid request', 'invalid_request');
    }
    try {
      const user = requireUser(request);
      const result = await withIdempotency(
        user.id,
        request as never,
        reply as never,
        async () => {
          const out = await completeDrive(user.id, params.data.id, body.data);
          return { status: 200, body: out };
        },
      );
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/hide', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      const drive = await hideDrive(user.id, params.data.id);
      return reply.send({ drive });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });
};

export const balanceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request, reply) => {
    try {
      const user = requireUser(request);
      const items = await listBalances(user.id);
      return reply.send({ items });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/settle', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      const balance = await settleBalance(user.id, params.data.id);
      return reply.send({
        balance: {
          id: balance.id,
          status: balance.status,
          settledAt: balance.settledAt?.toISOString(),
        },
      });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });
};

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = await toPublicProfile(params.data.id);
      return reply.send({ user });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });
};
