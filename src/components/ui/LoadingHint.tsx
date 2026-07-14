import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, space, type } from '../../theme';

type Props = {
  label: string;
  /** Compact under a CTA; full for boot / screen-level waits */
  variant?: 'inline' | 'block';
};

/**
 * Quiet busy affordance for slow / low-data networks.
 * Pair with Button `loading` — don’t nest a second spinner in the button.
 */
export function LoadingHint({ label, variant = 'inline' }: Props) {
  if (variant === 'block') {
    return (
      <View style={styles.block} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.blockLabel}>{label}</Text>
      </View>
    );
  }

  return (
    <Text
      style={styles.inline}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  inline: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
  },
  block: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  blockLabel: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
  },
});
