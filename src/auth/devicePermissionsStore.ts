import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import {
  isLocationAccessReady,
  locationAccessFromPermissions,
} from '../components/ui/LocationAccessPrompt';
import { logger } from '../debug/logger';

const DEVICE_PERMISSIONS_KEY = 'dispatcher.devicePermissions.v1';

/**
 * Per-install flag: this device has finished the location + notification prompts.
 * Cleared on reinstall; survives sign-out so the same phone isn’t re-prompted.
 */
export async function markDevicePermissionsComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(DEVICE_PERMISSIONS_KEY, '1');
  } catch (err) {
    logger.warn('devicePermissions', 'persist.fail', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readDevicePermissionsComplete(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_PERMISSIONS_KEY);
    return raw === '1';
  } catch {
    return false;
  }
}

/**
 * Whether this install still needs the device permission steps.
 * New installs / new devices → true until the user finishes the prompts.
 * Same install after an app update (location already granted) → false.
 */
export async function needsDevicePermissionsSetup(): Promise<boolean> {
  if (await readDevicePermissionsComplete()) return false;

  try {
    const [fg, bg] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    const access = locationAccessFromPermissions(fg, bg);
    if (isLocationAccessReady(access)) {
      // Already set up on this install (e.g. finished full onboarding here).
      await markDevicePermissionsComplete();
      return false;
    }
  } catch (err) {
    logger.warn('devicePermissions', 'probe.fail', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return true;
}
