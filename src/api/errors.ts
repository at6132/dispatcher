import { ApiError } from './client';

export type AuthField = 'name' | 'phone' | 'password' | 'confirmPassword';

export type MappedError = {
  /** Clear, user-facing copy */
  message: string;
  /** Attach to a field when the error is field-scoped */
  field?: AuthField;
  code?: string;
};

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/**
 * Map API / network failures to clear UI copy.
 * Prefer codes over raw server messages so tone stays consistent.
 */
export function mapApiError(
  err: unknown,
  context: 'signIn' | 'signUp' | 'onboarding' | 'generic' = 'generic',
): MappedError {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        return {
          message: 'Wrong phone or password. Check both and try again.',
          field: 'password',
          code: err.code,
        };
      case 'phone_taken':
        return {
          message:
            'An account with this phone already exists. Try signing in instead.',
          field: 'phone',
          code: err.code,
        };
      case 'invalid_phone':
        return {
          message: 'Enter a valid phone number.',
          field: 'phone',
          code: err.code,
        };
      case 'invalid_name':
        return {
          message: 'Enter a valid name (at least 2 characters).',
          field: 'name',
          code: err.code,
        };
      case 'invalid_password':
        return {
          message:
            'Password needs 8+ characters with at least one letter and one number.',
          field: 'password',
          code: err.code,
        };
      case 'invalid_body':
        return {
          message:
            context === 'signIn'
              ? 'Check your phone and password, then try again.'
              : 'Check the form and try again.',
          code: err.code,
        };
      case 'rate_limited':
        return {
          message: 'Too many attempts. Wait a moment, then try again.',
          code: err.code,
        };
      case 'account_locked':
        return {
          message: 'This account is locked until balances are settled.',
          code: err.code,
        };
      case 'no_api_url':
        return {
          message: 'App isn’t connected to a server yet. Try again later.',
          code: err.code,
        };
      case 'network_error':
        return {
          message: 'Can’t reach the server. Check your connection and try again.',
          code: err.code,
        };
      case 'unauthorized':
      case 'invalid_refresh':
        return {
          message: 'Your session expired. Sign in again.',
          code: err.code,
        };
      case 's3_disabled':
        return {
          message: 'Photo upload isn’t available right now. You can continue without photos.',
          code: err.code,
        };
      case 'invalid_content_type':
        return {
          message: 'That photo format isn’t supported. Use a JPG or PNG.',
          code: err.code,
        };
      case 'upload_missing':
      case 'upload_create_failed':
        return {
          message: 'Photo upload failed. Check your connection and try again.',
          code: err.code,
        };
      case 'invalid_vehicle_class':
      case 'invalid_vehicle_type':
      case 'invalid_seats':
      case 'invalid_years':
      case 'invalid_zelle':
        return {
          message: err.message || 'Check that field and try again.',
          code: err.code,
        };
      case 'create_failed':
      case 'internal':
        return {
          message:
            context === 'signUp'
              ? 'Couldn’t create your account. Try again.'
              : 'Something went wrong on our side. Try again.',
          code: err.code,
        };
      default:
        break;
    }

    // Fall back to a cleaned server message when code is unknown.
    if (err.message && !/^Request failed/i.test(err.message)) {
      return { message: err.message, code: err.code };
    }

    if (err.status === 0) {
      return {
        message: 'Can’t reach the server. Check your connection and try again.',
        code: err.code ?? 'network_error',
      };
    }
  }

  if (isLikelyNetworkFailure(err)) {
    return {
      message: 'Can’t reach the server. Check your connection and try again.',
      code: 'network_error',
    };
  }

  if (err instanceof Error && err.message === 'Photo upload failed') {
    return {
      message: 'Photo upload failed. Check your connection and try again.',
      code: 'upload_failed',
    };
  }

  if (context === 'signIn') {
    return { message: 'Couldn’t sign in. Check your phone and password.' };
  }
  if (context === 'signUp') {
    return { message: 'Couldn’t create your account. Try again.' };
  }
  if (context === 'onboarding') {
    return { message: 'Couldn’t save your profile. Check your connection and try again.' };
  }
  return { message: 'Something went wrong. Try again.' };
}

function isLikelyNetworkFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    err.name === 'TypeError' ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('internet')
  );
}
