import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { favorites, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/locks.js';
import { toPublicProfile } from './auth.js';

/** Favorite user ids for an owner — for board / applicant enrichment. */
export async function listFavoriteUserIds(ownerId: string): Promise<Set<string>> {
  const rows = await db
    .select({ favoriteUserId: favorites.favoriteUserId })
    .from(favorites)
    .where(eq(favorites.ownerId, ownerId));
  return new Set(rows.map((r) => r.favoriteUserId));
}

export async function listFavorites(ownerId: string) {
  const rows = await db
    .select({
      favoriteUserId: favorites.favoriteUserId,
      createdAt: favorites.createdAt,
    })
    .from(favorites)
    .where(eq(favorites.ownerId, ownerId))
    .orderBy(desc(favorites.createdAt));

  const items = await Promise.all(
    rows.map(async (r) => {
      const user = await toPublicProfile(r.favoriteUserId);
      return {
        userId: r.favoriteUserId,
        createdAt: r.createdAt.toISOString(),
        user,
      };
    }),
  );
  return items;
}

export async function addFavorite(ownerId: string, favoriteUserId: string) {
  if (ownerId === favoriteUserId) {
    throw new AppError(400, 'Cannot favorite yourself', 'cannot_favorite_self');
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, favoriteUserId))
    .limit(1);
  if (!target) {
    throw new AppError(404, 'User not found', 'user_not_found');
  }

  try {
    const [row] = await db
      .insert(favorites)
      .values({ ownerId, favoriteUserId })
      .returning();
    if (!row) throw new AppError(500, 'Failed to favorite', 'favorite_failed');
    return {
      userId: row.favoriteUserId,
      createdAt: row.createdAt.toISOString(),
      user: await toPublicProfile(row.favoriteUserId),
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Idempotent — already favorited
      const [existing] = await db
        .select()
        .from(favorites)
        .where(
          and(
            eq(favorites.ownerId, ownerId),
            eq(favorites.favoriteUserId, favoriteUserId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new AppError(500, 'Failed to favorite', 'favorite_failed');
      }
      return {
        userId: existing.favoriteUserId,
        createdAt: existing.createdAt.toISOString(),
        user: await toPublicProfile(existing.favoriteUserId),
      };
    }
    throw err;
  }
}

export async function removeFavorite(ownerId: string, favoriteUserId: string) {
  const deleted = await db
    .delete(favorites)
    .where(
      and(
        eq(favorites.ownerId, ownerId),
        eq(favorites.favoriteUserId, favoriteUserId),
      ),
    )
    .returning({ id: favorites.id });
  if (deleted.length === 0) {
    throw new AppError(404, 'Favorite not found', 'favorite_not_found');
  }
}
