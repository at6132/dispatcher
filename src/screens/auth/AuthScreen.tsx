import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
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

import { mapApiError, type AuthField } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import type { AuthMode } from '../../auth/types';
import {
  formatPhoneDisplay,
  hasFieldErrors,
  normalizePhone,
  validateAuthForm,
  type AuthFormValues,
} from '../../auth/validation';
import { Button } from '../../components/ui/Button';
import { LoadingHint } from '../../components/ui/LoadingHint';
import {
  ConfirmPasswordStatus,
  PasswordRequirements,
} from '../../components/ui/PasswordRequirements';
import { PasswordVisibilityToggle, TextField } from '../../components/ui/TextField';
import { MistBackdrop, colors, fonts, motion, space, type } from '../../theme';

const EMPTY: AuthFormValues = {
  name: '',
  phone: '',
  password: '',
  confirmPassword: '',
};

type Touched = Partial<Record<keyof AuthFormValues, boolean>>;
type ServerFieldErrors = Partial<Record<AuthField, string>>;

type Props = {
  onForgotPassword: () => void;
};

export function AuthScreen({ onForgotPassword }: Props) {
  const insets = useSafeAreaInsets();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signUp');
  const [values, setValues] = useState<AuthFormValues>(EMPTY);
  const [touched, setTouched] = useState<Touched>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<ServerFieldErrors>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: motion.durationSlow,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: motion.durationSlow,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, rise]);

  const errors = validateAuthForm(mode, values);
  const show = (field: keyof AuthFormValues) => {
    if (serverFieldErrors[field as AuthField]) {
      return serverFieldErrors[field as AuthField];
    }
    if (mode === 'signUp' && field === 'password') {
      return submitted && errors.password ? errors.password : undefined;
    }
    if (mode === 'signUp' && field === 'confirmPassword') {
      return submitted && !values.confirmPassword && errors.confirmPassword
        ? errors.confirmPassword
        : undefined;
    }
    return (submitted || touched[field]) && errors[field]
      ? errors[field]
      : undefined;
  };

  const clearServerErrors = useCallback(() => {
    setFormError(null);
    setServerFieldErrors({});
  }, []);

  const setField = useCallback(
    <K extends keyof AuthFormValues>(key: K, value: AuthFormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      setFormError(null);
      setServerFieldErrors((prev) => {
        if (!prev[key as AuthField]) return prev;
        const next = { ...prev };
        delete next[key as AuthField];
        return next;
      });
    },
    [],
  );

  const touch = useCallback((key: keyof AuthFormValues) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
  }, []);

  const switchMode = (next: AuthMode) => {
    if (next === mode || submitting) return;
    setMode(next);
    setTouched({});
    setSubmitted(false);
    clearServerErrors();
    setShowPassword(false);
    setShowConfirm(false);
    setValues((prev) => ({
      ...EMPTY,
      phone: prev.phone,
    }));
  };

  const onSubmit = async () => {
    setSubmitted(true);
    clearServerErrors();

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
    } catch (err) {
      const mapped = mapApiError(err, mode === 'signIn' ? 'signIn' : 'signUp');
      if (mapped.field) {
        setServerFieldErrors({ [mapped.field]: mapped.message });
        setFormError(null);
        if (mapped.field === 'phone') phoneRef.current?.focus();
        else if (mapped.field === 'password') passwordRef.current?.focus();
      } else {
        setFormError(mapped.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const headline =
    mode === 'signUp'
      ? { lead: 'Create', trail: 'account' }
      : { lead: 'Welcome', trail: 'back' };
  const cta = mode === 'signUp' ? 'Continue' : 'Sign in';
  const busyLabel =
    mode === 'signUp' ? 'Creating your account…' : 'Signing you in…';
  const altLabel = mode === 'signUp' ? 'Sign in' : 'Create account';
  const altMode: AuthMode = mode === 'signUp' ? 'signIn' : 'signUp';

  return (
    <MistBackdrop>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingTop: insets.top + space.xxl,
              paddingBottom: insets.bottom + space.xxxl,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.stage,
              { opacity: fade, transform: [{ translateY: rise }] },
            ]}
          >
            <View style={styles.header}>
              <Text style={styles.headlineLead}>{headline.lead}</Text>
              <Text style={styles.headlineTrail}>{headline.trail}</Text>
            </View>

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
                label="Phone"
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
              />

              <View style={styles.passwordBlock}>
                <TextField
                  ref={passwordRef}
                  label="Password"
                  value={values.password}
                  onChangeText={(t) => setField('password', t)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => {
                    setPasswordFocused(false);
                    touch('password');
                  }}
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
                />
                {mode === 'signUp' ? (
                  <PasswordRequirements
                    password={values.password}
                    visible={
                      passwordFocused ||
                      values.password.length > 0 ||
                      !!touched.password
                    }
                  />
                ) : null}
              </View>

              {mode === 'signUp' ? (
                <View style={styles.passwordBlock}>
                  <TextField
                    ref={confirmRef}
                    label="Confirm"
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
                  <ConfirmPasswordStatus
                    password={values.password}
                    confirm={values.confirmPassword}
                  />
                </View>
              ) : null}

              {formError ? (
                <Text style={styles.formError} accessibilityRole="alert">
                  {formError}
                </Text>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Button
                onPress={() => void onSubmit()}
                loading={submitting}
                disabled={submitting}
                accessibilityLabel={cta}
              >
                {cta}
              </Button>

              {submitting ? <LoadingHint label={busyLabel} /> : null}

              {mode === 'signIn' ? (
                <Pressable
                  onPress={onForgotPassword}
                  disabled={submitting}
                  hitSlop={10}
                  accessibilityRole="link"
                  style={[styles.forgot, submitting && styles.linkDisabled]}
                >
                  <Text style={styles.forgotLabel}>Forgot password</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => switchMode(altMode)}
                disabled={submitting}
                hitSlop={10}
                accessibilityRole="button"
                style={[styles.switch, submitting && styles.linkDisabled]}
              >
                <Text style={styles.switchLabel}>{altLabel}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </MistBackdrop>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  stage: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    gap: space.xxl,
  },
  header: {
    gap: 0,
  },
  headlineLead: {
    ...type.hero,
    color: colors.ink,
  },
  headlineTrail: {
    ...type.heroItalic,
    color: colors.accent,
  },
  form: {
    gap: space.md,
  },
  passwordBlock: {
    gap: space.sm,
  },
  actions: {
    gap: space.md,
    marginTop: space.sm,
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
    color: colors.muted,
  },
  switch: {
    alignSelf: 'center',
    paddingVertical: space.sm,
  },
  switchLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  linkDisabled: {
    opacity: 0.4,
  },
});
