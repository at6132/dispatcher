import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { notificationPreferences } from '../db/schema.js';

export type NotificationPrefMode = 'off' | 'all' | 'favorites';

export type NotificationPrefsDto = {
  newApplication: NotificationPrefMode;
  driveStatus: NotificationPrefMode;
  applicationAccepted: NotificationPrefMode;
  newDrivePosted: NotificationPrefMode;
  cancelRequest: NotificationPrefMode;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsDto = {
  newApplication: 'all',
  driveStatus: 'all',
  applicationAccepted: 'all',
  newDrivePosted: 'all',
  cancelRequest: 'all',
};

export function mapNotificationPrefs(row: {
  newApplication: NotificationPrefMode;
  driveStatus: NotificationPrefMode;
  applicationAccepted: NotificationPrefMode;
  newDrivePosted: NotificationPrefMode;
  cancelRequest: NotificationPrefMode;
}): NotificationPrefsDto {
  return {
    newApplication: row.newApplication,
    driveStatus: row.driveStatus,
    applicationAccepted: row.applicationAccepted,
    newDrivePosted: row.newDrivePosted,
    cancelRequest: row.cancelRequest,
  };
}

export async function getNotificationPrefs(
  userId: string,
): Promise<NotificationPrefsDto> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFS };
  return mapNotificationPrefs(row);
}

export async function updateNotificationPrefs(
  userId: string,
  patch: Partial<NotificationPrefsDto>,
): Promise<NotificationPrefsDto> {
  const current = await getNotificationPrefs(userId);
  const next: NotificationPrefsDto = {
    newApplication: patch.newApplication ?? current.newApplication,
    // Drive status has no favorites filter in product — clamp favorites → all.
    driveStatus:
      patch.driveStatus === 'favorites'
        ? 'all'
        : (patch.driveStatus ?? current.driveStatus),
    applicationAccepted:
      patch.applicationAccepted ?? current.applicationAccepted,
    newDrivePosted: patch.newDrivePosted ?? current.newDrivePosted,
    cancelRequest: patch.cancelRequest ?? current.cancelRequest,
  };

  await db
    .insert(notificationPreferences)
    .values({
      userId,
      newApplication: next.newApplication,
      driveStatus: next.driveStatus === 'favorites' ? 'all' : next.driveStatus,
      applicationAccepted: next.applicationAccepted,
      newDrivePosted: next.newDrivePosted,
      cancelRequest: next.cancelRequest,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        newApplication: next.newApplication,
        driveStatus: next.driveStatus === 'favorites' ? 'all' : next.driveStatus,
        applicationAccepted: next.applicationAccepted,
        newDrivePosted: next.newDrivePosted,
        cancelRequest: next.cancelRequest,
        updatedAt: new Date(),
      },
    });

  return {
    ...next,
    driveStatus: next.driveStatus === 'favorites' ? 'all' : next.driveStatus,
  };
}
