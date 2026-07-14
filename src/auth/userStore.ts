import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { logger } from '../debug/logger';
import type { AuthUser, OnboardingProfile } from './types';

const USER_KEY = 'dispatcher.user.v1';
const PENDING_ONBOARDING_KEY = 'dispatcher.onboarding.pending.v1';

/**
 * Session profile + pending onboarding live in AsyncStorage (not SecureStore).
 * SecureStore caps values at ~2KB on iOS — photo URI drafts blow past that and
 * silently drop the “finished onboarding” flag / retry payload.
 * Tokens stay in SecureStore via tokenStore.
 */

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object') return false;
  const u = value as Record<string, unknown>;
  return (
    typeof u.id === 'string' &&
    typeof u.phone === 'string' &&
    typeof u.name === 'string' &&
    typeof u.onboardingComplete === 'boolean'
  );
}

function isOnboardingProfile(value: unknown): value is OnboardingProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<OnboardingProfile>;
  return (
    typeof p.vehicleClass === 'string' &&
    typeof p.vehicleType === 'string' &&
    typeof p.seats === 'number' &&
    typeof p.yearsDrivingUpstate === 'number'
  );
}

async function readLegacySecure(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function clearLegacySecure(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export async function persistUser(user: AuthUser): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    // Drop legacy SecureStore copy so a failed 2KB write can’t shadow this.
    await clearLegacySecure(USER_KEY);
  } catch (err) {
    logger.warn('userStore', 'persist.fail', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readPersistedUser(): Promise<AuthUser | null> {
  try {
    const raw =
      (await AsyncStorage.getItem(USER_KEY)) ??
      (await readLegacySecure(USER_KEY));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isAuthUser(parsed)) return null;
    // Migrate SecureStore → AsyncStorage once.
    if (!(await AsyncStorage.getItem(USER_KEY))) {
      await AsyncStorage.setItem(USER_KEY, raw);
      await clearLegacySecure(USER_KEY);
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPersistedUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
  await clearLegacySecure(USER_KEY);
}

export async function persistPendingOnboarding(
  profile: OnboardingProfile,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PENDING_ONBOARDING_KEY,
      JSON.stringify(profile),
    );
    await clearLegacySecure(PENDING_ONBOARDING_KEY);
  } catch (err) {
    logger.warn('userStore', 'pending_persist.fail', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readPendingOnboarding(): Promise<OnboardingProfile | null> {
  try {
    const raw =
      (await AsyncStorage.getItem(PENDING_ONBOARDING_KEY)) ??
      (await readLegacySecure(PENDING_ONBOARDING_KEY));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isOnboardingProfile(parsed)) return null;
    if (!(await AsyncStorage.getItem(PENDING_ONBOARDING_KEY))) {
      await AsyncStorage.setItem(PENDING_ONBOARDING_KEY, raw);
      await clearLegacySecure(PENDING_ONBOARDING_KEY);
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingOnboarding(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_ONBOARDING_KEY);
  } catch {
    // ignore
  }
  await clearLegacySecure(PENDING_ONBOARDING_KEY);
}
