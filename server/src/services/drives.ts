import { and, desc, eq, ne, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  applications,
  balances,
  driverProfiles,
  drives,
  users,
} from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { isValidPhone, nextSundayDeadlineNy, normalizePhone } from '../lib/phone.js';
import { getRedis } from '../lib/redis.js';
import { toAuthUser } from './auth.js';

function canSeePassenger(drive: {
  posterId: string;
  assigneeId: string | null;
  status: string;
}, viewerId: string): boolean {
  if (viewerId === drive.posterId) return true;
  if (
    drive.assigneeId === viewerId &&
    (drive.status === 'assigned' || drive.status === 'completed')
  ) {
    return true;
  }
  return false;
}

export type DriveDto = {
  id: string;
  posterId: string;
  routeText: string;
  fromPlace?: string;
  toPlace?: string;
  status: 'open' | 'assigned' | 'completed' | 'cancelled';
  assigneeId?: string;
  passengerPhone?: string;
  address?: string;
  costCents?: number;
  miles?: string;
  waitMinutes?: number;
  completeNote?: string;
  hiddenByPoster: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

function mapDrive(
  row: typeof drives.$inferSelect,
  viewerId: string,
): DriveDto {
  const unlocked = canSeePassenger(row, viewerId);
  return {
    id: row.id,
    posterId: row.posterId,
    routeText: row.routeText,
    ...(row.fromPlace ? { fromPlace: row.fromPlace } : {}),
    ...(row.toPlace ? { toPlace: row.toPlace } : {}),
    status: row.status,
    ...(row.assigneeId ? { assigneeId: row.assigneeId } : {}),
    ...(unlocked ? { passengerPhone: row.passengerPhone } : {}),
    ...(unlocked && row.address ? { address: row.address } : {}),
    ...(row.costCents != null ? { costCents: row.costCents } : {}),
    ...(row.miles != null ? { miles: String(row.miles) } : {}),
    ...(row.waitMinutes != null ? { waitMinutes: row.waitMinutes } : {}),
    ...(row.completeNote ? { completeNote: row.completeNote } : {}),
    hiddenByPoster: row.hiddenByPoster,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
  };
}

export async function createDrive(
  posterId: string,
  input: {
    routeText: string;
    passengerPhone: string;
    address?: string;
    fromPlace?: string;
    toPlace?: string;
  },
): Promise<DriveDto> {
  const [poster] = await db
    .select()
    .from(users)
    .where(eq(users.id, posterId))
    .limit(1);
  if (!poster) throw new AppError(404, 'User not found', 'user_not_found');
  if (poster.status === 'locked') {
    throw new AppError(403, 'Account locked until balances are settled.', 'account_locked');
  }
  if (!poster.onboardingComplete) {
    throw new AppError(403, 'Complete onboarding first', 'onboarding_required');
  }

  const routeText = input.routeText.trim();
  if (routeText.length < 2 || routeText.length > 200) {
    throw new AppError(400, 'Enter a valid route', 'invalid_route');
  }
  if (!isValidPhone(input.passengerPhone)) {
    throw new AppError(400, 'Enter a valid passenger phone', 'invalid_passenger_phone');
  }
  const address = input.address?.trim() || undefined;
  if (address && address.length > 300) {
    throw new AppError(400, 'Address is too long', 'invalid_address');
  }

  const [row] = await db
    .insert(drives)
    .values({
      posterId,
      routeText,
      passengerPhone: normalizePhone(input.passengerPhone),
      address,
      fromPlace: input.fromPlace?.trim() || undefined,
      toPlace: input.toPlace?.trim() || undefined,
    })
    .returning();
  if (!row) throw new AppError(500, 'Could not create drive', 'create_failed');
  await getRedis().del('board:open');
  return mapDrive(row, posterId);
}

export async function listDrives(
  viewerId: string,
  query: { status?: string; completed?: boolean; limit?: number; cursor?: string },
): Promise<{ items: DriveDto[]; nextCursor?: string }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const conditions = [];

  if (query.completed) {
    conditions.push(eq(drives.status, 'completed'));
    conditions.push(eq(drives.hiddenByPoster, false));
  } else if (query.status === 'open') {
    conditions.push(eq(drives.status, 'open'));
  } else if (query.status === 'assigned') {
    conditions.push(eq(drives.status, 'assigned'));
  } else if (query.status === 'mine') {
    conditions.push(
      sql`(${drives.posterId} = ${viewerId} OR ${drives.assigneeId} = ${viewerId})`,
    );
  } else {
    conditions.push(eq(drives.status, 'open'));
  }

  const rows = await db
    .select()
    .from(drives)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(drives.createdAt))
    .limit(limit + 1);

  const slice = rows.slice(0, limit);
  return {
    items: slice.map((r) => mapDrive(r, viewerId)),
    ...(rows.length > limit
      ? { nextCursor: slice[slice.length - 1]?.createdAt.toISOString() }
      : {}),
  };
}

export async function getDrive(viewerId: string, driveId: string): Promise<DriveDto> {
  const [row] = await db.select().from(drives).where(eq(drives.id, driveId)).limit(1);
  if (!row) throw new AppError(404, 'Drive not found', 'drive_not_found');
  return mapDrive(row, viewerId);
}

