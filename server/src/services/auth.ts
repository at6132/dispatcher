import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { driverProfiles, drives, refreshTokens, users } from '../db/schema.js';
import {
  hashPassword,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/locks.js';
import {
  isValidPhone,
  normalizePhone,
  passwordMeetsRequirements,
} from '../lib/phone.js';
import { presignGet } from '../lib/s3.js';

export type AuthUserDto = {
  id: string;
  phone: string;
  name: string;
  onboardingComplete: boolean;
  /** Completed jobs where this user was poster or assignee. */
  completedDrivesCount: number;
  onboarding?: {
    vehicleClass: 'sedan' | 'suv' | 'large_suv' | 'minivan' | 'sprinter';
    vehicleType: string;
    seats: number;
    selfPhotoUri?: string;
    vehicleInteriorUri?: string;
    vehicleExteriorUri?: string;
    /** Stable S3 object key — use as image cache key (presigned URLs rotate). */
    selfPhotoKey?: string;
    vehicleInteriorKey?: string;
    vehicleExteriorKey?: string;
    yearsDrivingUpstate: number;
    extraInfo?: string;
    zelle?: string;
  };
  status: 'active' | 'locked';
  availability: 'available' | 'busy' | 'offline';
  lastLat?: number;
  lastLng?: number;
  locationUpdatedAt?: string;
};

async function resolvePhotoUri(
  key: string | null | undefined,
): Promise<string | undefined> {
  if (!key) return undefined;
  // Never treat raw http(s) as storage keys — block URL injection
  if (key.startsWith('http://') || key.startsWith('https://') || key.includes('..')) {
    return undefined;
  }
  if (!env.s3Enabled) return undefined;
  try {
    return await Promise.race([
      presignGet(key),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('presign timeout')), 5000);
      }),
    ]);
  } catch {
    return undefined;
  }
}

export type PublicProfileDto = {
  id: string;
  name: string;
  onboardingComplete: boolean;
  completedDrivesCount: number;
  availability: 'available' | 'busy' | 'offline';
  lastLat?: number;
  lastLng?: number;
  locationUpdatedAt?: string;
  onboarding?: {
    vehicleClass: 'sedan' | 'suv' | 'large_suv' | 'minivan' | 'sprinter';
    vehicleType: string;
    seats: number;
    selfPhotoUri?: string;
    vehicleInteriorUri?: string;
    vehicleExteriorUri?: string;
    /** Stable S3 object key — use as image cache key (presigned URLs rotate). */
    selfPhotoKey?: string;
    vehicleInteriorKey?: string;
    vehicleExteriorKey?: string;
    yearsDrivingUpstate: number;
    extraInfo?: string;
  };
};

/** Jobs marked completed where the user was poster or assignee. */
export async function countCompletedDrives(userId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(drives)
    .where(
      and(
        eq(drives.status, 'completed'),
        or(eq(drives.posterId, userId), eq(drives.assigneeId, userId)),
      ),
    );
  return Number(row?.c ?? 0);
}

function toPublicProfileDto(
  user: {
    id: string;
    name: string;
    onboardingComplete: boolean;
  },
  profile: typeof driverProfiles.$inferSelect | null | undefined,
  completedDrivesCount: number,
  photos: {
    selfPhotoUri?: string;
    vehicleInteriorUri?: string;
    vehicleExteriorUri?: string;
  },
): PublicProfileDto {
  const availability = profile?.availability ?? 'offline';
  // Location only when online (available / busy) — used for direct-send maps.
  const shareLocation = availability === 'available' || availability === 'busy';

  let lastLat: number | undefined;
  let lastLng: number | undefined;
  let locationUpdatedAt: string | undefined;
  if (profile?.lastLat != null && profile?.lastLng != null) {
    const lat = Number(profile.lastLat);
    const lng = Number(profile.lastLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      lastLat = lat;
      lastLng = lng;
    }
  }
  if (profile?.locationUpdatedAt) {
    locationUpdatedAt = profile.locationUpdatedAt.toISOString();
  }

  const dto: PublicProfileDto = {
    id: user.id,
    name: user.name,
    onboardingComplete: user.onboardingComplete,
    completedDrivesCount,
    availability,
    ...(shareLocation && lastLat != null ? { lastLat } : {}),
    ...(shareLocation && lastLng != null ? { lastLng } : {}),
    ...(shareLocation && locationUpdatedAt ? { locationUpdatedAt } : {}),
  };

  if (profile) {
    dto.onboarding = {
      vehicleClass: profile.vehicleClass,
      vehicleType: profile.vehicleType,
      seats: profile.seats,
      yearsDrivingUpstate: profile.yearsDrivingUpstate,
      ...(profile.extraInfo ? { extraInfo: profile.extraInfo } : {}),
      ...(photos.selfPhotoUri ? { selfPhotoUri: photos.selfPhotoUri } : {}),
      ...(photos.vehicleInteriorUri
        ? { vehicleInteriorUri: photos.vehicleInteriorUri }
        : {}),
      ...(photos.vehicleExteriorUri
        ? { vehicleExteriorUri: photos.vehicleExteriorUri }
        : {}),
      ...(profile.selfPhotoKey ? { selfPhotoKey: profile.selfPhotoKey } : {}),
      ...(profile.vehicleInteriorKey
        ? { vehicleInteriorKey: profile.vehicleInteriorKey }
        : {}),
      ...(profile.vehicleExteriorKey
        ? { vehicleExteriorKey: profile.vehicleExteriorKey }
        : {}),
    };
  }

  return dto;
}

