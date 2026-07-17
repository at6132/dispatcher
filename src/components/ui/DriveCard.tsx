import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check } from 'lucide-react-native';

import type {
  DriveBoard,
  DriveListItem,
  DriveStatus,
} from '../../api/drives';
import { VEHICLE_CLASS_OPTIONS } from '../../auth/types';
import {
  digitsOnly,
  formatPhoneDisplay,
} from '../../auth/validation';
import {
  colors,
  fonts,
  motion,
  radius,
  space,
  tripRouteColor,
  type,
} from '../../theme';
import { Icon } from './Icon';
import { MapPreview } from './MapExpand';

export type DriveCardProps = {
  drive: DriveListItem;
  /** Board section this card is listed under — sharpens route title color. */
  board?: DriveBoard;
  /** Current user — labels “You posted” / “You’re driving”. */
  viewerId?: string;
  /** Open board only — show Apply when the viewer didn’t post this drive. */
  onApply?: () => void;
  /** Open board only — show Manage when the viewer posted this drive. */
  onManage?: () => void;
  /** Active board — mark passenger picked up (assigned → picked_up). */
  onPickedUp?: () => void;
  /** Active board — complete after pickup (picked_up). */
  onComplete?: () => void;
  /** Active board — assignee requests cancel (needs poster approve). */
  onRequestCancel?: () => void;
  /** Open the other party’s full profile. */
  onOpenProfile?: (userId: string) => void;
  applying?: boolean;
  applied?: boolean;
  pickingUp?: boolean;
  cancelling?: boolean;
  /** Shown under Apply when the last attempt failed (e.g. mid-job). */
  applyError?: string | null;
  /** After poster clears submissions — CTA label becomes Apply again. */
  applyAgain?: boolean;
  /** Dispatched section — map of driver apply location + status chip. */
  showMap?: boolean;
  /**
   * History board — absolute trip index (oldest completed = 0).
   * When set, meta shows trip + date/time instead of date-only.
   */
  tripNumber?: number;
};

const MAP_HEIGHT = 132;

function statusLabel(status: DriveStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'assigned':
      return 'Accepted';
    case 'picked_up':
      return 'Picked up';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
  }
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function formatWhen(iso: string, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  if (!withTime) return date;
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}

async function openUrl(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    // Device may not have the app; ignore.
  }
}

function whatsappUrl(phone: string): string {
  const digits = digitsOnly(phone);
  return `https://wa.me/${digits}`;
}

function telUrl(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return `tel:${trimmed}`;
  return `tel:+${digitsOnly(trimmed)}`;
}

function mapsUrls(address: string): { label: string; url: string }[] {
  const q = encodeURIComponent(address);
  const options: { label: string; url: string }[] = [
    {
      label: 'Apple Maps',
      url:
        Platform.OS === 'ios'
          ? `http://maps.apple.com/?q=${q}`
          : `geo:0,0?q=${q}`,
    },
    {
      label: 'Google Maps',
      url: `https://www.google.com/maps/search/?api=1&query=${q}`,
    },
    {
      label: 'Waze',
      url: `https://waze.com/ul?q=${q}&navigate=yes`,
    },
  ];
  if (Platform.OS === 'android') {
    // Prefer native Android map chooser first.
    return [
      { label: 'Maps', url: `geo:0,0?q=${q}` },
      ...options.filter((o) => o.label !== 'Apple Maps'),
    ];
  }
  return options;
}

type ChoiceSheetProps = {
  visible: boolean;
  title: string;
  options: { label: string; onPress: () => void }[];
  onClose: () => void;
};