export async function applyToDrive(
  driverId: string,
  driveId: string,
  input: { lat?: number; lng?: number },
) {
  const [driver] = await db.select().from(users).where(eq(users.id, driverId)).limit(1);
  if (!driver) throw new AppError(404, 'User not found', 'user_not_found');
  if (driver.status === 'locked') {
    throw new AppError(403, 'Account locked until balances are settled.', 'account_locked');
  }
  if (!driver.onboardingComplete) {
    throw new AppError(403, 'Complete onboarding first', 'onboarding_required');
  }

  const [drive] = await db.select().from(drives).where(eq(drives.id, driveId)).limit(1);
  if (!drive) throw new AppError(404, 'Drive not found', 'drive_not_found');
  if (drive.status !== 'open') {
    throw new AppError(409, 'Drive is not open', 'drive_not_open');
  }
  if (drive.posterId === driverId) {
    throw new AppError(400, 'Cannot apply to your own drive', 'cannot_self_apply');
  }

  try {
    const [app] = await db
      .insert(applications)
      .values({
        driveId,
        driverId,
        lat: input.lat != null ? String(input.lat) : undefined,
        lng: input.lng != null ? String(input.lng) : undefined,
      })
      .returning();
    return app;
  } catch {
    throw new AppError(409, 'Already applied', 'already_applied');
  }
}

export async function listApplications(posterId: string, driveId: string) {
  const [drive] = await db.select().from(drives).where(eq(drives.id, driveId)).limit(1);
  if (!drive) throw new AppError(404, 'Drive not found', 'drive_not_found');
  if (drive.posterId !== posterId) {
    throw new AppError(403, 'Only the poster can view applications', 'forbidden');
  }

  const rows = await db
    .select({
      application: applications,
      user: users,
      profile: driverProfiles,
    })
    .from(applications)
    .innerJoin(users, eq(applications.driverId, users.id))
    .leftJoin(driverProfiles, eq(driverProfiles.userId, users.id))
    .where(eq(applications.driveId, driveId))
    .orderBy(desc(applications.createdAt));

  return Promise.all(
    rows.map(async (r) => ({
      id: r.application.id,
      status: r.application.status,
      lat: r.application.lat ? Number(r.application.lat) : undefined,
      lng: r.application.lng ? Number(r.application.lng) : undefined,
      createdAt: r.application.createdAt.toISOString(),
      driver: await toAuthUser(r.user.id),
    })),
  );
}

export async function acceptApplication(
  posterId: string,
  driveId: string,
  applicationId: string,
): Promise<DriveDto> {
  return db.transaction(async (tx) => {
    const [drive] = await tx
      .select()
      .from(drives)
      .where(eq(drives.id, driveId))
      .for('update');
    if (!drive) throw new AppError(404, 'Drive not found', 'drive_not_found');
    if (drive.posterId !== posterId) {
      throw new AppError(403, 'Only the poster can accept', 'forbidden');
    }
    if (drive.status !== 'open') {
      throw new AppError(409, 'Drive is not open', 'drive_not_open');
    }

    const [app] = await tx
      .select()
      .from(applications)
      .where(
        and(eq(applications.id, applicationId), eq(applications.driveId, driveId)),
      )
      .for('update');
    if (!app || app.status !== 'pending') {
      throw new AppError(404, 'Application not found', 'application_not_found');
    }

    await tx
      .update(applications)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(applications.id, app.id));
    await tx
      .update(applications)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(
        and(
          eq(applications.driveId, driveId),
          ne(applications.id, app.id),
          eq(applications.status, 'pending'),
        ),
      );
    const [updated] = await tx
      .update(drives)
      .set({
        status: 'assigned',
        assigneeId: app.driverId,
        updatedAt: new Date(),
      })
      .where(eq(drives.id, driveId))
      .returning();
    if (!updated) throw new AppError(500, 'Accept failed', 'accept_failed');
    await getRedis().del('board:open');
    return mapDrive(updated, posterId);
  });
}

export async function unassignDrive(
  posterId: string,
  driveId: string,
): Promise<DriveDto> {
  return db.transaction(async (tx) => {
    const [drive] = await tx
      .select()
      .from(drives)
      .where(eq(drives.id, driveId))
      .for('update');
    if (!drive) throw new AppError(404, 'Drive not found', 'drive_not_found');
    if (drive.posterId !== posterId) {
      throw new AppError(403, 'Only the poster can unassign', 'forbidden');
    }
    if (drive.status !== 'assigned') {
      throw new AppError(409, 'Drive is not assigned', 'drive_not_assigned');
    }

    await tx
      .update(applications)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(
        and(
          eq(applications.driveId, driveId),
          eq(applications.status, 'accepted'),
        ),
      );

    const [updated] = await tx
      .update(drives)
      .set({
        status: 'open',
        assigneeId: null,
        updatedAt: new Date(),
      })
      .where(eq(drives.id, driveId))
      .returning();
    if (!updated) throw new AppError(500, 'Unassign failed', 'unassign_failed');
    await getRedis().del('board:open');
    return mapDrive(updated, posterId);
  });
}

