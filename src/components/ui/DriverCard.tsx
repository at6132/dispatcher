import { Image, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

import { colors, fonts, radius, space, type } from '../../theme';

export type DriverCoordinate = {
  latitude: number;
  longitude: number;
};

export type DriverCardProps = {
  photoUri?: string;
  vehicleInteriorUri?: string;
  vehicleExteriorUri?: string;
  name: string;
  /** Brand / model — shown on the same line as name */
  vehicleType?: string;
  phone?: string;
  /** e.g. 7 seats · 3 yrs upstate */
  detail?: string;
  /** Live / last-known position for the map */
  coordinate?: DriverCoordinate | null;
  /** Hide map (e.g. home screen) */
  showMap?: boolean;
};

const AVATAR = 48;
const VEHICLE_THUMB = 72;
const MAP_HEIGHT = 148;
const DELTA = 0.02;

/**
 * Canonical driver listing tile — what dispatchers see in the feed.
 * Presentational only. Keep edit / upload chrome outside this component.
 */
export function DriverCard({
  photoUri,
  vehicleInteriorUri,
  vehicleExteriorUri,
  name,
  vehicleType,
  phone,
  detail,
  coordinate,
  showMap = true,
}: DriverCardProps) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const hasVehiclePhotos = Boolean(vehicleInteriorUri || vehicleExteriorUri);
  const typeLabel = vehicleType?.trim();

  return (
    <View style={styles.card} accessibilityRole="summary">
      {showMap ? (
        <View style={styles.mapWrap}>
          {coordinate ? (
            <MapView
              style={styles.map}
              provider={PROVIDER_DEFAULT}
              pointerEvents="none"
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              showsCompass={false}
              showsPointsOfInterest={false}
              region={{
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                latitudeDelta: DELTA,
                longitudeDelta: DELTA,
              }}
            >
              <Marker coordinate={coordinate} />
            </MapView>
          ) : (
            <View style={styles.mapEmpty}>
              <Text style={styles.mapEmptyText}>Waiting for location</Text>
            </View>
          )}
        </View>
      ) : null}

      <View style={styles.body}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarEmpty}>
                <Text style={styles.initial}>{initial}</Text>
              </View>
            )}
          </View>
          <View style={styles.meta}>
            <Text style={styles.nameLine} numberOfLines={1}>
              <Text style={styles.name}>{name}</Text>
              {typeLabel ? (
                <Text style={styles.vehicleType}>
                  {' · '}
                  {typeLabel}
                </Text>
              ) : null}
            </Text>
            {phone ? (
              <Text style={styles.phone} numberOfLines={1}>
                {phone}
              </Text>
            ) : null}
            {detail ? (
              <Text style={styles.detail} numberOfLines={2}>
                {detail}
              </Text>
            ) : null}
          </View>
        </View>

        {hasVehiclePhotos ? (
          <View style={styles.vehicleRow}>
            {vehicleExteriorUri ? (
              <View style={styles.vehicleThumb}>
                <Image
                  source={{ uri: vehicleExteriorUri }}
                  style={styles.vehicleImage}
                />
                <Text style={styles.vehicleCaption}>Exterior</Text>
              </View>
            ) : null}
            {vehicleInteriorUri ? (
              <View style={styles.vehicleThumb}>
                <Image
                  source={{ uri: vehicleInteriorUri }}
                  style={styles.vehicleImage}
                />
                <Text style={styles.vehicleCaption}>Interior</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    overflow: 'hidden',
  },
  mapWrap: {
    height: MAP_HEIGHT,
    backgroundColor: colors.canvasDeep,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapEmptyText: {
    ...type.caption,
    color: colors.faint,
  },
  body: {
    padding: space.md,
    gap: space.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    backgroundColor: colors.canvasDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentMuted,
  },
  initial: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.accent,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    fontSize: 17,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  name: {
    fontFamily: fonts.sansSemi,
    fontSize: 17,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  vehicleType: {
    fontFamily: fonts.sansSemi,
    fontSize: 17,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  phone: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  detail: {
    ...type.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  vehicleRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  vehicleThumb: {
    flex: 1,
    gap: space.xs,
  },
  vehicleImage: {
    width: '100%',
    height: VEHICLE_THUMB,
    borderRadius: radius.sm,
    backgroundColor: colors.canvasDeep,
  },
  vehicleCaption: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
    paddingLeft: 2,
  },
});
