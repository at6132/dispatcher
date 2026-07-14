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
  try {
    const data = await apiFetch<MeResponse>('/v1/me');
    return toUser(data.user);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 0) return null;
    throw err;
  }
}

export async function createAccount(input: {
  phone: string;
  name: string;
  password: string;
}): Promise<AuthUser> {
  const data = await apiFetch<AuthResponse>('/v1/auth/signup', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(input),
  });
  return persistAuth(data);
}

export async function authenticateAccount(input: {
  phone: string;
  password: string;
}): Promise<AuthUser> {
  const data = await apiFetch<AuthResponse>('/v1/auth/login', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(input),
  });
  return persistAuth(data);
}

export async function saveOnboarding(
  _phone: string,
  profile: OnboardingProfile,
): Promise<AuthUser> {
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
  return toUser(data.user);
}

export async function clearSession(): Promise<void> {
  try {
    const { getRefreshToken } = await import('../api/tokenStore');
    const refreshToken = await getRefreshToken();
    await apiFetch('/v1/auth/logout', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // best-effort logout
  } finally {
    await clearTokens();
  }
}
