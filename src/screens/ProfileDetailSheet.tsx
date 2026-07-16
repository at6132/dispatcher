import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, X } from 'lucide-react-native';

import type { DriverAvailability } from '../api/drives';
import {
  listProfileHistory,
  type ProfileListItem,
  type ProfileTripHistoryItem,
} from '../api/profiles';
import { VEHICLE_CLASS_OPTIONS } from '../auth/types';
import { Button } from '../components/ui/Button';
import { DriverCard } from '../components/ui/DriverCard';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { MistBackdrop, colors, fonts, radius, space, type } from '../theme';

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

function vehicleClassLabel(value: string | undefined) {
  if (!value) return undefined;
  return (
    VEHICLE_CLASS_OPTIONS.find((o) => o.value === value)?.label ?? value
  );
}

function profileDetail(item: ProfileListItem): string | undefined {
  const o = item.onboarding;
  if (!o) return undefined;
  const parts: string[] = [];
  const klass = vehicleClassLabel(o.vehicleClass);
  if (klass) parts.push(klass);
  if (o.seats != null) parts.push(`${o.seats} seats`);
  if (o.yearsDrivingUpstate != null) {
    parts.push(
      `${o.yearsDrivingUpstate} yr${o.yearsDrivingUpstate === 1 ? '' : 's'} upstate`,
    );
  }
  return parts.length ? parts.join(' · ') : undefined;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

type ProfileDetailSheetProps = {
  visible: boolean;
  profile: ProfileListItem | null;
  favoriting?: boolean;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onToggleFavorite: () => void;
  onSendDirect: () => void;
};

/**
 * Full driver profile — photos, status, trip history, favorite + send.
 * Location is not shown here; only appears when sending a job to an online driver.
 */
export function ProfileDetailSheet({
  visible,
  profile,
  favoriting = false,
  loading = false,
  error = null,
  onClose,
  onToggleFavorite,
  onSendDirect,
}: ProfileDetailSheetProps) {
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<ProfileTripHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const status = profile?.availability ?? 'offline';
  const first =
    profile?.name?.trim().split(/\s+/).filter(Boolean)[0] || 'Driver';

  useEffect(() => {
    if (!visible || !profile?.id) {
      setHistory([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    const userId = profile.id;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void (async () => {
      try {
        const data = await listProfileHistory(userId, { limit: 30 });
        if (cancelled) return;
        setHistory(data.items ?? []);
      } catch {
        if (cancelled) return;
        setHistory([]);
        setHistoryError('Couldn’t load trip history.');
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, profile?.id]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <MistBackdrop style={styles.fill} />
        <View style={styles.screen}>
          <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.closeBtnPressed,
              ]}
            >
              <Icon icon={X} size="md" color={colors.inkSoft} />
            </Pressable>
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
              <Text style={styles.lead}>{first} </Text>
              <Text style={styles.trail}>profile</Text>
            </View>

            {loading && !profile ? (
              <LoadingHint label="Loading profile…" variant="block" />
            ) : error && !profile ? (
              <View style={styles.stateBlock}>
                <Text style={styles.errorText}>{error}</Text>
                <Button variant="ghost" onPress={onClose}>
                  Close
                </Button>
              </View>
            ) : profile ? (
              <>
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

                <DriverCard
                  name={profile.name}
                  vehicleType={profile.onboarding?.vehicleType}
                  detail={profileDetail(profile)}
                  notes={profile.onboarding?.extraInfo}
                  photoUri={profile.onboarding?.selfPhotoUri}
                  vehicleInteriorUri={profile.onboarding?.vehicleInteriorUri}
                  vehicleExteriorUri={profile.onboarding?.vehicleExteriorUri}
                  showMap={false}
                  favorited={profile.favorited}
                  availability={profile.availability ?? 'offline'}
                />

                <View style={styles.historyBlock}>
                  <Text style={styles.historyTitle}>Trip history</Text>
                  {historyLoading ? (
                    <LoadingHint label="Loading trips…" variant="block" />
                  ) : historyError ? (
                    <Text style={styles.historyEmpty}>{historyError}</Text>
                  ) : history.length === 0 ? (
                    <Text style={styles.historyEmpty}>
                      No completed drives yet.
                    </Text>
                  ) : (
                    <View style={styles.historyList}>
                      {history.map((trip) => {
                        const when = formatWhen(
                          trip.completedAt ?? trip.createdAt,
                        );
                        const tripLabel =
                          trip.tripType === 'round_trip'
                            ? 'Round trip'
                            : 'One way';
                        const meta = [
                          when,
                          tripLabel,
                          trip.costCents != null
                            ? formatMoney(trip.costCents)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        return (
                          <View key={trip.id} style={styles.historyRow}>
                            <Text style={styles.historyRoute} numberOfLines={2}>
                              {trip.routeText}
                            </Text>
                            {meta ? (
                              <Text style={styles.historyMeta}>{meta}</Text>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>

                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      profile.favorited
                        ? 'Remove from favorites'
                        : 'Add to favorites'
                    }
                    disabled={favoriting || loading}
                    onPress={onToggleFavorite}
                    style={({ pressed }) => [
                      styles.heartBtn,
                      profile.favorited && styles.heartBtnOn,
                      pressed && styles.heartBtnPressed,
                      (favoriting || loading) && styles.heartBtnDisabled,
                    ]}
                  >
                    <Icon
                      icon={Heart}
                      size={22}
                      color={profile.favorited ? colors.danger : colors.ink}
                      fill={profile.favorited ? colors.danger : 'transparent'}
                      strokeWidth={profile.favorited ? 2 : 1.75}
                    />
                    <Text
                      style={[
                        styles.heartLabel,
                        profile.favorited && styles.heartLabelOn,
                      ]}
                    >
                      {profile.favorited ? 'Favorited' : 'Favorite'}
                    </Text>
                  </Pressable>
                  <Button
                    disabled={loading}
                    onPress={() => {
                      onSendDirect();
                    }}
                  >
                    Send job
                  </Button>
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
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
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    alignItems: 'flex-end',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentMuted,
  },
  closeBtnPressed: {
    opacity: 0.85,
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
    paddingLeft: space.xs,
  },
  lead: {
    ...type.display,
    color: colors.ink,
  },
  trail: {
    fontFamily: fonts.displayItalic,
    fontSize: 36,
    letterSpacing: -0.6,
    lineHeight: 42,
    color: colors.ink,
  },
  statusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: -space.sm,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusTagLabel: {
    ...type.label,
    color: colors.inkSoft,
  },
  historyBlock: {
    gap: space.sm,
  },
  historyTitle: {
    ...type.label,
    color: colors.muted,
  },
  historyList: {
    gap: space.sm,
  },
  historyRow: {
    gap: 4,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.field,
  },
  historyRoute: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  historyMeta: {
    ...type.caption,
    color: colors.muted,
  },
  historyEmpty: {
    ...type.body,
    color: colors.faint,
  },
  actions: {
    gap: space.sm,
    marginTop: space.sm,
  },
  heartBtn: {
    minHeight: 56,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: space.xl,
    backgroundColor: colors.field,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  heartBtnOn: {
    backgroundColor: 'rgba(208, 138, 138, 0.14)',
    borderColor: colors.danger,
  },
  heartBtnPressed: {
    opacity: 0.9,
  },
  heartBtnDisabled: {
    opacity: 0.5,
  },
  heartLabel: {
    ...type.label,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  heartLabelOn: {
    color: colors.danger,
  },
  stateBlock: {
    gap: space.md,
    paddingVertical: space.xl,
  },
  errorText: {
    ...type.body,
    color: colors.danger,
  },
});
