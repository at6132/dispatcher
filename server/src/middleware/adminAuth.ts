import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import { adminSessions } from '../db/schema.js';
import { verifyAdminToken } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { assertRateLimit } from '../lib/security.js';
import { touchAdminSession } from '../services/adminAuth.js';

export type AdminSession = {
  id: string;
  ip: string;
  userAgent: string | null;
  expiresAt: Date;
};

declare module 'fastify' {
  interface FastifyRequest {
    adminSession?: AdminSession;
  }
}

export async function requireAdmin(
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

  const claims = await verifyAdminToken(token);
  if (!claims) {
    throw new AppError(401, 'Unauthorized', 'unauthorized');
  }

  const [session] = await db
    .select()
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.id, claims.sid),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    throw new AppError(401, 'Unauthorized', 'unauthorized');
  }

  request.adminSession = {
    id: session.id,
    ip: session.ip,
    userAgent: session.userAgent,
    expiresAt: session.expiresAt,
  };

  await assertRateLimit(
    {
      key: `admin:session:${session.id}`,
      limit: 300,
      windowSec: 60,
      failClosed: true,
    },
    reply,
  );
  await assertRateLimit(
    {
      key: `admin:ip:${request.ip}`,
      limit: 400,
      windowSec: 60,
      failClosed: true,
    },
    reply,
  );

  // Soft touch — don't await blocking every request hard
  void touchAdminSession(session.id);
}

export function requireAdminSession(request: FastifyRequest): AdminSession {
  if (!request.adminSession) {
    throw new AppError(401, 'Unauthorized', 'unauthorized');
  }
  return request.adminSession;
}
