import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Star, X } from 'lucide-react-native';

import { getPublicProfile, type PublicProfile } from '../api/drives';
import { mapApiError } from '../api/errors';
import { addFavorite, removeFavorite } from '../api/favorites';
import { VEHICLE_CLASS_OPTIONS, type VehicleClass } from '../auth/types';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { DriverCard } from '../components/ui/DriverCard';
import { Icon } from '../components/ui/Icon';
import { MistBackdrop, colors, fonts, space, type } from '../theme';

type PublicProfileScreenProps = {
  visible: boolean;
  userId: string | null;
  /** Instant paint from an applicant / board row before the network returns. */
  seed?: PublicProfile | null;
  onClose: () => void;
  /** Fired after favorite add/remove so lists can refresh. */
  onFavoriteChange?: (userId: string, isFavorite: boolean) => void;
};

function vehicleClassLabel(value: VehicleClass | undefined): string | undefined {
  if (!value) return undefined;
  return VEHICLE_CLASS_OPTIONS.find((o) => o.value === value)?.label;
}

function drivesLabel(count: number): string {
  return count === 1 ? '1 completed drive' : `${count} completed drives`;
}

/**
 * Read-only public driver profile — what a dispatcher sees when opening
 * an applicant (or another driver’s) profile. No phone / Zelle.
 */
