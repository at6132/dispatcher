import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { AppError, sendError } from '../lib/errors.js';
import { trackEvent } from '../lib/analytics.js';
import { logDomain, logDomainWarn, shortId } from '../lib/log.js';
import { assertClientLimits, requireJsonContentType } from '../lib/security.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import {
  acceptApplication,
  acceptDirectInvite,
  applyToDrive,
  clearApplications,
  completeDrive,
  createDrive,
  declineDirectInvite,
  getDrive,
  hideDrive,
  listApplications,
  listBalances,
  listDrives,
  markDrivePickedUp,
  requestDriveCancel,
  respondDriveCancel,
  settleBalance,
  unassignDrive,
  updateDrive,
} from '../services/drives.js';
import {
  addFavorite,
  getDriverProfile,
  listDriverProfiles,
  listDriverTripHistory,
  removeFavorite,
} from '../services/profiles.js';

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
  app.addHook('preHandler', async (request) => {
    requireJsonContentType(request);
  });

  app.post('/', async (request, reply) => {
    const body = z
      .object({
        routeText: z.string().min(1).max(2000),
        passengerPhone: z.string().min(5).max(32),
        vehicleClass: z.enum([
          'sedan',
          'suv',
          'large_suv',
          'minivan',
          'sprinter',
        ]),
        seats: z.coerce.number().int().min(1).max(20),
        tripType: z.enum(['one_way', 'round_trip']),
        address: z.string().max(500).optional(),
        extraInfo: z.string().max(2000).optional(),
        fromPlace: z.string().max(200).optional(),
        toPlace: z.string().max(200).optional(),
        inviteDriverId: z.string().uuid().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return sendError(reply, 400, 'Invalid body', 'invalid_body');
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'drive_create',
        ipLimit: 40,
        userLimit: 30,
        windowSec: 3600,
        failClosed: true,
      });
      const result = await withIdempotency(
        user.id,
        request as never,
        reply as never,
        async () => {
          const drive = await createDrive(user.id, body.data);
          return { status: 201, body: { drive } };
        },
      );
      logDomain(request.log, 'drives.create.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        status: result.status,
      });
      trackEvent({
        name: 'drive.create',
        userId: user.id,
        requestId: request.id,
        ip: request.ip,
      });
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'drives.create.fail', {
          requestId: request.id,
          code: err.code,
        });
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

  app.patch('/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        routeText: z.string().min(1).max(2000),
        passengerPhone: z.string().min(5).max(32),
        vehicleClass: z.enum([
          'sedan',
          'suv',
          'large_suv',
          'minivan',
          'sprinter',
        ]),
        seats: z.coerce.number().int().min(1).max(20),
        tripType: z.enum(['one_way', 'round_trip']),
        address: z.string().max(500).optional(),
        extraInfo: z.string().max(2000).optional(),
        fromPlace: z.string().max(200).optional(),
        toPlace: z.string().max(200).optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid request', 'invalid_request');
    }
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'drive_update',
        ipLimit: 40,
        userLimit: 30,
        windowSec: 3600,
        failClosed: true,
      });
      const drive = await updateDrive(user.id, params.data.id, body.data);
      logDomain(request.log, 'drives.update.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        driveId: shortId(params.data.id),
      });
      return reply.send({ drive });
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'drives.update.fail', {
          requestId: request.id,
          code: err.code,
        });
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
      await assertClientLimits(request, reply, {
        name: 'drive_apply',
        ipLimit: 90,
        userLimit: 60,
        windowSec: 3600,
        failClosed: true,
      });
      const appRow = await applyToDrive(user.id, params.data.id, body.data);
      logDomain(request.log, 'drives.apply.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        driveId: shortId(params.data.id),
      });
      trackEvent({
        name: 'drive.apply',
        userId: user.id,
        requestId: request.id,
        ip: request.ip,
        props: { driveId: params.data.id },
      });
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

  app.post('/:id/applications/clear', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'drive_clear_applications',
        ipLimit: 40,
        userLimit: 30,
        windowSec: 3600,
        failClosed: true,
      });
      const result = await clearApplications(user.id, params.data.id);
      logDomain(request.log, 'drives.clear_applications.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        driveId: shortId(params.data.id),
        cleared: result.cleared,
      });
      return reply.send(result);
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
      await assertClientLimits(request, reply, {
        name: 'drive_accept',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 3600,
        failClosed: true,
      });
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
      logDomain(request.log, 'drives.accept.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        driveId: shortId(params.data.id),
      });
      trackEvent({
        name: 'drive.accept',
        userId: user.id,
        requestId: request.id,
        ip: request.ip,
        props: { driveId: params.data.id },
      });
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'drives.accept.fail', {
          requestId: request.id,
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/accept-invite', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, 'Invalid drive id', 'invalid_params');
    }
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'drive_accept_invite',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 60,
        failClosed: true,
      });
      const result = await withIdempotency(user.id, request, reply, async () => {
        const drive = await acceptDirectInvite(user.id, params.data.id);
        return { status: 200, body: { drive } };
      });
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/decline-invite', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, 'Invalid drive id', 'invalid_params');
    }
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'drive_decline_invite',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 60,
        failClosed: true,
      });
      const result = await withIdempotency(user.id, request, reply, async () => {
        const drive = await declineDirectInvite(user.id, params.data.id);
        return { status: 200, body: { drive } };
      });
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

  app.post('/:id/cancel-request', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'drive_cancel_request',
        ipLimit: 30,
        userLimit: 20,
        windowSec: 3600,
        failClosed: true,
      });
      const result = await withIdempotency(
        user.id,
        request as never,
        reply as never,
        async () => {
          const drive = await requestDriveCancel(user.id, params.data.id);
          return { status: 200, body: { drive } };
        },
      );
      logDomain(request.log, 'drives.cancel_request.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        driveId: shortId(params.data.id),
      });
      trackEvent({
        name: 'drive.cancel_request',
        userId: user.id,
        requestId: request.id,
        ip: request.ip,
        props: { driveId: params.data.id },
      });
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'drives.cancel_request.fail', {
          requestId: request.id,
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/cancel-respond', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    const body = z
      .object({ approve: z.boolean() })
      .safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'drive_cancel_respond',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 3600,
        failClosed: true,
      });
      const result = await withIdempotency(
        user.id,
        request as never,
        reply as never,
        async () => {
          const drive = await respondDriveCancel(
            user.id,
            params.data.id,
            body.data.approve,
          );
          return { status: 200, body: { drive } };
        },
      );
      logDomain(request.log, 'drives.cancel_respond.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        driveId: shortId(params.data.id),
        approve: body.data.approve,
      });
      trackEvent({
        name: 'drive.cancel_respond',
        userId: user.id,
        requestId: request.id,
        ip: request.ip,
        props: {
          driveId: params.data.id,
          approve: body.data.approve,
        },
      });
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'drives.cancel_respond.fail', {
          requestId: request.id,
          code: err.code,
        });
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/picked-up', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'drive_picked_up',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 3600,
        failClosed: true,
      });
      const result = await withIdempotency(
        user.id,
        request as never,
        reply as never,
        async () => {
          const drive = await markDrivePickedUp(user.id, params.data.id);
          return { status: 200, body: { drive } };
        },
      );
      logDomain(request.log, 'drives.picked_up.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        driveId: shortId(params.data.id),
      });
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'drives.picked_up.fail', {
          requestId: request.id,
          code: err.code,
        });
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
      await assertClientLimits(request, reply, {
        name: 'drive_complete',
        ipLimit: 40,
        userLimit: 30,
        windowSec: 3600,
        failClosed: true,
      });
      const result = await withIdempotency(
        user.id,
        request as never,
        reply as never,
        async () => {
          const out = await completeDrive(user.id, params.data.id, body.data);
          return { status: 200, body: out };
        },
      );
      logDomain(request.log, 'drives.complete.ok', {
        requestId: request.id,
        userId: shortId(user.id),
        driveId: shortId(params.data.id),
        costCents: body.data.costCents,
      });
      trackEvent({
        name: 'drive.complete',
        userId: user.id,
        requestId: request.id,
        ip: request.ip,
        props: { driveId: params.data.id, costCents: body.data.costCents },
      });
      return reply.status(result.status).send(result.body);
    } catch (err) {
      if (err instanceof AppError) {
        logDomainWarn(request.log, 'drives.complete.fail', {
          requestId: request.id,
          code: err.code,
        });
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
  app.addHook('preHandler', async (request) => {
    requireJsonContentType(request);
  });

  app.get('/', async (request, reply) => {
    try {
      await assertClientLimits(request, reply, {
        name: 'balances_list',
        ipLimit: 120,
        userLimit: 60,
        windowSec: 60,
      });
      const user = requireUser(request);
      const { items, totalProfitCents } = await listBalances(user.id);
      return reply.send({ items, totalProfitCents });
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
    const body = z
      .object({
        settlementProofKey: z.string().min(1).max(500).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }
    try {
      await assertClientLimits(request, reply, {
        name: 'balance_settle',
        ipLimit: 40,
        userLimit: 30,
        windowSec: 3600,
        failClosed: true,
      });
      const user = requireUser(request);
      const balance = await settleBalance(
        user.id,
        params.data.id,
        body.data.settlementProofKey,
      );
      trackEvent({
        name: 'balance.settle',
        userId: user.id,
        requestId: request.id,
        ip: request.ip,
        props: {
          balanceId: params.data.id,
          hasProof: Boolean(body.data.settlementProofKey),
        },
      });
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

  app.get('/', async (request, reply) => {
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'profile_list',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 60,
      });
      const items = await listDriverProfiles(user.id);
      return reply.send({ items });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.post('/:id/favorite', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'profile_favorite',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 60,
        failClosed: true,
      });
      await addFavorite(user.id, params.data.id);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.delete('/:id/favorite', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    try {
      const user = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'profile_unfavorite',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 60,
        failClosed: true,
      });
      await removeFavorite(user.id, params.data.id);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(reply, err.statusCode, err.message, err.code);
      }
      throw err;
    }
  });

  app.get('/:id/history', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_id');
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
      })
      .safeParse(request.query);
    if (!query.success) {
      return sendError(reply, 400, 'Invalid query', 'invalid_query');
    }
    try {
      requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'profile_history',
        ipLimit: 60,
        userLimit: 40,
        windowSec: 60,
      });
      const result = await listDriverTripHistory(params.data.id, {
        ...(query.data.limit != null ? { limit: query.data.limit } : {}),
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      });
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
      const viewer = requireUser(request);
      await assertClientLimits(request, reply, {
        name: 'profile_get',
        ipLimit: 120,
        userLimit: 90,
        windowSec: 60,
      });
      const user = await getDriverProfile(viewer.id, params.data.id);
      return reply.send({
        user: {
          ...user,
          ...(user.favorited ? { isFavorite: true as const } : {}),
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
