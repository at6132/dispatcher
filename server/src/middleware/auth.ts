import type { FastifyReply, FastifyRequest } from 'fastify';

import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { verifyAccessToken } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { assertRateLimit } from '../lib/security.js';

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
  // Locked users may delete their account (still blocked if balances are open).
  if (method === 'DELETE' && (path === '/v1/me' || path === '/v1/me/')) {
    return true;
  }
  if (method === 'GET' && (path === '/v1/balances' || path === '/v1/balances/')) {
    return true;
  }
  // Balance / platform-fee actions remain available so locked users can clear obligations.
  if (
    method === 'POST' &&
    (/^\/v1\/balances\/[^/]+\/(mark-paid|confirm-received)\/?$/.test(path) ||
      /^\/v1\/platform-fees\/[^/]+\/mark-paid\/?$/.test(path))
  ) {
    return true;
  }
  if (
    method === 'POST' &&
    (path === '/v1/me/photos/presign' ||
      path === '/v1/me/photos/presign/' ||
      path === '/v1/me/photos/confirm' ||
      path === '/v1/me/photos/confirm/')
  ) {
    return true;
  }
  return false;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Unauthorized', 'unauthorized');
  }
  const token = header.slice('Bearer '.length).trim();
  if (token.length > 4096) {
    throw new AppError(401, 'Unauthorized', 'unauthorized');
  }
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

  // Per authenticated user + IP ceiling (Redis sliding window)
  await assertRateLimit(
    {
      key: `authed:user:${user.id}`,
      limit: 240,
      windowSec: 60,
      failClosed: false,
    },
    reply,
  );
  await assertRateLimit(
    {
      key: `authed:ip:${request.ip}`,
      limit: 360,
      windowSec: 60,
      failClosed: false,
    },
    reply,
  );

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
