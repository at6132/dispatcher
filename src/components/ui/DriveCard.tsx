import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check } from 'lucide-react-native';

import type { DriveListItem, DriveStatus } from '../../api/drives';
import { VEHICLE_CLASS_OPTIONS } from '../../auth/types';
import { colors, fonts, motion, radius, space, type } from '../../theme';
import { Icon } from './Icon';

export type DriveCardProps = {
  drive: DriveListItem;
  /** Current user — labels “You posted” / “You’re driving”. */
  viewerId?: string;
  /** Open board only — show Apply when the viewer didn’t post this drive. */
  onApply?: () => void;
  /** Open board only — show Manage when the viewer posted this drive. */
  onManage?: () => void;
  applying?: boolean;
  applied?: boolean;
};

function statusLabel(status: DriveStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'assigned':
      return 'Active';
    case 'completed':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
  }
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

/**
 * Board listing tile — route-first drive row for Open / Active / History.
 */
export function DriveCard({
  drive,
  viewerId,
  onApply,
  onManage,
  applying = false,
  applied = false,
}: DriveCardProps) {
  const isPoster = viewerId != null && drive.posterId === viewerId;
  const isAssignee = viewerId != null && drive.assigneeId === viewerId;
  const party = isPoster
    ? drive.assignee
    : isAssignee
      ? drive.poster
      : drive.poster;
  const partyLabel = isPoster
    ? drive.assignee
      ? 'Driver'
      : 'You posted'
    : isAssignee
      ? 'Posted by'
      : 'Posted by';
  const partyName =
    isPoster && !drive.assignee ? undefined : party?.name?.trim() || 'Driver';
  const photoUri = party?.onboarding?.selfPhotoUri;
  const initial = (partyName ?? 'Y').charAt(0).toUpperCase();

  const placeLine =
    drive.fromPlace || drive.toPlace
      ? [drive.fromPlace, drive.toPlace].filter(Boolean).join(' → ')
      : undefined;

  const classLabel = drive.vehicleClass
    ? (VEHICLE_CLASS_OPTIONS.find((o) => o.value === drive.vehicleClass)
        ?.label ?? drive.vehicleClass)
    : undefined;
  const tripLabel =
    drive.tripType === 'round_trip'
      ? 'Round trip'
      : drive.tripType === 'one_way'
        ? 'One way'
        : null;
  const vehicleHint = party?.onboarding?.vehicleType?.trim();
  const meta = [
    formatWhen(drive.completedAt ?? drive.createdAt),
    drive.costCents != null ? formatMoney(drive.costCents) : null,
    classLabel && drive.seats != null
      ? `${classLabel} · ${drive.seats} seats`
      : classLabel || vehicleHint,
    tripLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  const showApply = onApply != null && !isPoster;
  const showManage = onManage != null && isPoster;

  const pressScale = useRef(new Animated.Value(1)).current;
  const success = useRef(new Animated.Value(applied ? 1 : 0)).current;
  const checkScale = useRef(new Animated.Value(applied ? 1 : 0)).current;
  const checkRotate = useRef(new Animated.Value(applied ? 1 : 0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const wasApplied = useRef(applied);

  useEffect(() => {
    if (applied && !wasApplied.current) {
      success.setValue(0);
      checkScale.setValue(0.4);
      checkRotate.setValue(0);
      glow.setValue(0);

      Animated.parallel([
        Animated.spring(success, {
          toValue: 1,
          friction: 7,
          tension: 120,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.spring(checkScale, {
            toValue: 1.18,
            friction: 5,
            tension: 160,
            useNativeDriver: true,
          }),
          Animated.spring(checkScale, {
            toValue: 1,
            friction: 6,
            tension: 140,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(checkRotate, {
          toValue: 1,
          duration: motion.duration,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(glow, {
            toValue: 1,
            duration: motion.durationFast,
            useNativeDriver: true,
          }),
          Animated.timing(glow, {
            toValue: 0,
            duration: motion.durationSlow,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    } else if (applied) {
      success.setValue(1);
      checkScale.setValue(1);
      checkRotate.setValue(1);
    } else {
      success.setValue(0);
      checkScale.setValue(0);
      checkRotate.setValue(0);
      glow.setValue(0);
    }
    wasApplied.current = applied;
  }, [applied, success, checkScale, checkRotate, glow]);

  const checkSpin = checkRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-24deg', '0deg'],
  });

  const animatePress = (value: number) => {
    Animated.timing(pressScale, {
      toValue: value,
      duration: motion.durationFast,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={`${drive.routeText}, ${statusLabel(drive.status)}`}
    >
      <View style={styles.top}>
        <View style={styles.routeBlock}>
          <Text style={styles.route} numberOfLines={2}>
            {drive.routeText}
          </Text>
          {placeLine ? (
            <Text style={styles.places} numberOfLines={1}>
              {placeLine}
            </Text>
          ) : null}
        </View>
        <View
          style={[styles.badge, drive.status === 'open' && styles.badgeOpen]}
        >
          <Text
            style={[
              styles.badgeLabel,
              drive.status === 'open' && styles.badgeLabelOpen,
            ]}
          >
            {statusLabel(drive.status)}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.party}>
          <View style={styles.avatar}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarEmpty}>
                <Text style={styles.initial}>{initial}</Text>
              </View>
            )}
          </View>
          <View style={styles.partyMeta}>
            <Text style={styles.partyLabel}>{partyLabel}</Text>
            {partyName ? (
              <Text style={styles.partyName} numberOfLines={1}>
                {partyName}
              </Text>
            ) : null}
          </View>
        </View>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>

      {showManage ? (
        <Animated.View style={{ transform: [{ scale: pressScale }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Manage"
            onPress={onManage}
            onPressIn={() => animatePress(motion.pressScale)}
            onPressOut={() => animatePress(1)}
            style={({ pressed }) => [
              styles.manageBtn,
              pressed && styles.manageBtnPressed,
            ]}
          >
            <Text style={styles.manageLabel}>Manage</Text>
          </Pressable>
        </Animated.View>
      ) : showApply ? (
        applied ? (
          <View style={styles.successWrap}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.successGlow,
                {
                  opacity: glow.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 0.55],
                  }),
                  transform: [
                    {
                      scale: glow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.92, 1.06],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.successBtn,
                {
                  opacity: success,
                  transform: [
                    {
                      scale: success.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.92, 1],
                      }),
                    },
                  ],
                },
              ]}
              accessibilityRole="text"
              accessibilityLabel="Applied"
            >
              <Animated.View
                style={{
                  transform: [
                    { scale: checkScale },
                    { rotate: checkSpin },
                  ],
                }}
              >
                <View style={styles.checkCircle}>
                  <Icon icon={Check} size="sm" color={colors.success} />
                </View>
              </Animated.View>
              <Text style={styles.successLabel}>Applied</Text>
            </Animated.View>
          </View>
        ) : (
          <Animated.View style={{ transform: [{ scale: pressScale }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Apply"
              disabled={applying}
              onPress={onApply}
              onPressIn={() => animatePress(motion.pressScale)}
              onPressOut={() => animatePress(1)}
              style={({ pressed }) => [
                styles.applyBtn,
                applying && styles.applyBtnBusy,
                pressed && !applying && styles.applyBtnPressed,
              ]}
            >
              {applying ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.applyLabel}>Apply</Text>
              )}
            </Pressable>
          </Animated.View>
        )
      ) : null}
    </View>
  );
}

const AVATAR = 36;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    padding: space.md,
    gap: space.md,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  routeBlock: {
    flex: 1,
    gap: 2,
  },
  route: {
    fontFamily: fonts.sansSemi,
    fontSize: 17,
    letterSpacing: -0.2,
    lineHeight: 22,
    color: colors.ink,
  },
  places: {
    ...type.caption,
    color: colors.muted,
  },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.accentMuted,
  },
  badgeOpen: {
    backgroundColor: 'rgba(127, 168, 148, 0.18)',
  },
  badgeLabel: {
    ...type.label,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  badgeLabelOpen: {
    color: colors.success,
  },
  footer: {
    gap: space.sm,
  },
  party: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
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
    fontSize: 16,
    color: colors.accent,
  },
  partyMeta: {
    flex: 1,
    gap: 1,
  },
  partyLabel: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  partyName: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.inkSoft,
  },
  meta: {
    ...type.caption,
    color: colors.muted,
    paddingLeft: space.xs,
  },
  applyBtn: {
    minHeight: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    backgroundColor: colors.accent,
  },
  applyBtnBusy: {
    opacity: 0.85,
  },
  applyBtnPressed: {
    opacity: 0.92,
  },
  applyLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    letterSpacing: -0.1,
    color: colors.onAccent,
  },
  manageBtn: {
    minHeight: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    backgroundColor: colors.accentMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  manageBtnPressed: {
    opacity: 0.92,
  },
  manageLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    letterSpacing: -0.1,
    color: colors.ink,
  },
  successWrap: {
    position: 'relative',
  },
  successGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.control,
    backgroundColor: colors.success,
  },
  successBtn: {
    minHeight: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.xl,
    backgroundColor: 'rgba(127, 168, 148, 0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127, 168, 148, 0.45)',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127, 168, 148, 0.22)',
  },
  successLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    letterSpacing: -0.1,
    color: colors.success,
  },
});
