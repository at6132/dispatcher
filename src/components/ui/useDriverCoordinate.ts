import { useMemo } from 'react';

import { useDriverLocation } from '../../location/LocationContext';

/** Map-friendly view of the app's unified device-location source. */
export function useDriverCoordinate(enabled = true) {
  const { location, refreshLocation } = useDriverLocation();
  const coordinate = useMemo(
    () =>
      enabled && location
        ? { latitude: location.lat, longitude: location.lng }
        : null,
    [enabled, location],
  );
  return { coordinate, refresh: refreshLocation };
}
