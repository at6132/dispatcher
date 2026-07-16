import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  applications,
  balances,
  drives,
  platformFees,
  users,
} from '../db/schema.js';
import { AppError } from '../lib/errors.js';

/**
 * Permanently delete the authenticated user's account and owned data.
 * Blocks when they still have unsettled balance or platform-fee rows.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) {
      throw new AppError(404, 'Account not found', 'not_found');
    }

    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(balances)
      .where(
        and(
          ne(balances.status, 'settled'),
          or(eq(balances.posterId, userId), eq(balances.driverId, userId)),
        ),
      );
    if ((open?.n ?? 0) > 0) {
      throw new AppError(
        409,
        'Settle outstanding balances in Bank before deleting your account.',
        'open_balances',
      );
    }

    const [openFees] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(platformFees)
      .where(
        and(
          eq(platformFees.posterId, userId),
          ne(platformFees.status, 'settled'),
        ),
      );
    if ((openFees?.n ?? 0) > 0) {
      throw new AppError(
        409,
        'Settle platform fees in Bank before deleting your account.',
        'open_platform_fees',
      );
    }

    const [activeAssigned] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(drives)
      .where(
        and(
          eq(drives.assigneeId, userId),
          inArray(drives.status, ['assigned', 'picked_up']),
        ),
      );
    if ((activeAssigned?.n ?? 0) > 0) {
      throw new AppError(
        409,
        'Finish or cancel your active rides before deleting your account.',
        'active_rides',
      );
    }

    const [activePosted] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(drives)
      .where(
        and(
          eq(drives.posterId, userId),
          inArray(drives.status, ['assigned', 'picked_up']),
        ),
      );
    if ((activePosted?.n ?? 0) > 0) {
      throw new AppError(
        409,
        'Finish or cancel your active posted rides before deleting your account.',
        'active_rides',
      );
    }

    // Drop settled ledger history that would block user/drive deletes.
    await tx.delete(platformFees).where(eq(platformFees.posterId, userId));
    await tx
      .delete(balances)
      .where(
        or(eq(balances.posterId, userId), eq(balances.driverId, userId)),
      );

    // Cancel open board posts / direct offers this user posted.
    await tx
      .update(drives)
      .set({
        status: 'cancelled',
        assigneeId: null,
        cancelRequestedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(drives.posterId, userId), inArray(drives.status, ['open'])),
      );

    // Clear refs on other people's drives.
    await tx
      .update(drives)
      .set({ assigneeId: null, cancelRequestedAt: null, updatedAt: new Date() })
      .where(eq(drives.assigneeId, userId));
    await tx
      .update(drives)
      .set({ invitedDriverId: null, updatedAt: new Date() })
      .where(eq(drives.invitedDriverId, userId));

    // Applications on remaining drives cascade from user delete, but clear
    // pending ones explicitly so posters don't see ghost applicants.
    await tx.delete(applications).where(eq(applications.driverId, userId));

    // Delete drives this user posted (applications cascade from drive).
    await tx.delete(drives).where(eq(drives.posterId, userId));

    const deleted = await tx
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!deleted.length) {
      throw new AppError(404, 'Account not found', 'not_found');
    }
  });
}
