import { StyleSheet, Text, View } from 'react-native';

import {
  passwordStrength,
  type PasswordStrength as Strength,
} from '../../auth/validation';
import { colors, radius, space, type } from '../../theme';

const LABELS: Record<Exclude<Strength, 'empty'>, string> = {
  weak: 'Weak',
  okay: 'Okay',
  strong: 'Strong',
};

const FILL: Record<Exclude<Strength, 'empty'>, string> = {
  weak: colors.danger,
  okay: colors.accent,
  strong: colors.success,
};

const LEVEL: Record<Exclude<Strength, 'empty'>, number> = {
  weak: 1,
  okay: 2,
  strong: 3,
};

type Props = {
  password: string;
};

export function PasswordStrengthMeter({ password }: Props) {
  const strength = passwordStrength(password);
  if (strength === 'empty') return null;

  const level = LEVEL[strength];

  return (
    <View style={styles.wrap} accessibilityLabel={`Password strength: ${LABELS[strength]}`}>
      <View style={styles.bars}>
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            style={[
              styles.bar,
              n <= level
                ? { backgroundColor: FILL[strength] }
                : styles.barEmpty,
            ]}
          />
        ))}
      </View>
      <Text style={styles.label}>{LABELS[strength]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: -space.xs,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    gap: space.xs,
  },
  bar: {
    flex: 1,
    height: 3,
    borderRadius: radius.sm,
  },
  barEmpty: {
    backgroundColor: colors.hairline,
  },
  label: {
    ...type.caption,
    color: colors.muted,
    minWidth: 44,
    textAlign: 'right',
  },
});
