import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { registerPushToken } from '../api/notifications';
import { logger } from '../debug/logger';

/** Ensure Android has a channel before tokens / prompts work on 13+. */
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Dispatcher',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Request permission (if needed) and upsert the Expo push token with the API.
 * Safe to call repeatedly — no-ops when permission denied or token unavailable.
 */
export async function syncPushRegistration(): Promise<void> {
  try {
    // Expo push tokens are native-only in SDK 54.
    if (Platform.OS === 'web') {
      logger.info('push', 'skipped_web');
      return;
    }

    await ensureAndroidChannel();

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      status = asked.status;
    }
    if (status !== 'granted') {
      logger.info('push', 'permission_denied');
      return;
    }

    const projectId =
      Constants.easConfig?.projectId ??
      Constants.expoConfig?.extra?.eas?.projectId;
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse.data;
    if (!token) return;

    const platform =
      Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
        ? Platform.OS
        : undefined;
    await registerPushToken(token, platform);
    logger.info('push', 'token_registered', { platform });
  } catch (err) {
    logger.warn('push', 'register_fail', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
