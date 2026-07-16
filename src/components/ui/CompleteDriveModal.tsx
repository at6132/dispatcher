import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { completeDrive, type DriveListItem } from '../../api/drives';
import { mapApiError } from '../../api/errors';
import { colors, fonts, motion, radius, space, tripRouteColor, type } from '../../theme';
import { Button } from './Button';
import { TextField } from './TextField';

type CompleteDriveModalProps = {
  visible: boolean;
  drive: DriveListItem | null;
  onClose: () => void;
  onCompleted: (driveId: string, updated: Awaited<ReturnType<typeof completeDrive>>['drive']) => void;
};

function parseProfitCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const dollars = Number.parseFloat(cleaned);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function CompleteDriveModal({
  visible,
  drive,
  onClose,
  onCompleted,
}: CompleteDriveModalProps) {
  const [profit, setProfit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [doneCents, setDoneCents] = useState<number | null>(null);

  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.94)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0.72)).current;
  const formOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    setProfit('');
    setError(null);
    setSubmitting(false);
    setDoneCents(null);
    formOpacity.setValue(1);
    successOpacity.setValue(0);
    successScale.setValue(0.72);
    cardOpacity.setValue(0);
    cardScale.setValue(0.94);
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: motion.duration,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        friction: 8,
        tension: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, cardOpacity, cardScale, formOpacity, successOpacity, successScale]);

  const dismiss = () => {
    if (submitting || doneCents != null) return;
    Keyboard.dismiss();
    onClose();
  };

  const playSuccessThenFinish = (
    driveId: string,
    cents: number,
    updated: Awaited<ReturnType<typeof completeDrive>>['drive'],
  ) => {
    setDoneCents(cents);
    Animated.parallel([
      Animated.timing(formOpacity, {
        toValue: 0,
        duration: motion.durationFast,
        useNativeDriver: true,
      }),
      Animated.timing(successOpacity, {
        toValue: 1,
        duration: motion.duration,
        useNativeDriver: true,
      }),
      Animated.spring(successScale, {
        toValue: 1,
        friction: 6,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(cardOpacity, {
            toValue: 0,
            duration: motion.duration,
            useNativeDriver: true,
          }),
          Animated.timing(cardScale, {
            toValue: 0.96,
            duration: motion.duration,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onCompleted(driveId, updated);
        });
      }, 720);
    });
  };

  const onSubmit = async () => {
    if (!drive || submitting || doneCents != null) return;
    const cents = parseProfitCents(profit);
    if (cents == null) {
      setError('Enter the profit in dollars.');
      return;
    }
    setError(null);
    setSubmitting(true);
    Keyboard.dismiss();
    try {
      const result = await completeDrive(drive.id, { costCents: cents });
      playSuccessThenFinish(drive.id, cents, result.drive);
    } catch (err) {
      setError(mapApiError(err).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable
        style={styles.scrim}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoid}
        >
          <Pressable
            style={styles.cardHit}
            onPress={(e) => e.stopPropagation()}
          >
            <Animated.View
              style={[
                styles.card,
                {
                  opacity: cardOpacity,
                  transform: [{ scale: cardScale }],
                },
              ]}
            >
              <Animated.View style={{ opacity: formOpacity }}>
                <Text style={styles.eyebrow}>Complete drive</Text>
                <Text
                  style={[
                    styles.title,
                    {
                      color: drive
                        ? tripRouteColor(drive.status)
                        : colors.ink,
                    },
                  ]}
                  numberOfLines={2}
                >
                  {drive?.routeText ?? 'Drive'}
                </Text>
                <Text style={styles.support}>
                  Enter profit — that’s all you need.
                </Text>

                <View style={styles.fieldWrap}>
                  <TextField
                    label="Profit ($)"
                    value={profit}
                    onChangeText={(text) => {
                      setProfit(text);
                      if (error) setError(null);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    editable={!submitting && doneCents == null}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => void onSubmit()}
                    error={error ?? undefined}
                  />
                </View>

                <Button
                  loading={submitting}
                  disabled={submitting || doneCents != null}
                  onPress={() => void onSubmit()}
                >
                  Mark complete
                </Button>
              </Animated.View>

              {doneCents != null ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.successLayer,
                    {
                      opacity: successOpacity,
                      transform: [{ scale: successScale }],
                    },
                  ]}
                >
                  <Text style={styles.successEyebrow}>Logged</Text>
                  <Text style={styles.successAmount}>
                    {formatMoney(doneCents)}
                  </Text>
                  <Text style={styles.successTitle}>Profit saved</Text>
                  <Text style={styles.successBody}>Moving to History…</Text>
                </Animated.View>
              ) : null}
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    backgroundColor: 'rgba(27, 32, 38, 0.72)',
  },
  avoid: {
    width: '100%',
    alignItems: 'center',
  },
  cardHit: {
    width: '100%',
    maxWidth: 340,
  },
  card: {
    width: '100%',
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.canvasLift,
    overflow: 'hidden',
    minHeight: 240,
  },
  eyebrow: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.4,
    lineHeight: 34,
    color: colors.ink,
  },
  support: {
    ...type.body,
    color: colors.muted,
    marginBottom: space.xs,
  },
  fieldWrap: {
    marginBottom: space.xs,
  },
  successLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    backgroundColor: colors.canvasLift,
    gap: space.xs,
  },
  successEyebrow: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  successAmount: {
    fontFamily: fonts.display,
    fontSize: 44,
    letterSpacing: -0.8,
    lineHeight: 50,
    color: colors.success,
    marginVertical: space.xs,
  },
  successTitle: {
    ...type.title,
    color: colors.ink,
  },
  successBody: {
    ...type.caption,
    color: colors.muted,
  },
});