/** Safe for other drivers — no phone, zelle, or lock status. */
export async function toPublicProfile(userId: string): Promise<PublicProfileDto> {
  const full = await toAuthUser(userId);
  // Location only when online (available / busy) — used for direct-send maps.
  const shareLocation =
    full.availability === 'available' || full.availability === 'busy';
  return {
    id: full.id,
    name: full.name,
    onboardingComplete: full.onboardingComplete,
    completedDrivesCount: full.completedDrivesCount,
    availability: full.availability,
    ...(shareLocation && full.lastLat != null ? { lastLat: full.lastLat } : {}),
    ...(shareLocation && full.lastLng != null ? { lastLng: full.lastLng } : {}),
    ...(shareLocation && full.locationUpdatedAt
      ? { locationUpdatedAt: full.locationUpdatedAt }
      : {}),
    ...(full.onboarding
      ? {
          onboarding: {
            vehicleClass: full.onboarding.vehicleClass,
            vehicleType: full.onboarding.vehicleType,
            seats: full.onboarding.seats,
            yearsDrivingUpstate: full.onboarding.yearsDrivingUpstate,
            ...(full.onboarding.extraInfo
              ? { extraInfo: full.onboarding.extraInfo }
              : {}),
            ...(full.onboarding.selfPhotoUri
              ? { selfPhotoUri: full.onboarding.selfPhotoUri }
              : {}),
            ...(full.onboarding.vehicleInteriorUri
              ? { vehicleInteriorUri: full.onboarding.vehicleInteriorUri }
              : {}),
            ...(full.onboarding.vehicleExteriorUri
              ? { vehicleExteriorUri: full.onboarding.vehicleExteriorUri }
              : {}),
            ...(full.onboarding.selfPhotoKey
              ? { selfPhotoKey: full.onboarding.selfPhotoKey }
              : {}),
            ...(full.onboarding.vehicleInteriorKey
              ? { vehicleInteriorKey: full.onboarding.vehicleInteriorKey }
              : {}),
            ...(full.onboarding.vehicleExteriorKey
              ? { vehicleExteriorKey: full.onboarding.vehicleExteriorKey }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Batch-load public profiles for a board page.
 * Avoids N×3 queries (users + driverProfiles + completed-count) against a pooled
 * connection at board-load time — one join + one grouped count, then local SigV4
 * photo presigns in parallel (no network round trip to S3).
 */
export async function loadPublicProfiles(
  userIds: string[],
): Promise<Map<string, PublicProfileDto>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  const out = new Map<string, PublicProfileDto>();
  if (ids.length === 0) return out;

  // Completed counts in one grouped query (UNION dedupes drive+user so a trip
  // where the user is both poster and assignee still counts once — same as
  // countCompletedDrives' OR filter).
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const [rows, countRows] = await Promise.all([
    db
      .select({
        user: users,
        profile: driverProfiles,
      })
      .from(users)
      .leftJoin(driverProfiles, eq(driverProfiles.userId, users.id))
      .where(inArray(users.id, ids)),
    db
      .select({
        userId: sql<string>`counts.user_id`,
        c: sql<number>`counts.c`,
      })
      .from(
        sql`(
          SELECT user_id, count(*)::int AS c
          FROM (
            SELECT poster_id AS user_id, id
            FROM drives
            WHERE status = 'completed' AND poster_id IN (${idList})
            UNION
            SELECT assignee_id AS user_id, id
            FROM drives
            WHERE status = 'completed' AND assignee_id IN (${idList})
          ) t
          GROUP BY user_id
        ) AS counts`,
      ),
  ]);

  const completedByUser = new Map<string, number>();
  for (const row of countRows) {
    if (row.userId) completedByUser.set(row.userId, Number(row.c ?? 0));
  }

  await Promise.all(
    rows.map(async ({ user, profile }) => {
      const photos = profile
        ? await Promise.all([
            resolvePhotoUri(profile.selfPhotoKey),
            resolvePhotoUri(profile.vehicleInteriorKey),
            resolvePhotoUri(profile.vehicleExteriorKey),
          ]).then(([selfPhotoUri, vehicleInteriorUri, vehicleExteriorUri]) => ({
            ...(selfPhotoUri ? { selfPhotoUri } : {}),
            ...(vehicleInteriorUri ? { vehicleInteriorUri } : {}),
            ...(vehicleExteriorUri ? { vehicleExteriorUri } : {}),
          }))
        : {};
      out.set(
        user.id,
        toPublicProfileDto(
          user,
          profile,
          completedByUser.get(user.id) ?? 0,
          photos,
        ),
      );
    }),
  );

  return out;
}

export async function toAuthUser(userId: string): Promise<AuthUserDto> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'User not found', 'user_not_found');

  const [profile] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  const completedDrivesCount = await countCompletedDrives(userId);

  const dto: AuthUserDto = {
    id: user.id,
    phone: user.phone,
    name: user.name,
    onboardingComplete: user.onboardingComplete,
    completedDrivesCount,
    status: user.status,
    availability: profile?.availability ?? 'offline',
  };

  if (profile) {
    const [selfPhotoUri, vehicleInteriorUri, vehicleExteriorUri] =
      await Promise.all([
        resolvePhotoUri(profile.selfPhotoKey),
        resolvePhotoUri(profile.vehicleInteriorKey),
        resolvePhotoUri(profile.vehicleExteriorKey),
      ]);
    dto.onboarding = {
      vehicleClass: profile.vehicleClass,
      vehicleType: profile.vehicleType,
      seats: profile.seats,
      yearsDrivingUpstate: profile.yearsDrivingUpstate,
      ...(profile.extraInfo ? { extraInfo: profile.extraInfo } : {}),
      ...(profile.zelle ? { zelle: profile.zelle } : {}),
      ...(selfPhotoUri ? { selfPhotoUri } : {}),
      ...(vehicleInteriorUri ? { vehicleInteriorUri } : {}),
      ...(vehicleExteriorUri ? { vehicleExteriorUri } : {}),
      ...(profile.selfPhotoKey ? { selfPhotoKey: profile.selfPhotoKey } : {}),
      ...(profile.vehicleInteriorKey
        ? { vehicleInteriorKey: profile.vehicleInteriorKey }
        : {}),
      ...(profile.vehicleExteriorKey
        ? { vehicleExteriorKey: profile.vehicleExteriorKey }
        : {}),
    };
    if (profile.lastLat != null && profile.lastLng != null) {
      const lat = Number(profile.lastLat);
      const lng = Number(profile.lastLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        dto.lastLat = lat;
        dto.lastLng = lng;
      }
    }
    if (profile.locationUpdatedAt) {
      dto.locationUpdatedAt = profile.locationUpdatedAt.toISOString();
    }
  }

  return dto;
}

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUserDto;
};

async function issueTokens(userId: string, familyId?: string): Promise<TokenPair> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'User not found', 'user_not_found');
  if (user.status === 'locked') {
    throw new AppError(
      403,
      'Account locked until balances are settled.',
      'account_locked',
    );
  }

  const tokenId = randomUUID();
  const fam = familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000);

  const refreshJwt = await signRefreshToken({
    userId,
    tokenId,
    familyId: fam,
  });

  await db.insert(refreshTokens).values({
    id: tokenId,
    userId,
    tokenHash: sha256(refreshJwt),
    familyId: fam,
    expiresAt,
  });

  const accessToken = await signAccessToken({
    sub: user.id,
    phone: user.phone,
  });
  const userDto = await toAuthUser(user.id);

  return {
    accessToken,
    refreshToken: refreshJwt,
    expiresIn: env.ACCESS_TOKEN_TTL_SEC,
    user: userDto,
  };
}

