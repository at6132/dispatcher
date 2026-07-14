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
import { isUniqueViolation, withLock } from '../lib/locks.js';
import { isValidPhone, nextSundayDeadlineNy, normalizePhone } from '../lib/phone.js';
import { getRedis } from '../lib/redis.js';
import { toAuthUser, toPublicProfile } from './auth.js';

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
  vehicleClass: 'sedan' | 'suv' | 'large_suv' | 'minivan' | 'sprinter';
  seats: number;
  tripType: 'one_way' | 'round_trip';
  extraInfo?: string;
  costCents?: number;
  miles?: string;
  waitMinutes?: number;
  completeNote?: string;
  hiddenByPoster: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

/** Board list row — drive + public party profiles for the feed. */
export type DriveListItemDto = DriveDto & {
  poster: Awaited<ReturnType<typeof toPublicProfile>>;
  assignee?: Awaited<ReturnType<typeof toPublicProfile>>;
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
    vehicleClass: row.vehicleClass,
    seats: row.seats,
    tripType: row.tripType,
    ...(row.extraInfo ? { extraInfo: row.extraInfo } : {}),
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

const vehicleClasses = [
  'sedan',
  'suv',
  'large_suv',
  'minivan',
  'sprinter',
] as const;

const tripTypes = ['one_way', 'round_trip'] as const;

export async function createDrive(
  posterId: string,
  input: {
    routeText: string;
    passengerPhone: string;
    vehicleClass: (typeof vehicleClasses)[number];
    seats: number;
    tripType: (typeof tripTypes)[number];
    address?: string;
    extraInfo?: string;
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
    throw new AppError(400, 'Enter a valid title', 'invalid_route');
  }
  if (!isValidPhone(input.passengerPhone)) {
    throw new AppError(400, 'Enter a valid passenger phone', 'invalid_passenger_phone');
  }
  if (!vehicleClasses.includes(input.vehicleClass)) {
    throw new AppError(400, 'Pick a vehicle class', 'invalid_vehicle_class');
  }
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 20) {
    throw new AppError(400, 'Enter a valid seat count', 'invalid_seats');
  }
  if (!tripTypes.includes(input.tripType)) {
    throw new AppError(400, 'Pick one way or round trip', 'invalid_trip_type');
  }
  const address = input.address?.trim() || undefined;
  if (address && address.length > 300) {
    throw new AppError(400, 'Address is too long', 'invalid_address');
  }
  const extraInfo = input.extraInfo?.trim() || undefined;
  if (extraInfo && extraInfo.length > 1000) {
    throw new AppError(400, 'Extra info is too long', 'invalid_extra_info');
  }

  const [row] = await db
    .insert(drives)
    .values({
      posterId,
      routeText,
      passengerPhone: normalizePhone(input.passengerPhone),
      vehicleClass: input.vehicleClass,
      seats: input.seats,
      tripType: input.tripType,
      address,
      extraInfo,
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
): Promise<{ items: DriveListItemDto[]; nextCursor?: string }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const conditions = [];

  if (query.completed) {
    // Public completed feed (hidden excluded) — intentional product rule
    conditions.push(eq(drives.status, 'completed'));
    conditions.push(eq(drives.hiddenByPoster, false));
  } else if (query.status === 'open') {
    conditions.push(eq(drives.status, 'open'));
  } else if (query.status === 'assigned' || query.status === 'active') {
    // Active / scheduled for the viewer — assigned drives they're in
    conditions.push(eq(drives.status, 'assigned'));
    conditions.push(
      sql`(${drives.posterId} = ${viewerId} OR ${drives.assigneeId} = ${viewerId})`,
    );
  } else if (query.status === 'history') {
    // Viewer's completed drives (posted or driven) — includes hidden-from-public
    conditions.push(eq(drives.status, 'completed'));
    conditions.push(
      sql`(${drives.posterId} = ${viewerId} OR ${drives.assigneeId} = ${viewerId})`,
    );
  } else if (query.status === 'mine') {
    conditions.push(
      sql`(${drives.posterId} = ${viewerId} OR ${drives.assigneeId} = ${viewerId})`,
    );
  } else {
    conditions.push(eq(drives.status, 'open'));
  }

  if (query.cursor) {
    const cursorDate = new Date(query.cursor);
    if (!Number.isNaN(cursorDate.getTime())) {
      conditions.push(sql`${drives.createdAt} < ${cursorDate}`);
    }
  }

  const rows = await db
    .select()
    .from(drives)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(drives.createdAt))
    .limit(limit + 1);

  const slice = rows.slice(0, limit);
  const profileIds = new Set<string>();
  for (const row of slice) {
    profileIds.add(row.posterId);
    if (row.assigneeId) profileIds.add(row.assigneeId);
  }

  const profiles = new Map<string, Awaited<ReturnType<typeof toPublicProfile>>>();
  await Promise.all(
    [...profileIds].map(async (id) => {
      try {
        profiles.set(id, await toPublicProfile(id));
      } catch {
        // Skip missing profiles — list still returns the drive
      }
    }),
  );

  const items: DriveListItemDto[] = slice.map((row) => {
    const poster = profiles.get(row.posterId) ?? {
      id: row.posterId,
      name: 'Driver',
      onboardingComplete: false,
    };
    const assignee = row.assigneeId ? profiles.get(row.assigneeId) : undefined;
    return {
      ...mapDrive(row, viewerId),
      poster,
      ...(assignee ? { assignee } : {}),
    };
  });

  return {
    items,
    ...(rows.length > limit
      ? { nextCursor: slice[slice.length - 1]?.createdAt.toISOString() }
      : {}),
  };
}

