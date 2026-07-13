import type { AuthMode, FieldErrors } from './types';

export type PasswordStrength = 'empty' | 'weak' | 'okay' | 'strong';

/** Digits only — strip spaces, dashes, parens, leading +. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Normalize for storage / API.
 * 10-digit North America → +1XXXXXXXXXX
 * 11-digit starting with 1 → +1XXXXXXXXXX
 * Otherwise → +{digits} when length is valid.
 */
export function normalizePhone(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

/** Light display formatter for US-looking numbers while typing. */
export function formatPhoneDisplay(value: string): string {
  const digits = digitsOnly(value).slice(0, 15);

  if (digits.length === 0) return '';

  // Keep international short-form readable once past NA length
  if (digits.length > 11 || (digits.length === 11 && !digits.startsWith('1'))) {
    return `+${digits}`;
  }

  const national =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (national.length <= 3) return national;
  if (national.length <= 6) {
    return `(${national.slice(0, 3)}) ${national.slice(3)}`;
  }
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6, 10)}`;
}

export function validatePhone(value: string): string | undefined {
  const digits = digitsOnly(value);
  if (!digits) return 'Enter your phone number';
  if (digits.length < 10) return 'Enter a valid phone number';
  if (digits.length > 15) return 'Phone number is too long';
  // Reject obvious junk like all zeros
  if (/^0+$/.test(digits)) return 'Enter a valid phone number';
  return undefined;
}

export function validateName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Enter your name';
  if (name.length < 2) return 'Name needs at least 2 characters';
  if (name.length > 80) return 'Name is too long';
  return undefined;
}

/** Signup passwords — clear bar, no cryptic policy dump. */
export function validateNewPassword(value: string): string | undefined {
  if (!value) return 'Choose a password';
  if (value.length < 8) return 'Use at least 8 characters';
  if (value.length > 128) return 'Password is too long';
  if (!/[A-Za-z]/.test(value)) return 'Include at least one letter';
  if (!/[0-9]/.test(value)) return 'Include at least one number';
  return undefined;
}

export function validateSignInPassword(value: string): string | undefined {
  if (!value) return 'Enter your password';
  return undefined;
}

export function validateConfirmPassword(
  password: string,
  confirm: string,
): string | undefined {
  if (!confirm) return 'Confirm your password';
  if (confirm !== password) return 'Passwords do not match';
  return undefined;
}

export function passwordStrength(value: string): PasswordStrength {
  if (!value) return 'empty';

  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/[0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (score <= 2) return 'weak';
  if (score <= 3) return 'okay';
  return 'strong';
}

export type AuthFormValues = {
  name: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

export function validateAuthForm(
  mode: AuthMode,
  values: AuthFormValues,
): FieldErrors {
  const errors: FieldErrors = {};

  const phoneError = validatePhone(values.phone);
  if (phoneError) errors.phone = phoneError;

  if (mode === 'signIn') {
    const passwordError = validateSignInPassword(values.password);
    if (passwordError) errors.password = passwordError;
    return errors;
  }

  const nameError = validateName(values.name);
  if (nameError) errors.name = nameError;

  const passwordError = validateNewPassword(values.password);
  if (passwordError) errors.password = passwordError;

  const confirmError = validateConfirmPassword(
    values.password,
    values.confirmPassword,
  );
  if (confirmError) errors.confirmPassword = confirmError;

  return errors;
}

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