export async function signup(input: {
  name: string;
  phone: string;
  password: string;
}): Promise<TokenPair> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new AppError(400, 'Enter a valid name', 'invalid_name');
  }
  if (!isValidPhone(input.phone)) {
    throw new AppError(400, 'Enter a valid phone number', 'invalid_phone');
  }
  if (!passwordMeetsRequirements(input.password)) {
    throw new AppError(
      400,
      'Password must be 8+ chars with a letter and number',
      'invalid_password',
    );
  }
  const phone = normalizePhone(input.phone);
  const passwordHash = await hashPassword(input.password);
  try {
    const [created] = await db
      .insert(users)
      .values({ phone, name, passwordHash })
      .returning();
    if (!created) throw new AppError(500, 'Could not create account', 'create_failed');
    return issueTokens(created.id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'An account with this phone already exists.', 'phone_taken');
    }
    throw err;
  }
}

export async function login(input: {
  phone: string;
  password: string;
}): Promise<TokenPair> {
  if (!isValidPhone(input.phone)) {
    throw new AppError(400, 'Invalid phone or password.', 'invalid_credentials');
  }
  const phone = normalizePhone(input.phone);
  const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError(401, 'Invalid phone or password.', 'invalid_credentials');
  }
  return issueTokens(user.id);
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  const claims = await verifyRefreshToken(refreshToken);
  if (!claims) {
    throw new AppError(401, 'Invalid refresh token', 'invalid_refresh');
  }

  const tokenHash = sha256(refreshToken);
  // Atomic claim: only one concurrent refresh can revoke this row
  const [row] = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.id, claims.tokenId),
        eq(refreshTokens.userId, claims.userId),
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .returning();

  if (!row) {
    // Reuse / race: revoke whole family
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, claims.familyId),
          isNull(refreshTokens.revokedAt),
        ),
      );
    throw new AppError(401, 'Invalid refresh token', 'invalid_refresh');
  }

  return issueTokens(claims.userId, row.familyId);
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  const claims = await verifyRefreshToken(refreshToken);
  if (!claims) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.familyId, claims.familyId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    );
}
