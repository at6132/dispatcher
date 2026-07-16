import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Heart } from 'lucide-react-native';

import { Icon } from './Icon';
import { colors, fonts, radius, space, type } from '../../theme';
import type { DriverAvailability } from '../../api/drives';

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
  /** Quiet steel wash — favorited applicant. */
  highlighted?: boolean;
  /** Opens full profile when set */
  onPress?: () => void;
  /** Shows a persistent heart on the avatar when true */
  favorited?: boolean;
  /** When set, shows a tappable heart (Favorite) on the card */
  onToggleFavorite?: () => void;
  favoriting?: boolean;
  /** Available / Busy / Offline chip */
  availability?: DriverAvailability;
};

function availabilityLabel(status: DriverAvailability | undefined) {
  switch (status) {
    case 'available':
      return 'Available';
    case 'busy':
      return 'Busy';
    default:
      return 'Offline';
  }
}

function availabilityTone(status: DriverAvailability | undefined) {
  switch (status) {
    case 'available':
      return colors.success;
    case 'busy':
      return colors.accent;
    default:
      return colors.muted;
  }
}

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
  highlighted = false,
  onPress,
  favorited = false,
  onToggleFavorite,
  favoriting = false,
  availability,
}: DriverCardProps) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const hasVehiclePhotos = Boolean(vehicleInteriorUri || vehicleExteriorUri);
  const typeLabel = vehicleType?.trim();
  const status = availability ?? 'offline';

  const heartBadge = favorited ? (
    <View style={styles.heartBadge} pointerEvents="none">
      <Icon
        icon={Heart}
        size={12}
        color={colors.danger}
        fill={colors.danger}
        strokeWidth={1.5}
      />
    </View>
  ) : null;

  const heartControl =
    onToggleFavorite != null ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={favorited ? 'Remove favorite' : 'Add favorite'}
        disabled={favoriting}
        hitSlop={8}
        onPress={(e) => {
          e.stopPropagation?.();
          onToggleFavorite();
        }}
        style={({ pressed }) => [
          styles.heartBadgeBtn,
          favorited && styles.heartBadgeBtnOn,
          pressed && styles.heartBtnPressed,
          favoriting && styles.heartBtnBusy,
        ]}
      >
        <Icon
          icon={Heart}
          size={12}
          color={favorited ? colors.danger : colors.inkSoft}
          fill={favorited ? colors.danger : 'transparent'}
          strokeWidth={favorited ? 2 : 1.7}
        />
      </Pressable>
    ) : null;

  const body = (
    <View
      style={[styles.card, highlighted && styles.cardHighlighted]}
      accessibilityRole="summary"
      accessibilityLabel={highlighted ? `${name}, favorite` : name}
    >
      {highlighted ? <Text style={styles.favoriteLabel}>Favorite</Text> : null}
      {showMap ? (
        <View style={styles.mapWrap}>
          {coordinate ? (
            <MapView
              key={`${coordinate.latitude},${coordinate.longitude}`}
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
              initialRegion={{
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
          {favorited && onToggleFavorite == null ? (
            <View style={styles.heartBadgeMap} pointerEvents="none">
              <Icon
                icon={Heart}
                size={14}
                color={colors.danger}
                fill={colors.danger}
                strokeWidth={1.5}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.body}>
        {availability != null ? (
          <View style={styles.statusTag}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: availabilityTone(status) },
              ]}
            />
            <Text style={styles.statusTagLabel}>
              {availabilityLabel(status)}
            </Text>
          </View>
        ) : null}
        <View style={styles.identity}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarEmpty}>
                  <Text style={styles.initial}>{initial}</Text>
                </View>
              )}
            </View>
            {heartControl ?? heartBadge}
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

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${name} profile`}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.92,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    overflow: 'hidden',
  },
  cardHighlighted: {
    borderColor: colors.accent,
    backgroundColor: colors.accentMuted,
  },
  favoriteLabel: {
    ...type.label,
    color: colors.accent,
    textTransform: 'uppercase',
    paddingTop: space.sm,
    paddingHorizontal: space.md,
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
  statusTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.accentMuted,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusTagLabel: {
    ...type.label,
    color: colors.inkSoft,
    textTransform: 'uppercase',
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  avatarWrap: {
    width: AVATAR,
    height: AVATAR,
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
  heartBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvasLift,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  heartBadgeBtn: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvasLift,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  heartBadgeBtnOn: {
    borderColor: 'rgba(224, 108, 117, 0.45)',
  },
  heartBadgeMap: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(27, 32, 38, 0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  heartBtnPressed: {
    opacity: 0.88,
  },
  heartBtnBusy: {
    opacity: 0.7,
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
