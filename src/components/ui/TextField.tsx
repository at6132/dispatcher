import { forwardRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextInput as TextInputRef,
} from 'react-native';

import { colors, radius, space, type } from '../../theme';

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
  /** Trailing control (e.g. show/hide password) */
  trailing?: ReactNode;
};

export const TextField = forwardRef<TextInputRef, TextFieldProps>(
  function TextField(
    {
      label,
      error,
      hint,
      trailing,
      editable = true,
      onFocus,
      onBlur,
      style,
      ...rest
    },
    ref,
  ) {
    const [focused, setFocused] = useState(false);

    return (
      <View style={styles.wrap}>
        <Text style={styles.label} accessibilityRole="text">
          {label}
        </Text>
        <View
          style={[
            styles.field,
            focused && styles.fieldFocused,
            !!error && styles.fieldError,
            !editable && styles.fieldDisabled,
          ]}
        >
          <TextInput
            ref={ref}
            editable={editable}
            placeholderTextColor={colors.faint}
            selectionColor={colors.accent}
            accessibilityLabel={label}
            style={[styles.input, style]}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            {...rest}
          />
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
        {error ? (
          <Text
            nativeID={`${label}-error`}
            style={styles.error}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            {error}
          </Text>
        ) : hint ? (
          <Text nativeID={`${label}-hint`} style={styles.hint}>
            {hint}
          </Text>
        ) : null}
      </View>
    );
  },
);

type PasswordToggleProps = {
  visible: boolean;
  onToggle: () => void;
};

export function PasswordVisibilityToggle({
  visible,
  onToggle,
}: PasswordToggleProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      hitSlop={8}
      onPress={onToggle}
      style={styles.toggle}
    >
      <Text style={styles.toggleLabel}>{visible ? 'Hide' : 'Show'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
  },
  label: {
    ...type.label,
    color: colors.inkSoft,
  },
  field: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: 'rgba(255, 255, 255, 0.62)',
    paddingHorizontal: space.lg,
  },
  fieldFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.glassStrong,
  },
  fieldError: {
    borderColor: colors.danger,
  },
  fieldDisabled: {
    opacity: 0.55,
  },
  input: {
    flex: 1,
    ...type.body,
    color: colors.ink,
    paddingVertical: space.md,
  },
  trailing: {
    marginLeft: space.sm,
  },
  toggle: {
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
  },
  toggleLabel: {
    ...type.caption,
    fontWeight: '500',
    color: colors.accent,
  },
  error: {
    ...type.caption,
    color: colors.danger,
  },
  hint: {
    ...type.caption,
    color: colors.muted,
  },
});