export async function completeDrive(
  actorId: string,
  driveId: string,
  input: {
    costCents: number;
    miles?: number;
    waitMinutes?: number;
    note?: string;
  },
): Promise<{ drive: DriveDto; balanceId: string }> {
  if (
    !Number.isInteger(input.costCents) ||
    input.costCents < 0 ||
    input.costCents > 1_000_000_00
  ) {
    throw new AppError(400, 'Enter a valid cost', 'invalid_cost');
  }

  return db.transaction(async (tx) => {
    const [drive] = await tx
      .select()
      .from(drives)
      .where(eq(drives.id, driveId))
      .for('update');
    if (!drive) throw new AppError(404, 'Drive not found', 'drive_not_found');
    if (drive.status !== 'assigned') {
      throw new AppError(409, 'Drive must be assigned to complete', 'invalid_status');
    }
    if (drive.posterId !== actorId && drive.assigneeId !== actorId) {
      throw new AppError(403, 'Not allowed to complete this drive', 'forbidden');
    }
    if (!drive.assigneeId) {
      throw new AppError(409, 'No assignee', 'no_assignee');
    }

    const amountCents = Math.round(input.costCents * 0.1);
    const dueSunday = nextSundayDeadlineNy();

    const [updated] = await tx
      .update(drives)
      .set({
        status: 'completed',
        costCents: input.costCents,
        miles: input.miles != null ? String(input.miles) : undefined,
        waitMinutes: input.waitMinutes,
        completeNote: input.note?.trim() || undefined,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(drives.id, driveId))
      .returning();
    if (!updated) throw new AppError(500, 'Complete failed', 'complete_failed');

    const [balance] = await tx
      .insert(balances)
      .values({
        driveId,
        posterId: drive.posterId,
        driverId: drive.assigneeId,
        amountCents,
        dueSunday,
      })
      .returning();
    if (!balance) throw new AppError(500, 'Balance create failed', 'balance_failed');

    return { drive: mapDrive(updated, actorId), balanceId: balance.id };
  });
}

export async function hideDrive(posterId: string, driveId: string): Promise<DriveDto> {
  const [drive] = await db.select().from(drives).where(eq(drives.id, driveId)).limit(1);
  if (!drive) throw new AppError(404, 'Drive not found', 'drive_not_found');
  if (drive.posterId !== posterId) {
    throw new AppError(403, 'Only the poster can hide', 'forbidden');
  }
  if (drive.status !== 'completed') {
    throw new AppError(409, 'Only completed drives can be hidden', 'invalid_status');
  }
  const [updated] = await db
    .update(drives)
    .set({ hiddenByPoster: true, updatedAt: new Date() })
    .where(eq(drives.id, driveId))
    .returning();
  if (!updated) throw new AppError(500, 'Hide failed', 'hide_failed');
  return mapDrive(updated, posterId);
}

export async function settleBalance(posterId: string, balanceId: string) {
  return db.transaction(async (tx) => {
    const [balance] = await tx
      .select()
      .from(balances)
      .where(eq(balances.id, balanceId))
      .for('update');
    if (!balance) throw new AppError(404, 'Balance not found', 'balance_not_found');
    if (balance.posterId !== posterId) {
      throw new AppError(403, 'Only the poster can settle', 'forbidden');
    }
    if (balance.status === 'settled') {
      return balance;
    }
    const [updated] = await tx
      .update(balances)
      .set({ status: 'settled', settledAt: new Date() })
      .where(eq(balances.id, balanceId))
      .returning();
    if (!updated) throw new AppError(500, 'Settle failed', 'settle_failed');

    // Unlock driver if no other open past-due balances remain
    const openCount = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(balances)
      .where(
        and(eq(balances.driverId, balance.driverId), eq(balances.status, 'open')),
      );
    if ((openCount[0]?.c ?? 0) === 0) {
      await tx
        .update(users)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(users.id, balance.driverId));
    } else {
      // also unlock if remaining opens are not yet past due — worker handles lock
      const pastDue = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(balances)
        .where(
          and(
            eq(balances.driverId, balance.driverId),
            eq(balances.status, 'open'),
            sql`${balances.dueSunday} < now()`,
          ),
        );
      if ((pastDue[0]?.c ?? 0) === 0) {
        await tx
          .update(users)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(users.id, balance.driverId));
      }
    }
    return updated;
  });
}

export async function listBalances(userId: string) {
  const rows = await db
    .select()
    .from(balances)
    .where(sql`${balances.posterId} = ${userId} OR ${balances.driverId} = ${userId}`)
    .orderBy(desc(balances.createdAt))
    .limit(100);
  return rows.map((b) => ({
    id: b.id,
    driveId: b.driveId,
    posterId: b.posterId,
    driverId: b.driverId,
    amountCents: b.amountCents,
    status: b.status,
    dueSunday: b.dueSunday.toISOString(),
    settledAt: b.settledAt?.toISOString(),
    createdAt: b.createdAt.toISOString(),
  }));
}
