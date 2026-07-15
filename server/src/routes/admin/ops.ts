import type { FastifyPluginAsync } from 'fastify';
import { and, count, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../../db/client.js';
import {
  adminSessions,
  analyticsEvents,
  applications,
  auditEvents,
  balances,
  driverProfiles,
  drives,
  refreshTokens,
  securityEvents,
  users,
} from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { hashPassword } from '../../lib/crypto.js';
import { sendError } from '../../lib/errors.js';
import {
  requireAdmin,
  requireAdminSession,
} from '../../middleware/adminAuth.js';
import { revokeAdminSession, revokeAllAdminSessions } from '../../services/adminAuth.js';
import { notifyDriveStatusChange } from '../../services/pushNotifications.js';

function parseLimit(raw: unknown, fallback = 50, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export const adminOpsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin);

  app.get('/stats', async (request, reply) => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      activeUsers,
      lockedUsers,
      openDrives,
      assignedDrives,
      completedToday,
      pendingApps,
      openBalances,
      overdueBalances,
      failedAdminLogins,
      recentSecurity,
    ] = await Promise.all([
      db.select({ n: count() }).from(users).where(eq(users.status, 'active')),
      db.select({ n: count() }).from(users).where(eq(users.status, 'locked')),
      db.select({ n: count() }).from(drives).where(eq(drives.status, 'open')),
      db
        .select({ n: count() })
        .from(drives)
        .where(eq(drives.status, 'assigned')),
      db
        .select({ n: count() })
        .from(drives)
        .where(
          and(eq(drives.status, 'completed'), gte(drives.completedAt, startOfDay)),
        ),
      db
        .select({ n: count() })
        .from(applications)
        .where(eq(applications.status, 'pending')),
      db
        .select({
          n: count(),
          cents: sql<number>`coalesce(sum(${balances.amountCents}), 0)`,
        })
        .from(balances)
        .where(eq(balances.status, 'open')),
      db
        .select({ n: count() })
        .from(balances)
        .where(
          and(
            eq(balances.status, 'open'),
            sql`${balances.dueSunday} < now()`,
          ),
        ),
      db
        .select({ n: count() })
        .from(securityEvents)
        .where(
          and(
            eq(securityEvents.kind, 'admin_password_fail'),
            gte(securityEvents.at, dayAgo),
          ),
        ),
      db
        .select()
        .from(securityEvents)
        .orderBy(desc(securityEvents.at))
        .limit(12),
    ]);

    return reply.send({
      users: {
        active: Number(activeUsers[0]?.n ?? 0),
        locked: Number(lockedUsers[0]?.n ?? 0),
      },
      drives: {
        open: Number(openDrives[0]?.n ?? 0),
        assigned: Number(assignedDrives[0]?.n ?? 0),
        completedToday: Number(completedToday[0]?.n ?? 0),
      },
      applications: { pending: Number(pendingApps[0]?.n ?? 0) },
      balances: {
        openCount: Number(openBalances[0]?.n ?? 0),
        openCents: Number(openBalances[0]?.cents ?? 0),
        overdueCount: Number(overdueBalances[0]?.n ?? 0),
      },
      security: {
        failedAdminLogins24h: Number(failedAdminLogins[0]?.n ?? 0),
        recent: recentSecurity,
      },
    });
  });

  // ---- Users ----
  app.get('/users', async (request, reply) => {
    const q = z
      .object({
        q: z.string().optional(),
        status: z.enum(['active', 'locked']).optional(),
        onboarding: z.enum(['complete', 'incomplete']).optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return sendError(reply, 400, 'Invalid query', 'invalid_body');

    const limit = parseLimit(q.data.limit);
    const offset = Math.max(0, Number(q.data.offset ?? 0));
    const filters = [];
    if (q.data.status) filters.push(eq(users.status, q.data.status));
    if (q.data.onboarding === 'complete') {
      filters.push(eq(users.onboardingComplete, true));
    }
    if (q.data.onboarding === 'incomplete') {
      filters.push(eq(users.onboardingComplete, false));
    }
    if (q.data.q?.trim()) {
      const term = `%${q.data.q.trim()}%`;
      filters.push(
        or(
          ilike(users.phone, term),
          ilike(users.name, term),
          sql`${users.id}::text ilike ${term}`,
        )!,
      );
    }

    const where = filters.length ? and(...filters) : undefined;
    const rows = await db
      .select({
        id: users.id,
        phone: users.phone,
        name: users.name,
        status: users.status,
        onboardingComplete: users.onboardingComplete,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        vehicleType: driverProfiles.vehicleType,
        vehicleClass: driverProfiles.vehicleClass,
      })
      .from(users)
      .leftJoin(driverProfiles, eq(driverProfiles.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.users.list',
      requestId: request.id,
      ip: request.ip,
      meta: { q: q.data.q, count: rows.length },
    });

    return reply.send({ items: rows, limit, offset });
  });

  app.get('/users/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_body');

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, params.data.id))
      .limit(1);
    if (!user) return sendError(reply, 404, 'User not found', 'not_found');

    const [profile] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, user.id))
      .limit(1);

    const posted = await db
      .select()
      .from(drives)
      .where(eq(drives.posterId, user.id))
      .orderBy(desc(drives.createdAt))
      .limit(40);
    const taken = await db
      .select()
      .from(drives)
      .where(eq(drives.assigneeId, user.id))
      .orderBy(desc(drives.createdAt))
      .limit(40);
    const userBalances = await db
      .select()
      .from(balances)
      .where(
        or(eq(balances.driverId, user.id), eq(balances.posterId, user.id))!,
      )
      .orderBy(desc(balances.createdAt))
      .limit(40);
    const tokens = await db
      .select({
        id: refreshTokens.id,
        familyId: refreshTokens.familyId,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        createdAt: refreshTokens.createdAt,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id))
      .orderBy(desc(refreshTokens.createdAt))
      .limit(20);

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.users.get',
      entityType: 'user',
      entityId: user.id,
      requestId: request.id,
      ip: request.ip,
    });

    const { passwordHash: _, ...safeUser } = user;
    return reply.send({
      user: safeUser,
      profile: profile ?? null,
      drivesPosted: posted,
      drivesTaken: taken,
      balances: userBalances,
      refreshTokens: tokens,
    });
  });

  app.patch('/users/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        phone: z.string().min(5).max(32).optional(),
        status: z.enum(['active', 'locked']).optional(),
        onboardingComplete: z.boolean().optional(),
        password: z.string().min(6).max(128).optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const [before] = await db
      .select()
      .from(users)
      .where(eq(users.id, params.data.id))
      .limit(1);
    if (!before) return sendError(reply, 404, 'User not found', 'not_found');

    const patch: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.data.name != null) patch.name = body.data.name;
    if (body.data.phone != null) patch.phone = body.data.phone;
    if (body.data.status != null) patch.status = body.data.status;
    if (body.data.onboardingComplete != null) {
      patch.onboardingComplete = body.data.onboardingComplete;
    }
    if (body.data.password) {
      patch.passwordHash = await hashPassword(body.data.password);
    }

    const [after] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, params.data.id))
      .returning();

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.users.patch',
      entityType: 'user',
      entityId: params.data.id,
      requestId: request.id,
      ip: request.ip,
      before: { ...before, passwordHash: '[redacted]' },
      after: after
        ? { ...after, passwordHash: '[redacted]' }
        : undefined,
      meta: { passwordChanged: Boolean(body.data.password) },
    });

    if (!after) return sendError(reply, 500, 'Update failed', 'internal');
    const { passwordHash: _, ...safe } = after;
    return reply.send({ user: safe });
  });

  app.post('/users/:id/revoke-refresh', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_body');

    const rows = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, params.data.id), isNull(refreshTokens.revokedAt)),
      )
      .returning({ id: refreshTokens.id });

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.users.revoke_refresh',
      entityType: 'user',
      entityId: params.data.id,
      requestId: request.id,
      ip: request.ip,
      meta: { revoked: rows.length },
    });

    return reply.send({ revoked: rows.length });
  });

  app.patch('/profiles/:userId', async (request, reply) => {
    const params = z
      .object({ userId: z.string().uuid() })
      .safeParse(request.params);
    const body = z
      .object({
        vehicleClass: z
          .enum(['sedan', 'suv', 'large_suv', 'minivan', 'sprinter'])
          .optional(),
        vehicleType: z.string().min(1).max(80).optional(),
        seats: z.number().int().min(1).max(20).optional(),
        yearsDrivingUpstate: z.number().int().min(0).max(80).optional(),
        zelle: z.string().max(80).nullable().optional(),
        extraInfo: z.string().max(2000).nullable().optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const [before] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, params.data.userId))
      .limit(1);
    if (!before) return sendError(reply, 404, 'Profile not found', 'not_found');

    const [after] = await db
      .update(driverProfiles)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(driverProfiles.userId, params.data.userId))
      .returning();

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.profiles.patch',
      entityType: 'driver_profile',
      entityId: params.data.userId,
      requestId: request.id,
      ip: request.ip,
      before,
      after,
    });

    return reply.send({ profile: after });
  });

  // ---- Drives ----
  app.get('/drives', async (request, reply) => {
    const q = z
      .object({
        q: z.string().optional(),
        status: z
          .enum(['open', 'assigned', 'picked_up', 'completed', 'cancelled'])
          .optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return sendError(reply, 400, 'Invalid query', 'invalid_body');

    const limit = parseLimit(q.data.limit);
    const offset = Math.max(0, Number(q.data.offset ?? 0));
    const filters = [];
    if (q.data.status) filters.push(eq(drives.status, q.data.status));
    if (q.data.q?.trim()) {
      const term = `%${q.data.q.trim()}%`;
      filters.push(
        or(
          ilike(drives.routeText, term),
          ilike(drives.passengerPhone, term),
          sql`${drives.id}::text ilike ${term}`,
        )!,
      );
    }
    const where = filters.length ? and(...filters) : undefined;
    const items = await db
      .select()
      .from(drives)
      .where(where)
      .orderBy(desc(drives.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({ items, limit, offset });
  });

  app.get('/drives/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_body');

    const [drive] = await db
      .select()
      .from(drives)
      .where(eq(drives.id, params.data.id))
      .limit(1);
    if (!drive) return sendError(reply, 404, 'Drive not found', 'not_found');

    const apps = await db
      .select()
      .from(applications)
      .where(eq(applications.driveId, drive.id))
      .orderBy(desc(applications.createdAt));
    const [balance] = await db
      .select()
      .from(balances)
      .where(eq(balances.driveId, drive.id))
      .limit(1);

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.drives.get',
      entityType: 'drive',
      entityId: drive.id,
      requestId: request.id,
      ip: request.ip,
    });

    return reply.send({ drive, applications: apps, balance: balance ?? null });
  });

  app.patch('/drives/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        routeText: z.string().min(1).max(200).optional(),
        passengerPhone: z.string().min(5).max(32).optional(),
        address: z.string().max(400).nullable().optional(),
        tripType: z.enum(['one_way', 'round_trip']).optional(),
        status: z
          .enum(['open', 'assigned', 'picked_up', 'completed', 'cancelled'])
          .optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        costCents: z.number().int().min(0).nullable().optional(),
        hiddenByPoster: z.boolean().optional(),
        extraInfo: z.string().max(2000).nullable().optional(),
        seats: z.number().int().min(1).max(20).optional(),
        vehicleClass: z
          .enum(['sedan', 'suv', 'large_suv', 'minivan', 'sprinter'])
          .optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const [before] = await db
      .select()
      .from(drives)
      .where(eq(drives.id, params.data.id))
      .limit(1);
    if (!before) return sendError(reply, 404, 'Drive not found', 'not_found');

    const [after] = await db
      .update(drives)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(drives.id, params.data.id))
      .returning();

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.drives.patch',
      entityType: 'drive',
      entityId: params.data.id,
      requestId: request.id,
      ip: request.ip,
      before,
      after,
    });

    return reply.send({ drive: after });
  });

  app.post('/drives/:id/cancel', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_body');

    const [before] = await db
      .select()
      .from(drives)
      .where(eq(drives.id, params.data.id))
      .limit(1);
    if (!before) return sendError(reply, 404, 'Drive not found', 'not_found');

    const [after] = await db
      .update(drives)
      .set({
        status: 'cancelled',
        cancelRequestedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(drives.id, params.data.id))
      .returning();

    if (after) {
      notifyDriveStatusChange({
        posterId: after.posterId,
        driveId: after.id,
        routeText: after.routeText,
        status: 'cancelled',
      });
    }

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.drives.cancel',
      entityType: 'drive',
      entityId: params.data.id,
      requestId: request.id,
      ip: request.ip,
      before,
      after,
    });

    return reply.send({ drive: after });
  });

  // ---- Applications ----
  app.get('/applications', async (request, reply) => {
    const q = z
      .object({
        status: z
          .enum(['pending', 'accepted', 'rejected', 'cleared'])
          .optional(),
        driveId: z.string().uuid().optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return sendError(reply, 400, 'Invalid query', 'invalid_body');

    const limit = parseLimit(q.data.limit);
    const offset = Math.max(0, Number(q.data.offset ?? 0));
    const filters = [];
    if (q.data.status) filters.push(eq(applications.status, q.data.status));
    if (q.data.driveId) filters.push(eq(applications.driveId, q.data.driveId));
    const where = filters.length ? and(...filters) : undefined;

    const items = await db
      .select()
      .from(applications)
      .where(where)
      .orderBy(desc(applications.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({ items, limit, offset });
  });

  app.patch('/applications/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        status: z.enum(['pending', 'accepted', 'rejected', 'cleared']),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const [before] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, params.data.id))
      .limit(1);
    if (!before) {
      return sendError(reply, 404, 'Application not found', 'not_found');
    }

    const [after] = await db
      .update(applications)
      .set({ status: body.data.status, updatedAt: new Date() })
      .where(eq(applications.id, params.data.id))
      .returning();

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.applications.patch',
      entityType: 'application',
      entityId: params.data.id,
      requestId: request.id,
      ip: request.ip,
      before,
      after,
    });

    return reply.send({ application: after });
  });

  // ---- Balances ----
  app.get('/balances', async (request, reply) => {
    const q = z
      .object({
        status: z.enum(['open', 'settled']).optional(),
        overdue: z.enum(['1', 'true']).optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return sendError(reply, 400, 'Invalid query', 'invalid_body');

    const limit = parseLimit(q.data.limit);
    const offset = Math.max(0, Number(q.data.offset ?? 0));
    const filters = [];
    if (q.data.status) filters.push(eq(balances.status, q.data.status));
    if (q.data.overdue) {
      filters.push(
        and(eq(balances.status, 'open'), sql`${balances.dueSunday} < now()`)!,
      );
    }
    const where = filters.length ? and(...filters) : undefined;
    const items = await db
      .select()
      .from(balances)
      .where(where)
      .orderBy(desc(balances.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({ items, limit, offset });
  });

  app.post('/balances/:id/settle', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_body');

    const [before] = await db
      .select()
      .from(balances)
      .where(eq(balances.id, params.data.id))
      .limit(1);
    if (!before) return sendError(reply, 404, 'Balance not found', 'not_found');

    const [after] = await db
      .update(balances)
      .set({ status: 'settled', settledAt: new Date() })
      .where(eq(balances.id, params.data.id))
      .returning();

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.balances.settle',
      entityType: 'balance',
      entityId: params.data.id,
      requestId: request.id,
      ip: request.ip,
      before,
      after,
    });

    return reply.send({ balance: after });
  });

  app.patch('/balances/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        amountCents: z.number().int().min(0),
        reason: z.string().min(3).max(500),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, 'Invalid body', 'invalid_body');
    }

    const [before] = await db
      .select()
      .from(balances)
      .where(eq(balances.id, params.data.id))
      .limit(1);
    if (!before) return sendError(reply, 404, 'Balance not found', 'not_found');

    const [after] = await db
      .update(balances)
      .set({ amountCents: body.data.amountCents })
      .where(eq(balances.id, params.data.id))
      .returning();

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.balances.patch',
      entityType: 'balance',
      entityId: params.data.id,
      requestId: request.id,
      ip: request.ip,
      before,
      after,
      meta: { reason: body.data.reason },
    });

    return reply.send({ balance: after });
  });

  // ---- Analytics ----
  app.get('/analytics/events', async (request, reply) => {
    const q = z
      .object({
        name: z.string().optional(),
        userId: z.string().uuid().optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return sendError(reply, 400, 'Invalid query', 'invalid_body');

    const limit = parseLimit(q.data.limit, 100);
    const offset = Math.max(0, Number(q.data.offset ?? 0));
    const filters = [];
    if (q.data.name) filters.push(eq(analyticsEvents.name, q.data.name));
    if (q.data.userId) filters.push(eq(analyticsEvents.userId, q.data.userId));
    const where = filters.length ? and(...filters) : undefined;

    const items = await db
      .select()
      .from(analyticsEvents)
      .where(where)
      .orderBy(desc(analyticsEvents.at))
      .limit(limit)
      .offset(offset);

    return reply.send({ items, limit, offset });
  });

  app.get('/analytics/summary', async (request, reply) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const top = await db
      .select({
        name: analyticsEvents.name,
        n: count(),
      })
      .from(analyticsEvents)
      .where(gte(analyticsEvents.at, since))
      .groupBy(analyticsEvents.name)
      .orderBy(desc(count()))
      .limit(30);

    const dailyRows = await db
      .select({
        day: sql<string>`date_trunc('day', ${analyticsEvents.at})::text`,
        n: count(),
      })
      .from(analyticsEvents)
      .where(gte(analyticsEvents.at, since))
      .groupBy(sql`date_trunc('day', ${analyticsEvents.at})`)
      .orderBy(sql`date_trunc('day', ${analyticsEvents.at})`);

    const funnelNames = [
      'auth.signup',
      'onboarding.complete',
      'drive.create',
      'drive.apply',
      'drive.accept',
      'drive.complete',
    ];
    const funnel = [];
    for (const name of funnelNames) {
      const [row] = await db
        .select({ n: count() })
        .from(analyticsEvents)
        .where(
          and(eq(analyticsEvents.name, name), gte(analyticsEvents.at, since)),
        );
      funnel.push({ name, count: Number(row?.n ?? 0) });
    }

    return reply.send({
      since: since.toISOString(),
      topEvents: top.map((t) => ({ name: t.name, count: Number(t.n) })),
      daily: dailyRows.map((d) => ({ day: d.day, n: Number(d.n) })),
      funnel,
    });
  });

  // ---- Security / Trace ----
  app.get('/security/events', async (request, reply) => {
    const q = z
      .object({
        kind: z.string().optional(),
        severity: z.enum(['info', 'warn', 'critical']).optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return sendError(reply, 400, 'Invalid query', 'invalid_body');

    const limit = parseLimit(q.data.limit, 100);
    const offset = Math.max(0, Number(q.data.offset ?? 0));
    const filters = [];
    if (q.data.kind) filters.push(eq(securityEvents.kind, q.data.kind));
    if (q.data.severity) {
      filters.push(eq(securityEvents.severity, q.data.severity));
    }
    const where = filters.length ? and(...filters) : undefined;
    const items = await db
      .select()
      .from(securityEvents)
      .where(where)
      .orderBy(desc(securityEvents.at))
      .limit(limit)
      .offset(offset);

    return reply.send({ items, limit, offset });
  });

  app.get('/security/trace', async (request, reply) => {
    const q = z
      .object({
        q: z.string().min(2).max(120),
        limit: z.coerce.number().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return sendError(reply, 400, 'Invalid query', 'invalid_body');

    const limit = parseLimit(q.data.limit, 80);
    const term = q.data.q.trim();
    const like = `%${term}%`;

    const [auditHits, securityHits, analyticsHits, userHits] = await Promise.all([
      db
        .select()
        .from(auditEvents)
        .where(
          or(
            ilike(auditEvents.requestId, like),
            ilike(auditEvents.ip, like),
            ilike(auditEvents.entityId, like),
            ilike(auditEvents.actorId, like),
            ilike(auditEvents.action, like),
          )!,
        )
        .orderBy(desc(auditEvents.at))
        .limit(limit),
      db
        .select()
        .from(securityEvents)
        .where(
          or(
            ilike(securityEvents.requestId, like),
            ilike(securityEvents.ip, like),
            ilike(securityEvents.kind, like),
            sql`${securityEvents.userId}::text ilike ${like}`,
            sql`${securityEvents.adminChallengeId}::text ilike ${like}`,
          )!,
        )
        .orderBy(desc(securityEvents.at))
        .limit(limit),
      db
        .select()
        .from(analyticsEvents)
        .where(
          or(
            ilike(analyticsEvents.requestId, like),
            ilike(analyticsEvents.ip, like),
            ilike(analyticsEvents.name, like),
            sql`${analyticsEvents.userId}::text ilike ${like}`,
          )!,
        )
        .orderBy(desc(analyticsEvents.at))
        .limit(limit),
      db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          status: users.status,
        })
        .from(users)
        .where(
          or(
            ilike(users.phone, like),
            ilike(users.name, like),
            sql`${users.id}::text ilike ${like}`,
          )!,
        )
        .limit(20),
    ]);

    const timeline = [
      ...auditHits.map((e) => ({
        source: 'audit' as const,
        at: e.at,
        label: e.action,
        data: e,
      })),
      ...securityHits.map((e) => ({
        source: 'security' as const,
        at: e.at,
        label: e.kind,
        data: e,
      })),
      ...analyticsHits.map((e) => ({
        source: 'analytics' as const,
        at: e.at,
        label: e.name,
        data: e,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.security.trace',
      requestId: request.id,
      ip: request.ip,
      meta: { q: term },
    });

    return reply.send({ query: term, users: userHits, timeline });
  });

  // ---- Audit ----
  app.get('/audit', async (request, reply) => {
    const q = z
      .object({
        action: z.string().optional(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        sessionId: z.string().uuid().optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return sendError(reply, 400, 'Invalid query', 'invalid_body');

    const limit = parseLimit(q.data.limit, 100);
    const offset = Math.max(0, Number(q.data.offset ?? 0));
    const filters = [];
    if (q.data.action) filters.push(ilike(auditEvents.action, `%${q.data.action}%`));
    if (q.data.entityType) {
      filters.push(eq(auditEvents.entityType, q.data.entityType));
    }
    if (q.data.entityId) filters.push(eq(auditEvents.entityId, q.data.entityId));
    if (q.data.sessionId) {
      filters.push(eq(auditEvents.sessionId, q.data.sessionId));
    }
    const where = filters.length ? and(...filters) : undefined;

    const items = await db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.at))
      .limit(limit)
      .offset(offset);

    return reply.send({ items, limit, offset });
  });

  // ---- Admin sessions ----
  app.get('/sessions', async (request, reply) => {
    const items = await db
      .select({
        id: adminSessions.id,
        ip: adminSessions.ip,
        userAgent: adminSessions.userAgent,
        expiresAt: adminSessions.expiresAt,
        revokedAt: adminSessions.revokedAt,
        createdAt: adminSessions.createdAt,
        lastSeenAt: adminSessions.lastSeenAt,
      })
      .from(adminSessions)
      .orderBy(desc(adminSessions.createdAt))
      .limit(100);

    return reply.send({ items });
  });

  app.post('/sessions/:id/revoke', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return sendError(reply, 400, 'Invalid id', 'invalid_body');

    await revokeAdminSession(params.data.id);
    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.sessions.revoke',
      entityType: 'admin_session',
      entityId: params.data.id,
      requestId: request.id,
      ip: request.ip,
    });
    return reply.send({ ok: true });
  });

  app.post('/sessions/revoke-all', async (request, reply) => {
    const n = await revokeAllAdminSessions();
    const session = requireAdminSession(request);
    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.sessions.revoke_all',
      requestId: request.id,
      ip: request.ip,
      meta: { revoked: n },
    });
    return reply.send({ revoked: n });
  });
};
