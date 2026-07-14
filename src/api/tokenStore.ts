import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'dispatcher.access.v1';
const REFRESH_KEY = 'dispatcher.refresh.v1';

export async function getAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ACCESS_KEY);
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

export async function setTokens(input: {
  accessToken: string;
  refreshToken: string;
}): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, input.accessToken);
  await SecureStore.setItemAsync(REFRESH_KEY, input.refreshToken);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