export function PublicProfileScreen({
  visible,
  userId,
  seed = null,
  onClose,
  onFavoriteChange,
}: PublicProfileScreenProps) {
  const insets = useSafeAreaInsets();
  const { user: me } = useAuth();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  const [profile, setProfile] = useState<PublicProfile | null>(seed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favoriting, setFavoriting] = useState(false);
  const [favError, setFavError] = useState<string | null>(null);

  const isSelf = Boolean(me?.id && userId && me.id === userId);
  const isFavorite = Boolean(profile?.isFavorite);

  useEffect(() => {
    if (visible && userId) {
      setMounted(true);
      setProfile(seed);
      setError(null);
      setFavError(null);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: 320,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }).start();

      let alive = true;
      setLoading(true);
      void getPublicProfile(userId)
        .then((fresh) => {
          if (!alive) return;
          setProfile(fresh);
        })
        .catch((err) => {
          if (!alive) return;
          if (!seed) setError(mapApiError(err).message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });

      return () => {
        alive = false;
      };
    }

    if (!mounted) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      easing: Easing.bezier(0.4, 0, 1, 0.2),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
        setProfile(null);
        setError(null);
        setFavError(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibility-driven
  }, [visible, userId]);

  const toggleFavorite = async () => {
    if (!userId || isSelf || favoriting) return;
    setFavoriting(true);
    setFavError(null);
    const prevFavorite = isFavorite;
    const next = !prevFavorite;
    // Optimistic
    setProfile((p) =>
      p
        ? {
            ...p,
            ...(next ? { isFavorite: true as const } : { isFavorite: undefined }),
          }
        : p,
    );
    try {
      if (next) {
        await addFavorite(userId);
      } else {
        await removeFavorite(userId);
      }
      onFavoriteChange?.(userId, next);
    } catch (err) {
      setProfile((p) =>
        p
          ? {
              ...p,
              ...(prevFavorite
                ? { isFavorite: true as const }
                : { isFavorite: undefined }),
            }
          : p,
      );
      setFavError(mapApiError(err).message);
    } finally {
      setFavoriting(false);
    }
  };

  const ob = profile?.onboarding;
  const detailParts: string[] = [];
  if (ob?.seats != null) detailParts.push(`${ob.seats} seats`);
  if (ob?.yearsDrivingUpstate != null) {
    detailParts.push(`${ob.yearsDrivingUpstate} yrs upstate`);
  }
  const classLabel = vehicleClassLabel(ob?.vehicleClass);
  if (classLabel) detailParts.push(classLabel);

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.root, { opacity: progress }]}>
        <MistBackdrop style={styles.fill} />

        <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            onPress={onClose}
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && styles.iconBtnPressed,
            ]}
          >
            <Icon icon={X} size="md" color={colors.inkSoft} />
          </Pressable>

          {!isSelf && profile ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isFavorite ? 'Remove from favorites' : 'Add to favorites'
              }
              accessibilityState={{ selected: isFavorite }}
              hitSlop={12}
              disabled={favoriting}
              onPress={() => void toggleFavorite()}
              style={({ pressed }) => [
                styles.favChip,
                isFavorite && styles.favChipOn,
                pressed && styles.iconBtnPressed,
                favoriting && styles.iconBtnDisabled,
              ]}
            >
              <Icon
                icon={Star}
                size="sm"
                color={isFavorite ? colors.accent : colors.inkSoft}
                fill={isFavorite ? colors.accent : 'transparent'}
              />
              <Text
                style={[
                  styles.favChipLabel,
                  isFavorite && styles.favChipLabelOn,
                ]}
              >
                {isFavorite ? 'Favorited' : 'Favorite'}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.topSpacer} />
          )}
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + space.xxl },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.lead}>Driver </Text>
            <Text style={styles.trail}>profile</Text>
          </View>
          <Text style={styles.support}>
            Public profile — what you see when reviewing applicants.
          </Text>

          {loading && !profile ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : error && !profile ? (
            <View style={styles.centered}>
              <Text style={styles.errorTitle}>Couldn’t load</Text>
              <Text style={styles.errorBody}>{error}</Text>
              <Button variant="ghost" onPress={onClose}>
                Close
              </Button>
            </View>
          ) : profile ? (
            <View style={styles.viewBlock}>
              <DriverCard
                photoUri={ob?.selfPhotoUri}
                vehicleInteriorUri={ob?.vehicleInteriorUri}
                vehicleExteriorUri={ob?.vehicleExteriorUri}
                name={profile.name}
                vehicleType={ob?.vehicleType}
                detail={detailParts.join(' · ') || undefined}
                showMap={false}
                highlighted={isFavorite}
              />

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Drives</Text>
                <Text style={styles.statValue}>
                  {drivesLabel(profile.completedDrivesCount ?? 0)}
                </Text>
              </View>

              {ob?.extraInfo ? (
                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>Notes</Text>
                  <Text style={styles.fieldValue}>{ob.extraInfo}</Text>
                </View>
              ) : null}

              {favError ? (
                <Text style={styles.favError} accessibilityRole="alert">
                  {favError}
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  iconBtnPressed: {
    opacity: 0.75,
  },
  iconBtnDisabled: {
    opacity: 0.4,
  },
  favChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  favChipOn: {
    backgroundColor: colors.accentMuted,
  },
  favChipLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.inkSoft,
  },
  favChipLabelOn: {
    color: colors.accent,
  },
  topSpacer: {
    width: 40,
  },
  content: {
    paddingHorizontal: space.xl,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: space.lg,
  },
  hero: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  lead: {
    ...type.hero,
    color: colors.ink,
  },
  trail: {
    ...type.heroItalic,
    color: colors.ink,
  },
  support: {
    ...type.body,
    color: colors.muted,
    marginTop: -space.sm,
    marginBottom: space.sm,
  },
  viewBlock: {
    gap: space.lg,
  },
  statRow: {
    gap: space.xs,
    paddingVertical: space.sm,
  },
  statLabel: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: fonts.sansSemi,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  fieldBlock: {
    gap: space.xs,
  },
  fieldLabel: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  fieldValue: {
    ...type.body,
    color: colors.inkSoft,
  },
  centered: {
    paddingTop: space.xxxl,
    alignItems: 'center',
    gap: space.md,
  },
  errorTitle: {
    ...type.title,
    color: colors.ink,
  },
  errorBody: {
    ...type.body,
    color: colors.muted,
    textAlign: 'center',
  },
  favError: {
    ...type.caption,
    color: colors.danger,
  },
});
