import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/AuthContext';
import type { AuthMode } from '../../auth/types';
import {
  formatPhoneDisplay,
  hasFieldErrors,
  normalizePhone,
  validateAuthForm,
  type AuthFormValues,
} from '../../auth/validation';
import { GlassSurface, colors, radius, space, type } from '../../theme';
import { Button } from '../../components/ui/Button';
import { PasswordStrengthMeter } from '../../components/ui/PasswordStrength';
import { PasswordVisibilityToggle, TextField } from '../../components/ui/TextField';

const EMPTY: AuthFormValues = {
  name: '',
  phone: '',
  password: '',
  confirmPassword: '',
};

type Touched = Partial<Record<keyof AuthFormValues, boolean>>;

type Props = {
  onForgotPassword: () => void;
};

export function AuthScreen({ onForgotPassword }: Props) {
  const insets = useSafeAreaInsets();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signIn');
  const [values, setValues] = useState<AuthFormValues>(EMPTY);
  const [touched, setTouched] = useState<Touched>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const errors = validateAuthForm(mode, values);
  const show = (field: keyof AuthFormValues) =>
    (submitted || touched[field]) && errors[field] ? errors[field] : undefined;

  const setField = useCallback(<K extends keyof AuthFormValues>(key: K, value: AuthFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
  }, []);

  const touch = useCallback((key: keyof AuthFormValues) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
  }, []);

  const switchMode = (next: AuthMode) => {
    if (next === mode) return;
    setMode(next);
    setTouched({});
    setSubmitted(false);
    setFormError(null);
    setValues((prev) => ({
      ...EMPTY,
      phone: prev.phone,
    }));
  };

  const onSubmit = async () => {
    setSubmitted(true);
    setFormError(null);

    const nextErrors = validateAuthForm(mode, values);
    if (hasFieldErrors(nextErrors)) return;

    setSubmitting(true);
    try {
      if (mode === 'signIn') {
        await signIn({
          phone: normalizePhone(values.phone),
          password: values.password,
        });
      } else {
        await signUp({
          name: values.name.trim(),
          phone: normalizePhone(values.phone),
          password: values.password,
        });
      }
    } catch {
      setFormError(
        mode === 'signIn'
          ? 'Couldn’t sign in. Check your phone and password.'
          : 'Couldn’t create your account. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'signIn' ? 'Sign in' : 'Create account';
  const subtitle =
    mode === 'signIn'
      ? 'Phone number and password.'
      : 'A few details to get started.';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + space.xxl,
            paddingBottom: insets.bottom + space.xxl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.modeRow} accessibilityRole="tablist">
          <ModeTab
            label="Sign in"
            active={mode === 'signIn'}
            onPress={() => switchMode('signIn')}
          />
          <ModeTab
            label="Sign up"
            active={mode === 'signUp'}
            onPress={() => switchMode('signUp')}
          />
        </View>

        <GlassSurface style={styles.panel} flat>
          <View style={styles.form}>
            {mode === 'signUp' ? (
              <TextField
                label="Name"
                value={values.name}
                onChangeText={(t) => setField('name', t)}
                onBlur={() => touch('name')}
                error={show('name')}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => phoneRef.current?.focus()}
                editable={!submitting}
              />
            ) : null}

            <TextField
              ref={phoneRef}
              label="Phone number"
              value={values.phone}
              onChangeText={(t) => setField('phone', formatPhoneDisplay(t))}
              onBlur={() => touch('phone')}
              error={show('phone')}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!submitting}
              placeholder="(555) 123-4567"
            />

            <View style={styles.passwordBlock}>
              <TextField
                ref={passwordRef}
                label="Password"
                value={values.password}
                onChangeText={(t) => setField('password', t)}
                onBlur={() => touch('password')}
                error={show('password')}
                secureTextEntry={!showPassword}
                autoComplete={mode === 'signUp' ? 'new-password' : 'password'}
                textContentType={
                  mode === 'signUp' ? 'newPassword' : 'password'
                }
                returnKeyType={mode === 'signUp' ? 'next' : 'go'}
                submitBehavior="submit"
                onSubmitEditing={() => {
                  if (mode === 'signUp') confirmRef.current?.focus();
                  else void onSubmit();
                }}
                editable={!submitting}
                trailing={
                  <PasswordVisibilityToggle
                    visible={showPassword}
                    onToggle={() => setShowPassword((v) => !v)}
                  />
                }
                hint={
                  mode === 'signUp'
                    ? 'At least 8 characters, with a letter and a number.'
                    : undefined
                }
              />
              {mode === 'signUp' ? (
                <PasswordStrengthMeter password={values.password} />
              ) : null}
            </View>

            {mode === 'signUp' ? (
              <TextField
                ref={confirmRef}
                label="Confirm password"
                value={values.confirmPassword}
                onChangeText={(t) => setField('confirmPassword', t)}
                onBlur={() => touch('confirmPassword')}
                error={show('confirmPassword')}
                secureTextEntry={!showConfirm}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                submitBehavior="submit"
                onSubmitEditing={() => void onSubmit()}
                editable={!submitting}
                trailing={
                  <PasswordVisibilityToggle
                    visible={showConfirm}
                    onToggle={() => setShowConfirm((v) => !v)}
                  />
                }
              />
            ) : null}

            {formError ? (
              <Text style={styles.formError} accessibilityRole="alert">
                {formError}
              </Text>
            ) : null}

            <Button
              onPress={() => void onSubmit()}
              loading={submitting}
              accessibilityLabel={title}
            >
              {title}
            </Button>

            {mode === 'signIn' ? (
              <Pressable
                onPress={onForgotPassword}
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel="Forgot password"
                style={styles.forgot}
              >
                <Text style={styles.forgotLabel}>Forgot password?</Text>
              </Pressable>
            ) : null}
          </View>
        </GlassSurface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ModeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
    gap: space.xl,
  },
  header: {
    gap: space.sm,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    ...type.display,
    color: colors.ink,
  },
  subtitle: {
    ...type.body,
    color: colors.muted,
  },
  modeRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 400,
    gap: space.sm,
    padding: space.xs,
    borderRadius: radius.control,
    backgroundColor: colors.accentSoft,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.glassStrong,
  },
  tabLabel: {
    ...type.label,
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.ink,
  },
  panel: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    padding: space.xl,
  },
  form: {
    gap: space.lg,
  },
  passwordBlock: {
    gap: space.sm,
  },
  formError: {
    ...type.caption,
    color: colors.danger,
  },
  forgot: {
    alignSelf: 'center',
    paddingVertical: space.xs,
  },
  forgotLabel: {
    ...type.caption,
    color: colors.accent,
    fontWeight: '500',
  },
});
