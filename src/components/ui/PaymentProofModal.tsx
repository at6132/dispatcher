import { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, motion, radius, space, type } from '../../theme';
import { Button } from './Button';

type Props = {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
};

export function PaymentProofModal({ visible, uri, onClose }: Props) {
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    if (!visible) return;
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
  }, [visible, uri, cardOpacity, cardScale]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
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
            <View style={styles.header}>
              <Text style={styles.eyebrow}>Payment confirmation</Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollInner}
              bounces={false}
            >
              {uri ? (
                <Image
                  source={{ uri }}
                  style={styles.image}
                  resizeMode="contain"
                  accessibilityLabel="Payment confirmation screenshot"
                />
              ) : null}
            </ScrollView>
            <View style={styles.footer}>
              <Button variant="ghost" onPress={onClose}>
                Close
              </Button>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    backgroundColor: 'rgba(27, 32, 38, 0.78)',
  },
  cardHit: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '88%',
  },
  card: {
    width: '100%',
    maxHeight: '100%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.canvasLift,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  eyebrow: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  scrollInner: {
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: 420,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  footer: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    paddingTop: space.sm,
  },
});
