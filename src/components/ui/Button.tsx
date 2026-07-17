import { type ReactNode, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, elevation, fonts, motion, radius, space, type } from '../../theme';

type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  children: ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  children,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;

  const animateTo = (value: number) => {
    Animated.timing(scale, {
      toValue: value,
      duration: motion.durationFast,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, (variant === 'primary' || variant === 'danger') && elevation.whisper]}>
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.base,
          variant === 'primary' && styles.primary,
          variant === 'ghost' && styles.ghost,
          variant === 'quiet' && styles.quiet,
          variant === 'danger' && styles.danger,
          isDisabled && styles.disabled,
          pressed && !isDisabled && styles.pressed,
          style,
        ]}
        onPressIn={(e) => {
          animateTo(motion.pressScale);
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          animateTo(1);
          onPressOut?.(e);
        }}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator
            color={
              variant === 'primary' || variant === 'danger'
                ? colors.onAccent
                : colors.accent
            }
          />
        ) : (
          <Text
            style={[
              styles.label,
              variant === 'primary' && styles.primaryLabel,
              variant === 'ghost' && styles.ghostLabel,
              variant === 'quiet' && styles.quietLabel,
              variant === 'danger' && styles.dangerLabel,
            ]}
          >
            {children}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.control,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  quiet: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.control,
  },
  danger: {
    backgroundColor: colors.danger,
    borderRadius: radius.control,
  },
  pressed: {
    opacity: 0.92,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    ...type.label,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    letterSpacing: -0.1,
  },
  primaryLabel: {
    color: colors.onAccent,
  },
  ghostLabel: {
    color: colors.accent,
  },
  quietLabel: {
    color: colors.inkSoft,
  },
  dangerLabel: {
    color: colors.onAccent,
  },
});
