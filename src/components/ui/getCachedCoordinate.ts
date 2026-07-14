import * as Location from 'expo-location';

/**
 * Best-effort cached coordinate for apply — last-known first, then a quick fix.
 * Never blocks apply if permission / GPS is unavailable.
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

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: current.coords.latitude,
      lng: current.coords.longitude,
    };
  } catch {
    return null;
  }
}
