import { and, eq, isNull, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { driverProfiles, refreshTokens, users } from '../db/schema.js';
import {
  hashPassword,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
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
  onboarding?: {
    vehicleClass: 'sedan' | 'suv' | 'large_suv' | 'minivan' | 'sprinter';
    vehicleType: string;
    seats: number;
    selfPhotoUri?: string;
    vehicleInteriorUri?: string;
    vehicleExteriorUri?: string;
    yearsDrivingUpstate: number;
    extraInfo?: string;
    zelle?: string;
  };
  status: 'active' | 'locked';
};

async function resolvePhotoUri(
  key: string | null | undefined,
): Promise<string | undefined> {
  if (!key) return undefined;
  if (key.startsWith('http://') || key.startsWith('https://')) return key;
  if (!env.s3Enabled) return undefined;
  try {
    return await presignGet(key);
  } catch {
    return undefined;
  }
}

export async function toAuthUser(userId: string): Promise<AuthUserDto> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'User not found', 'user_not_found');

  const [profile] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  const dto: AuthUserDto = {
    id: user.id,
    phone: user.phone,
    name: user.name,
    onboardingComplete: user.onboardingComplete,
    status: user.status,
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
    };
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
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);
  if (existing.length) {
    throw new AppError(409, 'An account with this phone already exists.', 'phone_taken');
  }

  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(users)
    .values({ phone, name, passwordHash })
    .returning();
  if (!created) throw new AppError(500, 'Could not create account', 'create_failed');
  return issueTokens(created.id);
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
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.id, claims.tokenId),
        eq(refreshTokens.userId, claims.userId),
        eq(refreshTokens.tokenHash, tokenHash),
      ),
    )
    .limit(1);

  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    // Reuse detection: revoke whole family
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

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, row.id));

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
