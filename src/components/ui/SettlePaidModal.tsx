import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  confirmBalanceReceived,
  markBalancePaid,
  markPlatformFeePaid,
} from '../../api/balances';
import { createIdempotencyKey } from '../../api/client';
import { mapApiError } from '../../api/errors';
import { uploadPaymentProof } from '../../api/photos';
import { colors, fonts, motion, radius, space, type } from '../../theme';
import { Button } from './Button';
import { PhotoPickerField } from './PhotoPickerField';

export type SettlePaidTarget = {
  key: string;
  name: string;
  amountLabel: string;
  tripLabel: string;
  balanceIds: string[];
  action: 'markPaid' | 'confirmReceived';
  kind?: 'balance' | 'platformFee';
};

type Props = {
  visible: boolean;
  target: SettlePaidTarget | null;
  onClose: () => void;
  onSettled: () => void;
};

export function SettlePaidModal({
  visible,
  target,
  onClose,
  onSettled,
}: Props) {
  const [proofUri, setProofUri] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.94)).current;
  const mutationKeysRef = useRef(new Map<string, string>());
  const settlementProofKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!visible) return;
    mutationKeysRef.current.clear();
    settlementProofKeyRef.current = undefined;
    setProofUri(undefined);
    setError(null);
    setSubmitting(false);
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
  }, [visible, target?.key, cardOpacity, cardScale]);

  const dismiss = () => {
    if (submitting) return;
    Keyboard.dismiss();
    onClose();
  };

  const onSubmit = async () => {
    if (!target || submitting) return;
    setError(null);
    setSubmitting(true);
    Keyboard.dismiss();
    try {
      let settlementProofKey = settlementProofKeyRef.current;
      if (target.action === 'markPaid' && proofUri && !settlementProofKey) {
        try {
          settlementProofKey = await uploadPaymentProof(proofUri);
          settlementProofKeyRef.current = settlementProofKey;
        } catch {
          setError('Couldn’t upload screenshot. Try again or remove it.');
          setSubmitting(false);
          return;
        }
      }

      const kind = target.kind ?? 'balance';
      for (const id of target.balanceIds) {
        const action = `${target.key}:${target.action}:${kind}:${id}`;
        const idempotencyKey =
          mutationKeysRef.current.get(action) ?? createIdempotencyKey();
        mutationKeysRef.current.set(action, idempotencyKey);
        if (target.action === 'markPaid') {
          if (kind === 'platformFee') {
            await markPlatformFeePaid(id, {
              settlementProofKey,
              idempotencyKey,
            });
          } else {
            await markBalancePaid(id, {
              settlementProofKey,
              idempotencyKey,
            });
          }
        } else {
          await confirmBalanceReceived(id, { idempotencyKey });
        }
      }
      mutationKeysRef.current.clear();
      settlementProofKeyRef.current = undefined;
      onSettled();
    } catch (err) {
      setError(mapApiError(err).message);
      setSubmitting(false);
    }
  };

  const isPlatform = target?.kind === 'platformFee';
  const markPaidLabel = isPlatform ? 'Mark sent' : 'Mark paid';

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
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollInner}
              >
                <Text style={styles.eyebrow}>
                  {target?.action === 'markPaid'
                    ? markPaidLabel
                    : 'Confirm payment'}
                </Text>
                <Text style={styles.title} numberOfLines={2}>
                  {target?.name ??
                    (isPlatform
                      ? 'Platform'
                      : target?.action === 'markPaid'
                        ? 'Dispatcher'
                        : 'Driver')}
                </Text>
                <Text style={styles.support}>
                  {target
                    ? target.action === 'markPaid'
                      ? isPlatform
                        ? `${target.amountLabel} · ${target.tripLabel}. Send the 2% platform fee off-app, then mark sent. Optional screenshot.`
                        : `${target.amountLabel} · ${target.tripLabel}. Optional: add a Zelle or bank confirmation screenshot.`
                      : `${target.amountLabel} · ${target.tripLabel}. Confirm only after the payment reaches you.`
                    : null}
                </Text>

                {target?.action === 'markPaid' ? (
                  <PhotoPickerField
                    label="Confirmation"
                    hint="Zelle or bank receipt"
                    uri={proofUri}
                    onChange={(uri) => {
                      setProofUri(uri);
                      mutationKeysRef.current.clear();
                      settlementProofKeyRef.current = undefined;
                      if (error) setError(null);
                    }}
                    variant="rect"
                    compact
                  />
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <View style={styles.actions}>
                  <Button
                    loading={submitting}
                    disabled={submitting}
                    onPress={() => void onSubmit()}
                  >
                    {target?.action === 'markPaid'
                      ? markPaidLabel
                      : 'Mark received'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={submitting}
                    onPress={dismiss}
                  >
                    Cancel
                  </Button>
                </View>
              </ScrollView>
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
    maxHeight: '86%',
  },
  card: {
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.canvasLift,
    overflow: 'hidden',
  },
  scrollInner: {
    padding: space.xl,
    gap: space.md,
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
  error: {
    ...type.caption,
    color: colors.danger,
  },
  actions: {
    gap: space.sm,
    marginTop: space.xs,
  },
});
