import { logger } from '../debug/logger';
import { apiFetch, type TokenResponse } from '../api/client';
import { clearTokens, setTokens } from '../api/tokenStore';
import type { AuthUser, OnboardingProfile } from './types';

type AuthUserApi = AuthUser & { status?: 'active' | 'locked' };

type MeResponse = { user: AuthUserApi };
type AuthResponse = TokenResponse & { user: AuthUserApi };

function toUser(user: AuthUserApi): AuthUser {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    onboardingComplete: user.onboardingComplete,
    ...(user.onboarding ? { onboarding: user.onboarding } : {}),
  };
}

async function persistAuth(data: AuthResponse): Promise<AuthUser> {
  await setTokens({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
  return toUser(data.user);
}

export async function getSessionUser(): Promise<AuthUser | null> {
  logger.info('session', 'bootstrap.start');
  try {
    const data = await apiFetch<MeResponse>('/v1/me');
    const user = toUser(data.user);
    logger.info('session', 'bootstrap.ok', {
      userId: user.id,
      onboardingComplete: user.onboardingComplete,
    });
    return user;
  } catch (err) {
    const status = (err as { status?: number }).status;
    const code = (err as { code?: string }).code;
    if (status === 401 || status === 0) {
      logger.info('session', 'bootstrap.no_session', { status, code });
      return null;
    }
    logger.error('session', 'bootstrap.error', {
      status,
      code,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function createAccount(input: {
  phone: string;
  name: string;
  password: string;
}): Promise<AuthUser> {
  logger.info('session', 'signup.start', {
    phoneTail: input.phone.slice(-4),
    nameLen: input.name.trim().length,
  });
  const data = await apiFetch<AuthResponse>('/v1/auth/signup', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(input),
  });
  const user = await persistAuth(data);
  logger.info('session', 'signup.ok', {
    userId: user.id,
    onboardingComplete: user.onboardingComplete,
  });
  return user;
}

export async function authenticateAccount(input: {
  phone: string;
  password: string;
}): Promise<AuthUser> {
  logger.info('session', 'login.start', { phoneTail: input.phone.slice(-4) });
  const data = await apiFetch<AuthResponse>('/v1/auth/login', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(input),
  });
  const user = await persistAuth(data);
  logger.info('session', 'login.ok', {
    userId: user.id,
    onboardingComplete: user.onboardingComplete,
  });
  return user;
}

export async function saveOnboarding(
  _phone: string,
  profile: OnboardingProfile,
): Promise<AuthUser> {
  logger.info('session', 'onboarding.start', {
    vehicleClass: profile.vehicleClass,
    vehicleType: profile.vehicleType,
    seats: profile.seats,
    yearsDrivingUpstate: profile.yearsDrivingUpstate,
    hasSelfPhoto: Boolean(profile.selfPhotoUri),
    hasInterior: Boolean(profile.vehicleInteriorUri),
    hasExterior: Boolean(profile.vehicleExteriorUri),
    hasZelle: Boolean(profile.zelle),
  });

  // Upload local photo URIs when present, then send object keys.
  const photoKeys: {
    selfPhotoKey?: string;
    vehicleInteriorKey?: string;
    vehicleExteriorKey?: string;
  } = {};

  const { uploadLocalPhotoIfNeeded } = await import('../api/photos');

  if (profile.selfPhotoUri) {
    const key = await uploadLocalPhotoIfNeeded(profile.selfPhotoUri, 'self');
    if (key) photoKeys.selfPhotoKey = key;
  }
  if (profile.vehicleInteriorUri) {
    const key = await uploadLocalPhotoIfNeeded(
      profile.vehicleInteriorUri,
      'interior',
    );
    if (key) photoKeys.vehicleInteriorKey = key;
  }
  if (profile.vehicleExteriorUri) {
    const key = await uploadLocalPhotoIfNeeded(
      profile.vehicleExteriorUri,
      'exterior',
    );
    if (key) photoKeys.vehicleExteriorKey = key;
  }

  logger.info('session', 'onboarding.put', {
    photoKeys: Object.keys(photoKeys),
  });

  const data = await apiFetch<MeResponse>('/v1/me/onboarding', {
    method: 'PUT',
    body: JSON.stringify({
      vehicleClass: profile.vehicleClass,
      vehicleType: profile.vehicleType,
      seats: profile.seats,
      yearsDrivingUpstate: profile.yearsDrivingUpstate,
      ...(profile.extraInfo ? { extraInfo: profile.extraInfo } : {}),
      ...(profile.zelle ? { zelle: profile.zelle } : {}),
      ...photoKeys,
    }),
  });
  const user = toUser(data.user);
  logger.info('session', 'onboarding.ok', {
    userId: user.id,
    onboardingComplete: user.onboardingComplete,
  });
  if (!user.onboardingComplete) {
    logger.error('session', 'onboarding.incomplete_after_put', {
      userId: user.id,
    });
  }
  return user;
}

export async function clearSession(): Promise<void> {
  logger.info('session', 'logout.start');
  try {
    const { getRefreshToken } = await import('../api/tokenStore');
    const refreshToken = await getRefreshToken();
    await apiFetch('/v1/auth/logout', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ refreshToken }),
    });
  } catch (err) {
    logger.warn('session', 'logout.api_failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await clearTokens();
    logger.info('session', 'logout.done');
  }
}
