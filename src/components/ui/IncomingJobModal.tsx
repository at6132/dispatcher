import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import {
  acceptDirectInvite,
  declineDirectInvite,
  type DriveListItem,
} from '../../api/drives';
import { createIdempotencyKey } from '../../api/client';
import { mapApiError } from '../../api/errors';
import { VEHICLE_CLASS_OPTIONS } from '../../auth/types';
import {
  formatPhoneDisplay,
} from '../../auth/validation';
import { colors, fonts, motion, radius, space, type } from '../../theme';
import { Button } from './Button';
import { Icon } from './Icon';

type IncomingJobModalProps = {
  visible: boolean;
  drive: DriveListItem | null;
  onClose: () => void;
  onAccepted: () => void;
  onDeclined: () => void;
};

/**
 * Solid (non-glass) overlay for a direct job offer — full details + Accept / Decline.
 */
export function IncomingJobModal({
  visible,
  drive,
  onClose,
  onAccepted,
  onDeclined,
}: IncomingJobModalProps) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;
  const acceptKeyRef = useRef<string | null>(null);
  const declineKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    acceptKeyRef.current = null;
    declineKeyRef.current = null;
    setBusy(null);
    setError(null);
    opacity.setValue(0);
    scale.setValue(0.94);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.duration,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, drive?.id, opacity, scale]);

  if (!drive) return null;

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
  const posterName = drive.poster?.name?.trim() || 'Dispatcher';

  const onAccept = async () => {
    const idempotencyKey =
      acceptKeyRef.current ?? (acceptKeyRef.current = createIdempotencyKey());
    setBusy('accept');
    setError(null);
    try {
      await acceptDirectInvite(drive.id, { idempotencyKey });
      acceptKeyRef.current = null;
      onAccepted();
    } catch (err) {
      const mapped = mapApiError(err);
      setError(mapped.message);
    } finally {
      setBusy(null);
    }
  };

  const onDecline = async () => {
    const idempotencyKey =
      declineKeyRef.current ?? (declineKeyRef.current = createIdempotencyKey());
    setBusy('decline');
    setError(null);
    try {
      await declineDirectInvite(drive.id, { idempotencyKey });
      declineKeyRef.current = null;
      onDeclined();
    } catch (err) {
      const mapped = mapApiError(err);
      setError(mapped.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <View style={styles.scrim}>
        <Animated.View
          style={[
            styles.card,
            {
              marginTop: insets.top + space.lg,
              marginBottom: insets.bottom + space.lg,
              opacity,
              transform: [{ scale }],
            },
          ]}
        >
          <View style={styles.topRow}>
            <Text style={styles.eyebrow}>Direct job</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              hitSlop={12}
              disabled={busy != null}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.closePressed,
              ]}
            >
              <Icon icon={X} size="md" color={colors.inkSoft} />
            </Pressable>
          </View>

          <Text style={styles.route}>{drive.routeText}</Text>
          {drive.fromPlace || drive.toPlace ? (
            <Text style={styles.places}>
              {[drive.fromPlace, drive.toPlace].filter(Boolean).join(' → ')}
            </Text>
          ) : null}

          <View style={styles.metaBlock}>
            <MetaRow label="From" value={posterName} />
            {tripLabel ? <MetaRow label="Trip" value={tripLabel} /> : null}
            {classLabel ? (
              <MetaRow
                label="Vehicle"
                value={
                  drive.seats != null
                    ? `${classLabel} · ${drive.seats} seats`
                    : classLabel
                }
              />
            ) : null}
            {drive.passengerPhone ? (
              <MetaRow
                label="Passenger"
                value={formatPhoneDisplay(drive.passengerPhone)}
              />
            ) : null}
            {drive.address ? (
              <MetaRow label="Address" value={drive.address} />
            ) : null}
            {drive.extraInfo ? (
              <MetaRow label="Notes" value={drive.extraInfo} />
            ) : null}
          </View>

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              loading={busy === 'accept'}
              disabled={busy != null}
              onPress={() => void onAccept()}
            >
              Accept job
            </Button>
            <Button
              variant="ghost"
              loading={busy === 'decline'}
              disabled={busy != null}
              onPress={() => void onDecline()}
            >
              Decline
            </Button>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(27, 32, 38, 0.82)',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.canvasLift,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.xl,
    gap: space.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    ...type.label,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvasDeep,
  },
  closePressed: {
    opacity: 0.85,
  },
  route: {
    fontFamily: fonts.sansSemi,
    fontSize: 22,
    letterSpacing: -0.3,
    lineHeight: 28,
    color: colors.success,
  },
  places: {
    ...type.caption,
    color: colors.muted,
    marginTop: -space.sm,
  },
  metaBlock: {
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  metaRow: {
    gap: 2,
  },
  metaLabel: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  metaValue: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    letterSpacing: -0.1,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  error: {
    ...type.caption,
    color: colors.danger,
  },
  actions: {
    gap: space.sm,
    marginTop: space.xs,
  },
});
