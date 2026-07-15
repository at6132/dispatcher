import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import {
  adminLoginChallenges,
  adminSessions,
} from '../db/schema.js';
import {
  randomShortCode,
  randomToken,
  sha256,
  signAdminToken,
  verifyAdminPassword,
} from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { recordSecurityEvent } from '../lib/securityEvents.js';
import { sendTelegramRaw } from '../lib/telegram.js';
import { writeAudit } from '../lib/audit.js';

function challengeTtlMs(): number {
  return env.ADMIN_CHALLENGE_TTL_SEC * 1000;
}

function sessionTtlMs(): number {
  return env.ADMIN_SESSION_TTL_SEC * 1000;
}

export async function startAdminLogin(input: {
  password: string;
  ip: string;
  userAgent?: string;
  requestId?: string;
}): Promise<{
  challengeId: string;
  shortCode: string;
  expiresAt: string;
  status: 'pending';
}> {
  if (!env.adminEnabled || !env.ADMIN_PASSWORD) {
    throw new AppError(503, 'Admin login disabled', 'admin_disabled');
  }

  if (!verifyAdminPassword(input.password)) {
    recordSecurityEvent({
      kind: 'admin_password_fail',
      severity: 'warn',
      ip: input.ip,
      requestId: input.requestId,
      detail: { userAgent: input.userAgent },
      alert: true,
    });
    throw new AppError(401, 'Invalid credentials', 'invalid_credentials');
  }

  const shortCode = randomShortCode(6);
  const expiresAt = new Date(Date.now() + challengeTtlMs());
  const [row] = await db
    .insert(adminLoginChallenges)
    .values({
      shortCode,
      status: 'pending',
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      expiresAt,
    })
    .returning();

  if (!row) throw new AppError(500, 'Failed to create challenge', 'internal');

  const ua = (input.userAgent ?? 'unknown').slice(0, 120);
  await sendTelegramRaw(
    [
      `🔐 *Dispatcher admin login*`,
      ``,
      `Someone entered the admin password.`,
      `Code: \`${shortCode}\``,
      `IP: \`${input.ip}\``,
      `UA: \`${ua.replace(/([_*\`])/g, '\\$1')}\``,
      `Expires in ${Math.round(env.ADMIN_CHALLENGE_TTL_SEC / 60)} min`,
      ``,
      `Reply \`/allow\` or \`/allow ${shortCode}\` to approve.`,
      `Reply \`/deny\` or \`/deny ${shortCode}\` to deny.`,
    ].join('\n'),
  );

  recordSecurityEvent({
    kind: 'admin_login_challenge',
    severity: 'info',
    ip: input.ip,
    adminChallengeId: row.id,
    requestId: input.requestId,
    detail: { shortCode },
  });

  writeAudit({
    actorType: 'system',
    action: 'admin.challenge.create',
    entityType: 'admin_challenge',
    entityId: row.id,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
    meta: { shortCode },
  });

  return {
    challengeId: row.id,
    shortCode: row.shortCode,
    expiresAt: expiresAt.toISOString(),
    status: 'pending',
  };
}

