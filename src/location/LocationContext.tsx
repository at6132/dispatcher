import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { logger } from '../debug/logger';
import {
  ensureBackgroundLocationUpdates,
  getDriverLocation,
  stopBackgroundLocationUpdates,
  subscribeToDriverLocation,
  type DriverLocation,
} from './locationService';

type LocationContextValue = {
  location: DriverLocation | null;
  refreshLocation: () => Promise<DriverLocation | null>;
};

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const { status, user, updatePresence } = useAuth();
  const [location, setLocation] = useState<DriverLocation | null>(null);

  const refreshLocation = useCallback(() => getDriverLocation(), []);

  useEffect(() => subscribeToDriverLocation(setLocation), []);

  useEffect(() => {
    if (
      status !== 'authenticated' ||
      !user?.onboardingComplete
    ) {
      if (status === 'unauthenticated') {
        void stopBackgroundLocationUpdates().catch((err) => {
          logger.warn('location', 'stop_failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
      return;
    }

    let cancelled = false;
    const refreshAndSync = async () => {
      try {
        await ensureBackgroundLocationUpdates();
        const next = await getDriverLocation();
        if (
          cancelled ||
          !next ||
          (user.availability ?? 'offline') === 'offline'
        ) {
          return;
        }
        await updatePresence({ lat: next.lat, lng: next.lng });
      } catch (err) {
        logger.warn('location', 'foreground_sync_failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };

    void refreshAndSync();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refreshAndSync();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [
    status,
    user?.id,
    user?.onboardingComplete,
    user?.availability,
    updatePresence,
  ]);

  const value = useMemo(
    () => ({ location, refreshLocation }),
    [location, refreshLocation],
  );

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useDriverLocation(): LocationContextValue {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useDriverLocation must be used within LocationProvider');
  }
  return context;
}
