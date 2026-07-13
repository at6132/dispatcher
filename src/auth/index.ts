export type { AuthMode, AuthUser, SignInInput, SignUpInput } from './types';
export { AuthProvider, useAuth } from './AuthContext';
export {
  formatPhoneDisplay,
  normalizePhone,
  validateAuthForm,
  validatePhone,
} from './validation';