function ChoiceSheet({ visible, title, options, onClose }: ChoiceSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.choiceScrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Pressable
          style={styles.choiceCard}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.choiceTitle}>{title}</Text>
          {options.map((opt) => (
            <Pressable
              key={opt.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                opt.onPress();
              }}
              style={({ pressed }) => [
                styles.choiceRow,
                pressed && styles.choiceRowPressed,
              ]}
            >
              <Text style={styles.choiceLabel}>{opt.label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.choiceCancel,
              pressed && styles.choiceRowPressed,
            ]}
          >
            <Text style={styles.choiceCancelLabel}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Board listing tile — route-first drive row for Open / Active / History.
 */
export function DriveCard({
  drive,
  board,
  viewerId,
  onApply,
  onManage,
  onPickedUp,
  onComplete,
  onRequestCancel,
  onOpenProfile,
  applying = false,
  applied = false,
  pickingUp = false,
  cancelling = false,
  applyError = null,
  applyAgain = false,
  showMap = false,
  tripNumber,
}: DriveCardProps) {
  const [phoneSheetOpen, setPhoneSheetOpen] = useState(false);
  const [mapsSheetOpen, setMapsSheetOpen] = useState(false);
  const routeColor = tripRouteColor(drive.status, board);
  const isPoster = viewerId != null && drive.posterId === viewerId;
  const isAssignee = viewerId != null && drive.assigneeId === viewerId;
  const party = isPoster
    ? drive.assignee
    : isAssignee
      ? drive.poster
      : drive.poster;
  const partyId =
    party?.id ??
    (isPoster
      ? drive.assigneeId
      : isAssignee
        ? drive.posterId
        : drive.posterId);
  const canOpenParty =
    onOpenProfile != null &&
    partyId != null &&
    partyId !== viewerId &&
    !(isPoster && !drive.assignee);
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
  const mapCoordinate =
    drive.assigneeLat != null && drive.assigneeLng != null
      ? { latitude: drive.assigneeLat, longitude: drive.assigneeLng }
      : null;
  const status = statusLabel(drive.status);

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
  const historyMeta = tripNumber != null;
  const whenIso = drive.completedAt ?? drive.updatedAt ?? drive.createdAt;
  const meta = [
    historyMeta ? `Trip ${tripNumber}` : null,
    formatWhen(whenIso, historyMeta),
    drive.costCents != null ? formatMoney(drive.costCents) : null,
    classLabel && drive.seats != null
      ? `${classLabel} · ${drive.seats} seats`
      : classLabel || vehicleHint,
    tripLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  const showApply = onApply != null && !isPoster;
  /** Pickup / complete are driver actions — not for rides you dispatched. */
  const showPickedUp =
    onPickedUp != null && drive.status === 'assigned' && isAssignee;
  const showComplete =
    onComplete != null && drive.status === 'picked_up' && isAssignee;
  const cancelPending = Boolean(drive.cancelRequestedAt);
  const showRequestCancel =
    onRequestCancel != null &&
    isAssignee &&
    (drive.status === 'assigned' || drive.status === 'picked_up');
  const showManagePrimary =
    onManage != null && isPoster && !showPickedUp && !showComplete;
  const showManageSecondary =
    onManage != null && isPoster && (showPickedUp || showComplete);
  const manageLabel = cancelPending ? 'Review cancel' : 'Manage';

  const passengerPhone = drive.passengerPhone?.trim();
  const passengerAddress = drive.address?.trim();
  const passengerExtra = drive.extraInfo?.trim();
  const showPassengerContact =
    isAssignee &&
    (drive.status === 'assigned' || drive.status === 'picked_up') &&
    Boolean(passengerPhone || passengerAddress || passengerExtra);

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

  const statusBadge = (placement: 'inline' | 'onMap' = 'inline') => (
    <View
      style={[
        styles.badge,
        drive.status === 'open' && styles.badgeOpen,
        drive.status === 'assigned' && styles.badgeAssigned,
        drive.status === 'picked_up' && styles.badgePickedUp,
        drive.status === 'completed' && styles.badgeCompleted,
        placement === 'onMap' && styles.badgeOnMap,
      ]}
    >
      <Text
        style={[
          styles.badgeLabel,
          drive.status === 'open' && styles.badgeLabelOpen,
          drive.status === 'assigned' && styles.badgeLabelAssigned,
          drive.status === 'picked_up' && styles.badgeLabelPickedUp,
          drive.status === 'completed' && styles.badgeLabelCompleted,
          placement === 'onMap' && styles.badgeLabelLifted,
        ]}
      >
        {status}
      </Text>
    </View>
  );

  return (
    <View
      style={[styles.card, showMap && styles.cardWithMap]}
      accessibilityRole="summary"
      accessibilityLabel={`${drive.routeText}, ${status}`}
    >
      {showMap ? (
        <MapPreview
          coordinate={mapCoordinate}
          height={MAP_HEIGHT}
          title={drive.routeText}
          subtitle={partyName ? `${partyName} · ${status}` : status}
          markerTitle={partyName ?? 'Driver'}
          badge={statusBadge('onMap')}
        />
      ) : null}

      <View style={[styles.body, showMap && styles.bodyWithMap]}>
        <View style={styles.top}>
          <View style={styles.routeBlock}>
            <Text style={[styles.route, { color: routeColor }]} numberOfLines={2}>
              {drive.routeText}
            </Text>
            {placeLine ? (
              <Text style={styles.places} numberOfLines={1}>
                {placeLine}
              </Text>
            ) : null}
          </View>
          {showMap ? null : statusBadge('inline')}
        </View>

        {showPassengerContact ? (
          <View style={styles.passengerBlock}>
            {passengerPhone ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Passenger phone ${formatPhoneDisplay(passengerPhone)}`}
                onPress={() => setPhoneSheetOpen(true)}
                style={({ pressed }) => [
                  styles.passengerHit,
                  pressed && styles.passengerHitPressed,
                ]}
              >
                <Text style={styles.phoneBig}>
                  {formatPhoneDisplay(passengerPhone)}
                </Text>
                <Text style={styles.contactHint}>Call or WhatsApp</Text>
              </Pressable>
            ) : null}
            {passengerAddress ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Address ${passengerAddress}`}
                onPress={() => setMapsSheetOpen(true)}
                style={({ pressed }) => [
                  styles.passengerHit,
                  pressed && styles.passengerHitPressed,
                ]}
              >
                <Text style={styles.addressText}>{passengerAddress}</Text>
                <Text style={styles.contactHint}>Open in maps</Text>
              </Pressable>
            ) : null}
            {passengerExtra ? (
              <Text style={styles.extraInfo}>{passengerExtra}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.footer}>
          {canOpenParty && partyName ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${partyName} profile`}
              hitSlop={10}
              onPress={() => onOpenProfile?.(partyId)}
              style={({ pressed }) => [
                styles.party,
                pressed && styles.partyPressed,
              ]}
            >
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
                <Text style={styles.partyName} numberOfLines={1}>
                  {partyName}
                </Text>
                {party?.availability ? (
                  <Text style={styles.partyStatus} numberOfLines={1}>
                    {party.availability === 'available'
                      ? 'Available'
                      : party.availability === 'busy'
                        ? 'Busy'
                        : 'Offline'}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ) : (
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
                {party?.availability ? (
                  <Text style={styles.partyStatus} numberOfLines={1}>
                    {party.availability === 'available'
                      ? 'Available'
                      : party.availability === 'busy'
                        ? 'Busy'
                        : 'Offline'}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>

        {showPickedUp ? (
          <View style={styles.ctaStack}>
            <Animated.View style={{ transform: [{ scale: pressScale }] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Picked up"
                disabled={pickingUp || cancelPending}
                onPress={onPickedUp}
                onPressIn={() => animatePress(motion.pressScale)}
                onPressOut={() => animatePress(1)}
                style={({ pressed }) => [
                  styles.applyBtn,
                  (pickingUp || cancelPending) && styles.applyBtnBusy,
                  pressed && !pickingUp && !cancelPending && styles.applyBtnPressed,
                ]}
              >
                {pickingUp ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.applyLabel}>Picked up</Text>
                )}
              </Pressable>
            </Animated.View>
            {showRequestCancel ? (
              cancelPending ? (
                <Text style={styles.cancelPendingHint}>
                  Waiting for dispatcher to approve cancel
                </Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Request cancel"
                  disabled={cancelling}
                  onPress={onRequestCancel}
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    cancelling && styles.applyBtnBusy,
                    pressed && !cancelling && styles.cancelBtnPressed,
                  ]}
                >
                  {cancelling ? (
                    <ActivityIndicator color={colors.danger} />
                  ) : (
                    <Text style={styles.cancelLabel}>Cancel ride</Text>
                  )}
                </Pressable>
              )
            ) : null}
            {showManageSecondary ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={manageLabel}
                onPress={onManage}
                style={({ pressed }) => [
                  styles.manageBtn,
                  pressed && styles.manageBtnPressed,
                ]}
              >
                <Text style={styles.manageLabel}>{manageLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : showComplete ? (
          <View style={styles.ctaStack}>
            <Animated.View style={{ transform: [{ scale: pressScale }] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Complete drive"
                disabled={cancelPending}
                onPress={onComplete}
                onPressIn={() => animatePress(motion.pressScale)}
                onPressOut={() => animatePress(1)}
                style={({ pressed }) => [
                  styles.applyBtn,
                  cancelPending && styles.applyBtnBusy,
                  pressed && !cancelPending && styles.applyBtnPressed,
                ]}
              >
                <Text style={styles.applyLabel}>Complete drive</Text>
              </Pressable>
            </Animated.View>
            {showRequestCancel ? (
              cancelPending ? (
                <Text style={styles.cancelPendingHint}>
                  Waiting for dispatcher to approve cancel
                </Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Request cancel"
                  disabled={cancelling}
                  onPress={onRequestCancel}
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    cancelling && styles.applyBtnBusy,
                    pressed && !cancelling && styles.cancelBtnPressed,
                  ]}
                >
                  {cancelling ? (
                    <ActivityIndicator color={colors.danger} />
                  ) : (
                    <Text style={styles.cancelLabel}>Cancel ride</Text>
                  )}
                </Pressable>
              )
            ) : null}
            {showManageSecondary ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={manageLabel}
                onPress={onManage}
                style={({ pressed }) => [
                  styles.manageBtn,
                  pressed && styles.manageBtnPressed,
                ]}
              >
                <Text style={styles.manageLabel}>{manageLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : showManagePrimary ? (
          <Animated.View style={{ transform: [{ scale: pressScale }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={manageLabel}
              onPress={onManage}
              onPressIn={() => animatePress(motion.pressScale)}
              onPressOut={() => animatePress(1)}
              style={({ pressed }) => [
                styles.manageBtn,
                pressed && styles.manageBtnPressed,
              ]}
            >
              <Text style={styles.manageLabel}>{manageLabel}</Text>
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
                accessibilityLabel={applyAgain ? 'Apply again' : 'Apply'}
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
                  <Text style={styles.applyLabel}>
                    {applyAgain ? 'Apply again' : 'Apply'}
                  </Text>
                )}
              </Pressable>
            </Animated.View>
          )
        ) : null}
      </View>

      {applyError && showApply && !applied ? (
        <Text style={styles.applyError} accessibilityRole="alert">
          {applyError}
        </Text>
      ) : null}

      {passengerPhone ? (
        <ChoiceSheet
          visible={phoneSheetOpen}
          title="Contact passenger"
          options={[
            {
              label: 'Call',
              onPress: () => void openUrl(telUrl(passengerPhone)),
            },
            {
              label: 'WhatsApp',
              onPress: () => void openUrl(whatsappUrl(passengerPhone)),
            },
          ]}
          onClose={() => setPhoneSheetOpen(false)}
        />
      ) : null}

      {passengerAddress ? (
        <ChoiceSheet
          visible={mapsSheetOpen}
          title="Open address"
          options={mapsUrls(passengerAddress).map((opt) => ({
            label: opt.label,
            onPress: () => void openUrl(opt.url),
          }))}
          onClose={() => setMapsSheetOpen(false)}
        />
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
  },
  cardWithMap: {
    overflow: 'hidden',
  },
  body: {
    padding: space.md,
    gap: space.md,
  },
  bodyWithMap: {
    paddingTop: space.md,
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
  badgeOnMap: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    backgroundColor: 'rgba(27, 32, 38, 0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  badgeLabelLifted: {
    color: colors.ink,
  },
  badgeOpen: {
    backgroundColor: 'rgba(127, 168, 148, 0.18)',
  },
  badgeAssigned: {
    backgroundColor: 'rgba(176, 194, 204, 0.22)',
  },
  badgePickedUp: {
    backgroundColor: 'rgba(176, 194, 204, 0.28)',
  },
  badgeCompleted: {
    backgroundColor: 'rgba(127, 168, 148, 0.22)',
  },
  badgeLabel: {
    ...type.label,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  badgeLabelOpen: {
    color: colors.success,
  },
  badgeLabelAssigned: {
    color: colors.inkSoft,
  },
  badgeLabelPickedUp: {
    color: colors.ink,
  },
  badgeLabelCompleted: {
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
  partyPressed: {
    opacity: 0.88,
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
  partyStatus: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  meta: {
    ...type.caption,
    color: colors.muted,
    paddingLeft: space.xs,
  },
  ctaStack: {
    gap: space.sm,
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
  applyError: {
    ...type.caption,
    color: colors.danger,
    marginTop: space.sm,
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
  cancelBtn: {
    minHeight: 44,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(208, 138, 138, 0.45)',
  },
  cancelBtnPressed: {
    opacity: 0.85,
  },
  cancelLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    letterSpacing: -0.1,
    color: colors.danger,
  },
  cancelPendingHint: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: space.sm,
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
  passengerBlock: {
    gap: space.sm,
    paddingTop: space.xs,
  },
  passengerHit: {
    gap: 2,
  },
  passengerHitPressed: {
    opacity: 0.85,
  },
  phoneBig: {
    fontFamily: fonts.sansSemi,
    fontSize: 26,
    letterSpacing: -0.4,
    lineHeight: 32,
    color: colors.ink,
  },
  addressText: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    letterSpacing: -0.2,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  contactHint: {
    ...type.caption,
    color: colors.faint,
  },
  extraInfo: {
    ...type.body,
    color: colors.muted,
    marginTop: space.xs,
  },
  choiceScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(27, 32, 38, 0.72)',
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
  },
  choiceCard: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.canvasLift,
  },
  choiceTitle: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  choiceRow: {
    minHeight: 48,
    borderRadius: radius.control,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    backgroundColor: colors.accentMuted,
  },
  choiceRowPressed: {
    opacity: 0.88,
  },
  choiceLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    letterSpacing: -0.1,
    color: colors.ink,
  },
  choiceCancel: {
    minHeight: 48,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  choiceCancelLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.muted,
  },
});
