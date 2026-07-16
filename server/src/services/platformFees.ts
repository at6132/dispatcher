import { and, desc, eq, ne, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { balances, platformFees, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { withLock } from '../lib/locks.js';
import { presignGet } from '../lib/s3.js';
import { assertOwnedConfirmedPhotoKey } from './onboarding.js';

async function maybeUnlockUser(userId: string) {
  const [feePastDue] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(platformFees)
    .where(
      and(
        eq(platformFees.posterId, userId),
        ne(platformFees.status, 'settled'),
        sql`${platformFees.dueSunday} < now()`,
      ),
    );
  if ((feePastDue?.c ?? 0) > 0) return;

  const [balancePastDue] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(balances)
    .where(
      and(
        eq(balances.driverId, userId),
        ne(balances.status, 'settled'),
        sql`${balances.dueSunday} < now()`,
      ),
    );
  if ((balancePastDue?.c ?? 0) > 0) return;

  await db
    .update(users)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function markPlatformFeePaid(
  posterId: string,
  feeId: string,
  settlementProofKey?: string,
) {
  const proofKey = await assertOwnedConfirmedPhotoKey(
    posterId,
    settlementProofKey,
    'payment_proof',
  );

  return withLock(`platform-fee:${feeId}:mark-paid`, async () =>
    db.transaction(async (tx) => {
      const [fee] = await tx
        .select()
        .from(platformFees)
        .where(eq(platformFees.id, feeId))
        .for('update');
      if (!fee) throw new AppError(404, 'Platform fee not found', 'fee_not_found');
      if (fee.posterId !== posterId) {
        throw new AppError(403, 'Only the dispatcher can mark this sent', 'forbidden');
      }
      if (fee.status !== 'open') {
        return fee;
      }

      const [updated] = await tx
        .update(platformFees)
        .set({
          status: 'payment_pending',
          paidAt: new Date(),
          ...(proofKey ? { settlementProofKey: proofKey } : {}),
        })
        .where(and(eq(platformFees.id, feeId), eq(platformFees.status, 'open')))
        .returning();
      if (!updated) {
        const [again] = await tx
          .select()
          .from(platformFees)
          .where(eq(platformFees.id, feeId))
          .limit(1);
        if (again && again.status !== 'open') return again;
        throw new AppError(409, 'Payment could not be marked', 'payment_conflict');
      }
      return updated;
    }),
  );
}

export async function confirmPlatformFeeReceived(feeId: string) {
  return withLock(`platform-fee:${feeId}:confirm-received`, async () =>
    db.transaction(async (tx) => {
      const [fee] = await tx
        .select()
        .from(platformFees)
        .where(eq(platformFees.id, feeId))
        .for('update');
      if (!fee) throw new AppError(404, 'Platform fee not found', 'fee_not_found');
      if (fee.status === 'settled') return fee;
      if (fee.status !== 'payment_pending' && fee.status !== 'open') {
        throw new AppError(409, 'Fee could not be confirmed', 'fee_conflict');
      }

      const [updated] = await tx
        .update(platformFees)
        .set({
          status: 'settled',
          settledAt: new Date(),
          ...(fee.paidAt ? {} : { paidAt: new Date() }),
        })
        .where(
          and(
            eq(platformFees.id, feeId),
            ne(platformFees.status, 'settled'),
          ),
        )
        .returning();
      if (!updated) {
        const [again] = await tx
          .select()
          .from(platformFees)
          .where(eq(platformFees.id, feeId))
          .limit(1);
        if (again?.status === 'settled') return again;
        throw new AppError(409, 'Fee could not be confirmed', 'fee_conflict');
      }

      return updated;
    }),
  ).then(async (updated) => {
    await maybeUnlockUser(updated.posterId);
    return updated;
  });
}

export async function listPlatformFeesForPoster(posterId: string) {
  const rows = await db
    .select()
    .from(platformFees)
    .where(eq(platformFees.posterId, posterId))
    .orderBy(desc(platformFees.createdAt))
    .limit(100);

  return Promise.all(
    rows.map(async (f) => ({
      id: f.id,
      driveId: f.driveId,
      balanceId: f.balanceId ?? undefined,
      posterId: f.posterId,
      amountCents: f.amountCents,
      status: f.status,
      dueSunday: f.dueSunday.toISOString(),
      paidAt: f.paidAt?.toISOString(),
      settledAt: f.settledAt?.toISOString(),
      createdAt: f.createdAt.toISOString(),
      settlementProofUrl: f.settlementProofKey
        ? await presignGet(f.settlementProofKey).catch(() => undefined)
        : undefined,
    })),
  );
}

export async function listPlatformFeesAdmin(opts: {
  status?: 'open' | 'payment_pending' | 'settled';
  overdue?: boolean;
  limit: number;
  offset: number;
}) {
  const filters = [];
  if (opts.status) filters.push(eq(platformFees.status, opts.status));
  if (opts.overdue) {
    filters.push(
      and(ne(platformFees.status, 'settled'), sql`${platformFees.dueSunday} < now()`)!,
    );
  }
  const where = filters.length ? and(...filters) : undefined;
  const items = await db
    .select()
    .from(platformFees)
    .where(where)
    .orderBy(desc(platformFees.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);

  return Promise.all(
    items.map(async (f) => ({
      ...f,
      dueSunday: f.dueSunday.toISOString(),
      paidAt: f.paidAt?.toISOString() ?? null,
      settledAt: f.settledAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
      settlementProofUrl: f.settlementProofKey
        ? await presignGet(f.settlementProofKey).catch(() => null)
        : null,
    })),
  );
}
