import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, space, type } from '../../theme';

type Props = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  error?: string;
  hint?: string;
};

export function NumberStepper({
  label,
  value,
  min = 1,
  max = 20,
  onChange,
  error,
  hint,
}: Props) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.row}>
        <Pressable
          onPress={dec}
          style={styles.btn}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
        >
          <Text style={styles.btnLabel}>−</Text>
        </Pressable>
        <Text style={styles.value}>{value}</Text>
        <Pressable
          onPress={inc}
          style={styles.btn}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
        >
          <Text style={styles.btnLabel}>+</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
  },
  label: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  hint: {
    ...type.caption,
    color: colors.faint,
    paddingLeft: space.xs,
    marginTop: -space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  btn: {
    width: 48,
    height: 48,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 22,
    color: colors.ink,
    lineHeight: 26,
  },
  value: {
    ...type.display,
    color: colors.ink,
    minWidth: 48,
    textAlign: 'center',
  },
  error: {
    ...type.caption,
    color: colors.danger,
    paddingLeft: space.xs,
  },
});