export async function getChallengeStatus(input: {
  challengeId: string;
  ip: string;
  userAgent?: string;
  requestId?: string;
}): Promise<{
  status: 'pending' | 'approved' | 'denied' | 'expired';
  shortCode: string;
  expiresAt: string;
  sessionToken?: string;
  sessionExpiresAt?: string;
}> {
  const [row] = await db
    .select()
    .from(adminLoginChallenges)
    .where(eq(adminLoginChallenges.id, input.challengeId))
    .limit(1);

  if (!row) {
    throw new AppError(404, 'Challenge not found', 'not_found');
  }

  let status = row.status;
  if (status === 'pending' && row.expiresAt.getTime() < Date.now()) {
    await db
      .update(adminLoginChallenges)
      .set({ status: 'expired' })
      .where(
        and(
          eq(adminLoginChallenges.id, row.id),
          eq(adminLoginChallenges.status, 'pending'),
        ),
      );
    status = 'expired';
  }

  // Issue session token exactly once after approval
  if (status === 'approved' && !row.sessionIssuedAt) {
    const claim = await db
      .update(adminLoginChallenges)
      .set({ sessionIssuedAt: new Date() })
      .where(
        and(
          eq(adminLoginChallenges.id, row.id),
          isNull(adminLoginChallenges.sessionIssuedAt),
        ),
      )
      .returning();

    if (claim.length === 0) {
      return {
        status: 'approved',
        shortCode: row.shortCode,
        expiresAt: row.expiresAt.toISOString(),
      };
    }

    const rawToken = randomToken(48);
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + sessionTtlMs());

    const [session] = await db
      .insert(adminSessions)
      .values({
        tokenHash,
        challengeId: row.id,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
        expiresAt,
      })
      .returning();

    if (!session) {
      throw new AppError(500, 'Failed to create session', 'internal');
    }

    await db
      .update(adminLoginChallenges)
      .set({
        sessionTokenHash: tokenHash,
      })
      .where(eq(adminLoginChallenges.id, row.id));

    const jwt = await signAdminToken({ sessionId: session.id });

    writeAudit({
      actorType: 'admin',
      actorId: session.id,
      sessionId: session.id,
      action: 'admin.session.create',
      entityType: 'admin_session',
      entityId: session.id,
      requestId: input.requestId,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    recordSecurityEvent({
      kind: 'admin_session_issued',
      severity: 'info',
      ip: input.ip,
      adminChallengeId: row.id,
      requestId: input.requestId,
    });

    return {
      status: 'approved',
      shortCode: row.shortCode,
      expiresAt: row.expiresAt.toISOString(),
      sessionToken: jwt,
      sessionExpiresAt: expiresAt.toISOString(),
    };
  }

  return {
    status,
    shortCode: row.shortCode,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function resolveChallengeByCommand(input: {
  command: 'allow' | 'deny';
  shortCode?: string;
  chatId: string;
}): Promise<{ ok: boolean; message: string }> {
  const now = new Date();

  // Expire stale pending challenges opportunistically.
  // Use lt() — raw sql`... ${date}` breaks with postgres.js (Date not stringified).
  await db
    .update(adminLoginChallenges)
    .set({ status: 'expired' })
    .where(
      and(
        eq(adminLoginChallenges.status, 'pending'),
        lt(adminLoginChallenges.expiresAt, now),
      ),
    );

  let challenge;
  if (input.shortCode) {
    const code = input.shortCode.toUpperCase();
    const [row] = await db
      .select()
      .from(adminLoginChallenges)
      .where(
        and(
          eq(adminLoginChallenges.shortCode, code),
          eq(adminLoginChallenges.status, 'pending'),
          gt(adminLoginChallenges.expiresAt, now),
        ),
      )
      .limit(1);
    challenge = row;
  } else {
    const [row] = await db
      .select()
      .from(adminLoginChallenges)
      .where(
        and(
          eq(adminLoginChallenges.status, 'pending'),
          gt(adminLoginChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(adminLoginChallenges.createdAt))
      .limit(1);
    challenge = row;
  }

  if (!challenge) {
    return { ok: false, message: 'No pending admin login challenge.' };
  }

  if (input.command === 'allow') {
    await db
      .update(adminLoginChallenges)
      .set({
        status: 'approved',
        approvedByChatId: input.chatId,
        approvedAt: now,
      })
      .where(eq(adminLoginChallenges.id, challenge.id));

    recordSecurityEvent({
      kind: 'admin_challenge_allowed',
      severity: 'info',
      ip: challenge.ip,
      adminChallengeId: challenge.id,
      detail: { chatId: input.chatId, shortCode: challenge.shortCode },
      alert: true,
    });

    return {
      ok: true,
      message: `Allowed login ${challenge.shortCode}. Waiting client will get a session.`,
    };
  }

  await db
    .update(adminLoginChallenges)
    .set({
      status: 'denied',
      approvedByChatId: input.chatId,
      approvedAt: now,
    })
    .where(eq(adminLoginChallenges.id, challenge.id));

  recordSecurityEvent({
    kind: 'admin_challenge_denied',
    severity: 'warn',
    ip: challenge.ip,
    adminChallengeId: challenge.id,
    detail: { chatId: input.chatId, shortCode: challenge.shortCode },
    alert: true,
  });

  return {
    ok: true,
    message: `Denied login ${challenge.shortCode}.`,
  };
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(adminSessions.id, sessionId), isNull(adminSessions.revokedAt)));
}

export async function revokeAllAdminSessions(): Promise<number> {
  const rows = await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(isNull(adminSessions.revokedAt))
    .returning({ id: adminSessions.id });
  return rows.length;
}

export async function countPendingAdminChallenges(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({ id: adminLoginChallenges.id })
    .from(adminLoginChallenges)
    .where(
      and(
        eq(adminLoginChallenges.status, 'pending'),
        gt(adminLoginChallenges.expiresAt, now),
      ),
    );
  return rows.length;
}

export async function touchAdminSession(sessionId: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(adminSessions.id, sessionId));
}
