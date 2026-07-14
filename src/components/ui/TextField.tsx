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

import { colors, fonts, radius, space, type } from '../../theme';

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
  trailing?: ReactNode;
};

export const TextField = forwardRef<TextInputRef, TextFieldProps>(
  function TextField(
    {
      label,
      error,
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
        <View
          style={[
            styles.field,
            focused && styles.fieldFocused,
            !!error && styles.fieldError,
            !editable && styles.disabled,
          ]}
        >
          <View style={styles.inner}>
            <Text style={[styles.label, focused && styles.labelFocused]}>
              {label}
            </Text>
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
          </View>
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
        {error ? (
          <Text
            style={styles.error}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            {error}
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
      hitSlop={10}
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
  field: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.field,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  fieldFocused: {
    borderColor: colors.glassHighlight,
    backgroundColor: colors.fieldFocus,
  },
  fieldError: {
    borderColor: colors.danger,
  },
  disabled: {
    opacity: 0.55,
  },
  inner: {
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
  label: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  labelFocused: {
    color: colors.accent,
  },
  input: {
    ...type.body,
    color: colors.ink,
    paddingVertical: 0,
    margin: 0,
  },
  trailing: {
    marginLeft: space.sm,
    alignSelf: 'center',
  },
  toggle: {
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
  },
  toggleLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.accent,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    paddingLeft: space.sm,
  },
});
