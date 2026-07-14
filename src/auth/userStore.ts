import * as SecureStore from 'expo-secure-store';

import { logger } from '../debug/logger';
import type { AuthUser, OnboardingProfile } from './types';

const USER_KEY = 'dispatcher.user.v1';
const PENDING_ONBOARDING_KEY = 'dispatcher.onboarding.pending.v1';

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

export async function persistUser(user: AuthUser): Promise<void> {
  try {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  } catch (err) {
    logger.warn('userStore', 'persist.fail', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readPersistedUser(): Promise<AuthUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAuthUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearPersistedUser(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(USER_KEY);
  } catch {
    // ignore
  }
}

export async function persistPendingOnboarding(
  profile: OnboardingProfile,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      PENDING_ONBOARDING_KEY,
      JSON.stringify(profile),
    );
  } catch (err) {
    logger.warn('userStore', 'pending_persist.fail', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readPendingOnboarding(): Promise<OnboardingProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_ONBOARDING_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Partial<OnboardingProfile>;
    if (
      typeof p.vehicleClass !== 'string' ||
      typeof p.vehicleType !== 'string' ||
      typeof p.seats !== 'number' ||
      typeof p.yearsDrivingUpstate !== 'number'
    ) {
      return null;
    }
    return p as OnboardingProfile;
  } catch {
    return null;
  }
}

export async function clearPendingOnboarding(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_ONBOARDING_KEY);
  } catch {
    // ignore
  }
}
