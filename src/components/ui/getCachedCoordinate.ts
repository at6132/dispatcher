import * as Location from 'expo-location';

const FIX_TIMEOUT_MS = 2500;

/**
 * Best-effort cached coordinate — last-known first, then a quick fix with timeout.
 * Never hangs callers (presence chips / apply).
 */
export async function getCachedCoordinate(): Promise<{
  lat: number;
  lng: number;
} | null> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== Location.PermissionStatus.GRANTED) return null;

    const last = await Location.getLastKnownPositionAsync({
      maxAge: 5 * 60 * 1000,
      requiredAccuracy: 200,
    });
    if (last) {
      return {
        lat: last.coords.latitude,
        lng: last.coords.longitude,
      };
    }

    const current = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), FIX_TIMEOUT_MS),
      ),
    ]);
    if (!current) return null;
    return {
      lat: current.coords.latitude,
      lng: current.coords.longitude,
    };
  } catch {
    return null;
  }
}