export async function getDrive(viewerId: string, driveId: string): Promise<DriveDto> {
  const [row] = await db.select().from(drives).where(eq(drives.id, driveId)).limit(1);
  if (!row) throw new AppError(404, 'Drive not found', 'drive_not_found');

  const isParty = row.posterId === viewerId || row.assigneeId === viewerId;
  // Open board is public to authenticated users; assigned/completed only to parties
  // (completed also visible on public completed feed, but detail still party-or-completed)
  if (row.status === 'open') {
    return mapDrive(row, viewerId);
  }
  if (row.status === 'completed' && !row.hiddenByPoster) {
    return mapDrive(row, viewerId);
  }
  if (!isParty) {
    throw new AppError(404, 'Drive not found', 'drive_not_found');
  }
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

  return withLock(`drive:${driveId}:apply`, async () =>
    db.transaction(async (tx) => {
      const [drive] = await tx
        .select()
        .from(drives)
        .where(eq(drives.id, driveId))
        .for('update');
      if (!drive) throw new AppError(404, 'Drive not found', 'drive_not_found');
      if (drive.status !== 'open') {
        throw new AppError(409, 'Drive is not open', 'drive_not_open');
      }
      if (drive.posterId === driverId) {
        throw new AppError(400, 'Cannot apply to your own drive', 'cannot_self_apply');
      }

      try {
        const [app] = await tx
          .insert(applications)
          .values({
            driveId,
            driverId,
            lat: input.lat != null ? String(input.lat) : undefined,
            lng: input.lng != null ? String(input.lng) : undefined,
          })
          .returning();
        return app;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(409, 'Already applied', 'already_applied');
        }
        throw err;
      }
    }),
  );
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
    rows.map(async (r) => {
      const profile = await toPublicProfile(r.user.id);
      return {
        id: r.application.id,
        status: r.application.status,
        lat: r.application.lat ? Number(r.application.lat) : undefined,
        lng: r.application.lng ? Number(r.application.lng) : undefined,
        createdAt: r.application.createdAt.toISOString(),
        // Poster-only context: driver phone is needed to coordinate after accept UX
        driver: { ...profile, phone: r.user.phone },
      };
    }),
  );
}

