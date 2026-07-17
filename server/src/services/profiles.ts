import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { driverProfiles, drives, favorites, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import {
  loadPublicProfiles,
  toAuthUser,
  toPublicProfile,
  type PublicProfileDto,
} from './auth.js';

export type DriverAvailability = 'available' | 'busy' | 'offline';

export type ProfileListItemDto = PublicProfileDto & {
  favorited: boolean;
};

/** Public completed trips a driver has taken (assignee) — no passenger PII. */
export type ProfileTripHistoryItemDto = {
  id: string;
  routeText: string;
  tripType: 'one_way' | 'round_trip';
  costCents?: number;
  completedAt?: string;
  createdAt: string;
};

export async function listDriverProfiles(
  viewerId: string,
  opts?: { limit?: number; offset?: number },
): Promise<{ items: ProfileListItemDto[]; nextOffset?: number }> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 50);
  const offset = Math.max(opts?.offset ?? 0, 0);

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.onboardingComplete, true), ne(users.id, viewerId)))
    .orderBy(asc(users.name), asc(users.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);

  let favSet = new Set<string>();
  try {
    const favRows = await db
      .select({ favoriteUserId: favorites.favoriteUserId })
      .from(favorites)
      .where(eq(favorites.ownerId, viewerId));
    favSet = new Set(favRows.map((r) => r.favoriteUserId));
  } catch {
    // Favorites table not migrated yet — list still works
  }

  const profiles = await loadPublicProfiles(pageRows.map((r) => r.id));
  const items: ProfileListItemDto[] = [];
  for (const row of pageRows) {
    const profile = profiles.get(row.id);
    if (!profile) continue;
    items.push({
      ...profile,
      favorited: favSet.has(row.id),
    });
  }

  items.sort((a, b) => {
    if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    items,
    ...(hasMore ? { nextOffset: offset + limit } : {}),
  };
}

export async function getDriverProfile(
  viewerId: string,
  profileUserId: string,
): Promise<ProfileListItemDto> {
  const profile = await toPublicProfile(profileUserId);
  const favSet = await favoriteIdsFor(viewerId);
  return {
    ...profile,
    favorited: favSet.has(profileUserId),
  };
}

/**
 * Completed drives this driver took. Hidden-by-poster trips stay off public profiles.
 */
export async function listDriverTripHistory(
  profileUserId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<{ items: ProfileTripHistoryItemDto[]; nextCursor?: string }> {
  const [target] = await db
    .select({ id: users.id, onboardingComplete: users.onboardingComplete })
    .from(users)
    .where(eq(users.id, profileUserId))
    .limit(1);
  if (!target || !target.onboardingComplete) {
    throw new AppError(404, 'Driver not found', 'user_not_found');
  }

  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 50);
  const conditions = [
    eq(drives.status, 'completed'),
    eq(drives.assigneeId, profileUserId),
    eq(drives.hiddenByPoster, false),
  ];

  if (opts?.cursor) {
    const cursorDate = new Date(opts.cursor);
    if (!Number.isNaN(cursorDate.getTime())) {
      conditions.push(sql`${drives.completedAt} < ${cursorDate}`);
    }
  }

  const rows = await db
    .select({
      id: drives.id,
      routeText: drives.routeText,
      tripType: drives.tripType,
      costCents: drives.costCents,
      completedAt: drives.completedAt,
      createdAt: drives.createdAt,
    })
    .from(drives)
    .where(and(...conditions))
    .orderBy(desc(drives.completedAt), desc(drives.createdAt))
    .limit(limit + 1);

  const slice = rows.slice(0, limit);
  const items: ProfileTripHistoryItemDto[] = slice.map((row) => ({
    id: row.id,
    routeText: row.routeText,
    tripType: row.tripType,
    ...(row.costCents != null ? { costCents: row.costCents } : {}),
    ...(row.completedAt
      ? { completedAt: row.completedAt.toISOString() }
      : {}),
    createdAt: row.createdAt.toISOString(),
  }));

  const last = slice[slice.length - 1];
  const nextCursor =
    rows.length > limit && last?.completedAt
      ? last.completedAt.toISOString()
      : undefined;

  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export async function addFavorite(
  userId: string,
  favoriteUserId: string,
): Promise<void> {
  if (userId === favoriteUserId) {
    throw new AppError(400, 'Cannot favorite yourself', 'invalid_favorite');
  }
  const [target] = await db
    .select({ id: users.id, onboardingComplete: users.onboardingComplete })
    .from(users)
    .where(eq(users.id, favoriteUserId))
    .limit(1);
  if (!target || !target.onboardingComplete) {
    throw new AppError(404, 'Driver not found', 'user_not_found');
  }

  try {
    await db.insert(favorites).values({ ownerId: userId, favoriteUserId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/favorites/i.test(message) && /does not exist/i.test(message)) {
      throw new AppError(
        503,
        'Favorites aren’t ready yet. Update the server and try again.',
        'favorites_unavailable',
      );
    }
    // Unique — already favorited
  }
}

export async function removeFavorite(
  userId: string,
  favoriteUserId: string,
): Promise<void> {
  await db
    .delete(favorites)
    .where(
      and(
        eq(favorites.ownerId, userId),
        eq(favorites.favoriteUserId, favoriteUserId),
      ),
    );
}

export async function favoriteIdsFor(userId: string): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ favoriteUserId: favorites.favoriteUserId })
      .from(favorites)
      .where(eq(favorites.ownerId, userId));
    return new Set(rows.map((r) => r.favoriteUserId));
  } catch {
    return new Set();
  }
}

export async function updatePresence(
  userId: string,
  input: {
    availability?: DriverAvailability;
    lat?: number;
    lng?: number;
  },
) {
  const [profile] = await db
    .select({ userId: driverProfiles.userId })
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);
  if (!profile) {
    throw new AppError(403, 'Complete onboarding first', 'onboarding_required');
  }

  const patch: Partial<typeof driverProfiles.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.availability) {
    patch.availability = input.availability;
  }

  const hasCoords =
    input.lat != null &&
    input.lng != null &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng);
  if (hasCoords) {
    if (
      input.lat! < -90 ||
      input.lat! > 90 ||
      input.lng! < -180 ||
      input.lng! > 180
    ) {
      throw new AppError(400, 'Invalid location', 'invalid_location');
    }
    patch.lastLat = String(input.lat);
    patch.lastLng = String(input.lng);
    patch.locationUpdatedAt = new Date();
  }

  if (input.availability == null && !hasCoords) {
    throw new AppError(400, 'Nothing to update', 'invalid_body');
  }

  await db
    .update(driverProfiles)
    .set(patch)
    .where(eq(driverProfiles.userId, userId));

  return toAuthUser(userId);
}
