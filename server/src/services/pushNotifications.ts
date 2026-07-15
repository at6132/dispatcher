import { and, eq, ne, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  favorites,
  notificationPreferences,
  pushTokens,
  users,
} from '../db/schema.js';
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefMode,
  type NotificationPrefsDto,
} from './notificationPrefs.js';

type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default';
};

type PrefKey = keyof NotificationPrefsDto;

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  picked_up: 'Picked up',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function fireAndForget(label: string, work: () => Promise<void>) {
  void work().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[push] ${label}`, err);
  });
}

async function listTokensForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));
  return rows.map((r) => r.token);
}

async function isFavorited(
  ownerId: string,
  favoriteUserId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: favorites.id })
    .from(favorites)
    .where(
      and(
        eq(favorites.ownerId, ownerId),
        eq(favorites.favoriteUserId, favoriteUserId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function getPref(
  userId: string,
  key: PrefKey,
): Promise<NotificationPrefMode> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_NOTIFICATION_PREFS[key];
  return row[key];
}

async function shouldNotify(
  recipientId: string,
  key: PrefKey,
  relatedUserId?: string,
): Promise<boolean> {
  const mode = await getPref(recipientId, key);
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  // favorites
  if (!relatedUserId) return false;
  return isFavorited(recipientId, relatedUserId);
}

async function sendExpoPush(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  // Expo accepts up to ~100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(
        '[push] expo http fail',
        res.status,
        text.slice(0, 300),
      );
    }
  }
}

async function notifyUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const tokens = await listTokensForUser(userId);
  if (tokens.length === 0) return;
  await sendExpoPush(
    tokens.map((to) => ({
      to,
      title,
      body,
      data,
      sound: 'default' as const,
    })),
  );
}

/** Poster: a driver applied. `favorites` = only favorited drivers. */
export function notifyNewApplication(input: {
  posterId: string;
  driverId: string;
  driverName: string;
  driveId: string;
  routeText: string;
}) {
  fireAndForget('new_application', async () => {
    if (input.posterId === input.driverId) return;
    const ok = await shouldNotify(
      input.posterId,
      'newApplication',
      input.driverId,
    );
    if (!ok) return;
    await notifyUser(
      input.posterId,
      'New application',
      `${input.driverName} applied to ${input.routeText}`,
      { type: 'new_application', driveId: input.driveId },
    );
  });
}

/** Poster: drive status changed (picked up / completed / cancelled). */
export function notifyDriveStatusChange(input: {
  posterId: string;
  driveId: string;
  routeText: string;
  status: string;
  /** Skip if the poster themselves caused the change. */
  actorId?: string;
}) {
  fireAndForget('drive_status', async () => {
    if (input.actorId && input.actorId === input.posterId) return;
    const ok = await shouldNotify(input.posterId, 'driveStatus');
    if (!ok) return;
    const label = STATUS_LABEL[input.status] ?? input.status;
    await notifyUser(
      input.posterId,
      'Ride updated',
      `${input.routeText} is now ${label.toLowerCase()}`,
      {
        type: 'drive_status',
        driveId: input.driveId,
        status: input.status,
      },
    );
  });
}

/** Driver: accepted onto a drive. `favorites` = only favorited posters. */
export function notifyApplicationAccepted(input: {
  driverId: string;
  posterId: string;
  driveId: string;
  routeText: string;
}) {
  fireAndForget('application_accepted', async () => {
    const ok = await shouldNotify(
      input.driverId,
      'applicationAccepted',
      input.posterId,
    );
    if (!ok) return;
    await notifyUser(
      input.driverId,
      'You’re on the job',
      `Accepted for ${input.routeText}`,
      { type: 'application_accepted', driveId: input.driveId },
    );
  });
}

/**
 * Drivers: a new drive was posted (any open drive on the board).
 * `favorites` = only when the poster is favorited.
 */
export function notifyNewDrivePosted(input: {
  posterId: string;
  driveId: string;
  routeText: string;
}) {
  fireAndForget('new_drive_posted', async () => {
    // Recipients with tokens + pref not off (default all when no row).
    const rows = await db
      .select({
        userId: pushTokens.userId,
        token: pushTokens.token,
        mode: sql<NotificationPrefMode>`coalesce(${notificationPreferences.newDrivePosted}, 'all')`,
      })
      .from(pushTokens)
      .innerJoin(users, eq(users.id, pushTokens.userId))
      .leftJoin(
        notificationPreferences,
        eq(notificationPreferences.userId, pushTokens.userId),
      )
      .where(
        and(
          ne(pushTokens.userId, input.posterId),
          eq(users.onboardingComplete, true),
          sql`coalesce(${notificationPreferences.newDrivePosted}, 'all') <> 'off'`,
        ),
      );

    if (rows.length === 0) return;

    const favoriteOwnerIds = new Set(
      (
        await db
          .select({ ownerId: favorites.ownerId })
          .from(favorites)
          .where(eq(favorites.favoriteUserId, input.posterId))
      ).map((r) => r.ownerId),
    );

    const messages: PushMessage[] = [];
    const seenTokens = new Set<string>();
    for (const row of rows) {
      if (row.mode === 'favorites' && !favoriteOwnerIds.has(row.userId)) {
        continue;
      }
      if (seenTokens.has(row.token)) continue;
      seenTokens.add(row.token);
      messages.push({
        to: row.token,
        title: 'New drive',
        body: input.routeText,
        data: { type: 'new_drive_posted', driveId: input.driveId },
        sound: 'default',
      });
    }

    await sendExpoPush(messages);
  });
}

export async function upsertPushToken(
  userId: string,
  token: string,
  platform?: string,
): Promise<void> {
  const cleaned = token.trim();
  if (!cleaned || cleaned.length > 512) {
    throw new Error('invalid_token');
  }
  await db
    .insert(pushTokens)
    .values({
      userId,
      token: cleaned,
      platform: platform?.slice(0, 32) || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: {
        userId,
        platform: platform?.slice(0, 32) || null,
        updatedAt: new Date(),
      },
    });
}

export async function deletePushToken(
  userId: string,
  token: string,
): Promise<void> {
  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}
