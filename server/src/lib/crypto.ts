import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import * as argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';

import { env } from '../config/env.js';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type AccessClaims = {
  sub: string;
  phone: string;
};

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ phone: claims.phone })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(accessSecret);
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      algorithms: ['HS256'],
      clockTolerance: 30,
    });
    if (typeof payload.sub !== 'string') return null;
    if (typeof payload.phone !== 'string') return null;
    return { sub: payload.sub, phone: payload.phone };
  } catch {
    return null;
  }
}

export async function signRefreshToken(input: {
  userId: string;
  tokenId: string;
  familyId: string;
}): Promise<string> {
  return new SignJWT({ fid: input.familyId, tid: input.tokenId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.REFRESH_TOKEN_TTL_SEC}s`)
    .sign(refreshSecret);
}

export async function verifyRefreshToken(token: string): Promise<{
  userId: string;
  tokenId: string;
  familyId: string;
} | null> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret, {
      algorithms: ['HS256'],
      clockTolerance: 30,
    });
    if (typeof payload.sub !== 'string') return null;
    if (typeof payload.tid !== 'string') return null;
    if (typeof payload.fid !== 'string') return null;
    return {
      userId: payload.sub,
      tokenId: payload.tid,
      familyId: payload.fid,
    };
  } catch {
    return null;
  }
}

const adminSecret = () =>
  new TextEncoder().encode(env.adminJwtSecret);

export type AdminAccessClaims = {
  sub: string;
  sid: string;
  role: 'admin';
};

export async function signAdminToken(claims: {
  sessionId: string;
}): Promise<string> {
  return new SignJWT({ role: 'admin', sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sessionId)
    .setIssuedAt()
    .setExpirationTime(`${env.ADMIN_SESSION_TTL_SEC}s`)
    .sign(adminSecret());
}

export async function verifyAdminToken(
  token: string,
): Promise<AdminAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, adminSecret(), {
      algorithms: ['HS256'],
      clockTolerance: 30,
    });
    if (typeof payload.sub !== 'string') return null;
    if (typeof payload.sid !== 'string') return null;
    if (payload.role !== 'admin') return null;
    return { sub: payload.sub, sid: payload.sid, role: 'admin' };
  } catch {
    return null;
  }
}

/** Timing-safe compare of password against ADMIN_PASSWORD env. */
export function verifyAdminPassword(password: string): boolean {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(password, expected);
}

export function randomShortCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}
