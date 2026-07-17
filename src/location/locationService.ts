import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { savePresence } from '../auth/sessionStore';
import { readPersistedUser } from '../auth/userStore';
import { logger } from '../debug/logger';

export type DriverLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: number;
};

const BACKGROUND_LOCATION_TASK = 'dispatcher.background-location.v1';
const LOCATION_CACHE_KEY = 'dispatcher.location.latest.v1';
const PENDING_LOCATION_KEY = 'dispatcher.location.pending.v1';
const CONFIRMED_LOCATION_TIMESTAMP_KEY =
  'dispatcher.location.confirmed-timestamp.v1';
const MAX_CACHED_AGE_MS = 5 * 60 * 1000;
const MAX_CACHED_ACCURACY_METERS = 200;
const CURRENT_FIX_TIMEOUT_MS = 8_000;

function isRunningInExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

let latestLocation: DriverLocation | null = null;
let refreshInFlight: Promise<DriverLocation | null> | null = null;
let presenceSyncQueue: Promise<void> = Promise.resolve();
const listeners = new Set<(location: DriverLocation) => void>();

type PendingLocation = Pick<DriverLocation, 'lat' | 'lng' | 'timestamp'>;

function fromLocationObject(location: Location.LocationObject): DriverLocation {
  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy,
    timestamp: location.timestamp,
  };
}

function isUsableCachedLocation(location: DriverLocation): boolean {
  const freshEnough = Date.now() - location.timestamp <= MAX_CACHED_AGE_MS;
  const accurateEnough =
    location.accuracy == null ||
    location.accuracy <= MAX_CACHED_ACCURACY_METERS;
  return freshEnough && accurateEnough;
}

async function publishLocation(
  location: DriverLocation,
): Promise<DriverLocation> {
  latestLocation = location;
  listeners.forEach((listener) => listener(location));
  try {
    await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(location));
  } catch (err) {
    logger.warn('location', 'cache_write_failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return location;
}

async function readStoredLocation(): Promise<DriverLocation | null> {
  if (latestLocation) return latestLocation;
  try {
    const raw = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<DriverLocation>;
    if (
      typeof value.lat !== 'number' ||
      typeof value.lng !== 'number' ||
      typeof value.timestamp !== 'number'
    ) {
      return null;
    }
    latestLocation = {
      lat: value.lat,
      lng: value.lng,
      accuracy: typeof value.accuracy === 'number' ? value.accuracy : null,
      timestamp: value.timestamp,
    };
    return latestLocation;
  } catch {
    return null;
  }
}

async function readPendingLocation(): Promise<PendingLocation | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_LOCATION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingLocation>;
    if (
      typeof value.lat !== 'number' ||
      typeof value.lng !== 'number' ||
      typeof value.timestamp !== 'number'
    ) {
      await AsyncStorage.removeItem(PENDING_LOCATION_KEY);
      return null;
    }
    return {
      lat: value.lat,
      lng: value.lng,
      timestamp: value.timestamp,
    };
  } catch {
    return null;
  }
}

async function storePendingLocation(location: PendingLocation): Promise<void> {
  const pending = await readPendingLocation();
  if (pending && pending.timestamp > location.timestamp) return;
  await AsyncStorage.setItem(PENDING_LOCATION_KEY, JSON.stringify(location));
}

