import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, space, type } from '../../theme';

type Option<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
};

export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: Props<T>) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.grid}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.field,
  },
  chipActive: {
    borderColor: colors.glassHighlight,
    backgroundColor: colors.accentMuted,
  },
  chipLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.inkSoft,
  },
  chipLabelActive: {
    color: colors.ink,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    paddingLeft: space.xs,
  },
});