export async function acceptApplication(
  posterId: string,
  driveId: string,
  applicationId: string,
): Promise<DriveDto> {
  return withLock(`drive:${driveId}:mutate`, async () =>
    db.transaction(async (tx) => {
      // Lock drive first (consistent order → no deadlocks with unassign/complete)
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

      const [claimed] = await tx
        .update(applications)
        .set({ status: 'accepted', updatedAt: new Date() })
        .where(
          and(eq(applications.id, app.id), eq(applications.status, 'pending')),
        )
        .returning();
      if (!claimed) {
        throw new AppError(409, 'Application already handled', 'application_conflict');
      }

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

      // Conditional status transition — second accept loses
      const [updated] = await tx
        .update(drives)
        .set({
          status: 'assigned',
          assigneeId: app.driverId,
          updatedAt: new Date(),
        })
        .where(and(eq(drives.id, driveId), eq(drives.status, 'open')))
        .returning();
      if (!updated) {
        throw new AppError(409, 'Drive is not open', 'drive_not_open');
      }
      await getRedis().del('board:open');
      return mapDrive(updated, posterId);
    }),
  );
}

export async function unassignDrive(
  posterId: string,
  driveId: string,
): Promise<DriveDto> {
  return withLock(`drive:${driveId}:mutate`, async () =>
    db.transaction(async (tx) => {
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
        .where(and(eq(drives.id, driveId), eq(drives.status, 'assigned')))
        .returning();
      if (!updated) {
        throw new AppError(409, 'Drive is not assigned', 'drive_not_assigned');
      }
      await getRedis().del('board:open');
      return mapDrive(updated, posterId);
    }),
  );
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

  return withLock(`drive:${driveId}:mutate`, async () =>
    db.transaction(async (tx) => {
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
        .where(and(eq(drives.id, driveId), eq(drives.status, 'assigned')))
        .returning();
      if (!updated) {
        throw new AppError(409, 'Drive must be assigned to complete', 'invalid_status');
      }

      try {
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
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(409, 'Drive already completed', 'already_completed');
        }
        throw err;
      }
    }),
  );
}

export async function hideDrive(posterId: string, driveId: string): Promise<DriveDto> {
  const [updated] = await db
    .update(drives)
    .set({ hiddenByPoster: true, updatedAt: new Date() })
    .where(
      and(
        eq(drives.id, driveId),
        eq(drives.posterId, posterId),
        eq(drives.status, 'completed'),
        eq(drives.hiddenByPoster, false),
      ),
    )
    .returning();
  if (updated) return mapDrive(updated, posterId);

  const [drive] = await db.select().from(drives).where(eq(drives.id, driveId)).limit(1);
  if (!drive) throw new AppError(404, 'Drive not found', 'drive_not_found');
  if (drive.posterId !== posterId) {
    throw new AppError(403, 'Only the poster can hide', 'forbidden');
  }
  if (drive.status !== 'completed') {
    throw new AppError(409, 'Only completed drives can be hidden', 'invalid_status');
  }
  // Already hidden — idempotent success
  return mapDrive(drive, posterId);
}

export async function settleBalance(posterId: string, balanceId: string) {
  return withLock(`balance:${balanceId}:settle`, async () =>
    db.transaction(async (tx) => {
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
        .where(and(eq(balances.id, balanceId), eq(balances.status, 'open')))
        .returning();
      if (!updated) {
        // Lost race — re-read settled row
        const [again] = await tx
          .select()
          .from(balances)
          .where(eq(balances.id, balanceId))
          .limit(1);
        if (again?.status === 'settled') return again;
        throw new AppError(409, 'Balance could not be settled', 'settle_conflict');
      }

      // Unlock driver only if no open past-due balances remain
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
      return updated;
    }),
  );
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