async function readConfirmedTimestamp(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(CONFIRMED_LOCATION_TIMESTAMP_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

async function confirmLocationTimestamp(timestamp: number): Promise<void> {
  await AsyncStorage.setItem(
    CONFIRMED_LOCATION_TIMESTAMP_KEY,
    String(timestamp),
  );
}

async function runPresenceSync(location: PendingLocation): Promise<void> {
  let confirmedTimestamp = await readConfirmedTimestamp();
  const pending = await readPendingLocation();

  if (pending && pending.timestamp <= confirmedTimestamp) {
    await AsyncStorage.removeItem(PENDING_LOCATION_KEY);
  } else if (pending) {
    try {
      await savePresence({ lat: pending.lat, lng: pending.lng });
      confirmedTimestamp = Math.max(confirmedTimestamp, pending.timestamp);
      await confirmLocationTimestamp(confirmedTimestamp);
      await AsyncStorage.removeItem(PENDING_LOCATION_KEY);
    } catch (err) {
      logger.warn('location', 'pending_sync_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (location.timestamp <= confirmedTimestamp) return;

  try {
    await savePresence({ lat: location.lat, lng: location.lng });
    await confirmLocationTimestamp(location.timestamp);
    const remaining = await readPendingLocation();
    if (remaining && remaining.timestamp <= location.timestamp) {
      await AsyncStorage.removeItem(PENDING_LOCATION_KEY);
    }
  } catch (err) {
    await storePendingLocation(location);
    throw err;
  }
}

async function syncPresenceLocation(location: PendingLocation): Promise<void> {
  const run = presenceSyncQueue.then(() => runPresenceSync(location));
  presenceSyncQueue = run.catch(() => undefined);
  return run;
}

async function syncIfDriverIsVisible(
  location: PendingLocation,
): Promise<void> {
  const user = await readPersistedUser();
  if (!user || (user.availability ?? 'offline') === 'offline') return;
  await syncPresenceLocation(location);
}

async function publishForegroundLocation(
  location: DriverLocation,
): Promise<DriverLocation> {
  const published = await publishLocation(location);
  void syncIfDriverIsVisible(published).catch((err) => {
    logger.warn('location', 'foreground_sync_failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  });
  return published;
}

/**
 * The one device-location read path used by presence, applying, and UI.
 * It prefers a recent fix, then asks iOS/Android for a balanced current fix.
 */
export async function getDriverLocation(): Promise<DriverLocation | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const foreground = await Location.getForegroundPermissionsAsync();
      if (foreground.status !== Location.PermissionStatus.GRANTED) return null;

      const stored = await readStoredLocation();
      if (stored && isUsableCachedLocation(stored)) {
        return publishForegroundLocation(stored);
      }

      const nativeCached = await Location.getLastKnownPositionAsync({
        maxAge: MAX_CACHED_AGE_MS,
        requiredAccuracy: MAX_CACHED_ACCURACY_METERS,
      });
      if (nativeCached) {
        return publishForegroundLocation(fromLocationObject(nativeCached));
      }

      const currentFix = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }).then((location) =>
        publishForegroundLocation(fromLocationObject(location)),
      );

      return await Promise.race([
        currentFix,
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), CURRENT_FIX_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      logger.warn('location', 'refresh_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export function subscribeToDriverLocation(
  listener: (location: DriverLocation) => void,
): () => void {
  listeners.add(listener);
  if (latestLocation) listener(latestLocation);
  return () => listeners.delete(listener);
}

export async function ensureBackgroundLocationUpdates(): Promise<boolean> {
  if (isRunningInExpoGo()) return false;

  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  if (
    foreground.status !== Location.PermissionStatus.GRANTED ||
    background.status !== Location.PermissionStatus.GRANTED
  ) {
    return false;
  }

  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
    return true;
  }

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    activityType: Location.ActivityType.OtherNavigation,
    distanceInterval: 500,
    deferredUpdatesDistance: 500,
    deferredUpdatesInterval: 5 * 60 * 1000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Dispatcher location is on',
      notificationBody: 'Updating your location while you are available.',
    },
  });
  logger.info('location', 'background_started');
  return true;
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  if (
    !isRunningInExpoGo() &&
    (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK))
  ) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    logger.info('location', 'background_stopped');
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  BACKGROUND_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      logger.warn('location', 'background_error', { message: error.message });
      return;
    }

    const nativeLocation = data?.locations.at(-1);
    if (!nativeLocation) return;
    const location = await publishLocation(fromLocationObject(nativeLocation));

    // Keep exact location private when the driver is Offline.
    try {
      await syncIfDriverIsVisible(location);
    } catch (err) {
      logger.warn('location', 'background_sync_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
