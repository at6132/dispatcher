import type { FastifyRequest } from 'fastify';

import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { verifyAccessToken } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export type AuthUser = {
  id: string;
  phone: string;
  status: 'active' | 'locked';
  onboardingComplete: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Locked drivers may only read their own account/balances until settled. */
function isAllowedWhileLocked(request: FastifyRequest): boolean {
  const path = (request.url ?? '').split('?')[0] ?? '';
  const method = request.method.toUpperCase();

  if (method === 'GET' && (path === '/v1/me' || path === '/v1/me/')) return true;
  if (method === 'GET' && (path === '/v1/balances' || path === '/v1/balances/')) {
    return true;
  }
  // Logout is on /v1/auth and does not use requireAuth
  return false;
}

export async function requireAuth(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Unauthorized', 'unauthorized');
  }
  const token = header.slice('Bearer '.length).trim();
  const claims = await verifyAccessToken(token);
  if (!claims) {
    throw new AppError(401, 'Unauthorized', 'unauthorized');
  }
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  if (!user) {
    throw new AppError(401, 'Unauthorized', 'unauthorized');
  }

  request.user = {
    id: user.id,
    phone: user.phone,
    status: user.status,
    onboardingComplete: user.onboardingComplete,
  };

  if (user.status === 'locked' && !isAllowedWhileLocked(request)) {
    throw new AppError(
      403,
      'Account locked until balances are settled.',
      'account_locked',
    );
  }
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new AppError(401, 'Unauthorized', 'unauthorized');
  return request.user;
}

export function requireActiveUser(request: FastifyRequest): AuthUser {
  const user = requireUser(request);
  if (user.status === 'locked') {
    throw new AppError(
      403,
      'Account locked until balances are settled.',
      'account_locked',
    );
  }
  return user;
}
