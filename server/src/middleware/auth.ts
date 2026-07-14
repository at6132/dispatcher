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
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new AppError(401, 'Unauthorized', 'unauthorized');
  return request.user;
}
