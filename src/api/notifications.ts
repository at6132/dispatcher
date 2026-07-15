import { apiFetch } from './client';

export type NotificationPrefMode = 'off' | 'all' | 'favorites';

/** Drive status has no favorites filter — only off/all. */
export type DriveStatusPrefMode = 'off' | 'all';

export type NotificationPrefs = {
  newApplication: NotificationPrefMode;
  driveStatus: DriveStatusPrefMode;
  /** You got the job (accepted). */
  applicationAccepted: NotificationPrefMode;
  newDrivePosted: NotificationPrefMode;
  /** Poster: driver requested to cancel. */
  cancelRequest: NotificationPrefMode;
  /** Driver: poster cleared submissions on a drive you applied to. */
  applicationCleared: NotificationPrefMode;
};

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const data = await apiFetch<{ preferences: NotificationPrefs }>(
    '/v1/me/notifications',
  );
  return data.preferences;
}

export async function updateNotificationPrefs(
  patch: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const data = await apiFetch<{ preferences: NotificationPrefs }>(
    '/v1/me/notifications',
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
  return data.preferences;
}

export async function registerPushToken(
  token: string,
  platform?: 'ios' | 'android' | 'web',
): Promise<void> {
  await apiFetch<void>('/v1/me/push-token', {
    method: 'PUT',
    body: JSON.stringify({ token, platform }),
  });
}

export async function unregisterPushToken(token: string): Promise<void> {
  await apiFetch<void>('/v1/me/push-token', {
    method: 'DELETE',
    body: JSON.stringify({ token }),
  });
}

export function normalizeNotificationPrefs(
  prefs: NotificationPrefs,
): NotificationPrefs {
  const driveStatus =
    (prefs.driveStatus as NotificationPrefMode) === 'favorites'
      ? 'all'
      : prefs.driveStatus;
  return {
    newApplication: prefs.newApplication,
    driveStatus,
    applicationAccepted: prefs.applicationAccepted,
    newDrivePosted: prefs.newDrivePosted,
    cancelRequest: prefs.cancelRequest ?? 'all',
    applicationCleared: prefs.applicationCleared ?? 'all',
  };
}
