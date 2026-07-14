import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

import type { DriverCoordinate } from './DriverCard';

/**
 * Best-effort live coordinate when location permission allows it.
 */
export function useDriverCoordinate(enabled = true) {
  const [coordinate, setCoordinate] = useState<DriverCoordinate | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCoordinate(null);
      return;
    }

    try {
      const fg = await Location.getForegroundPermissionsAsync();
      if (fg.status !== Location.PermissionStatus.GRANTED) {
        setCoordinate(null);
        return;
      }

      const last = await Location.getLastKnownPositionAsync({
        maxAge: 5 * 60 * 1000,
        requiredAccuracy: 200,
      });
      if (last) {
        setCoordinate({
          latitude: last.coords.latitude,
          longitude: last.coords.longitude,
        });
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoordinate({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      });
    } catch {
      // Keep last-known / null — card shows waiting state.
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { coordinate, refresh };
}
