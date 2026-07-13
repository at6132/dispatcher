import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type {
  AuthStatus,
  AuthUser,
  SignInInput,
  SignUpInput,
} from './types';
import { normalizePhone } from './validation';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (input: SignInInput) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Frontend session stub — in-memory only.
 * Swap signIn/signUp bodies for real API calls later; keep the same shape.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('unauthenticated');
  const [user, setUser] = useState<AuthUser | null>(null);

  const signIn = useCallback(async (input: SignInInput) => {
    await delay(450);
    setUser({
      id: 'local',
      phone: normalizePhone(input.phone),
      name: '',
    });
    setStatus('authenticated');
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    await delay(550);
    setUser({
      id: 'local',
      phone: normalizePhone(input.phone),
      name: input.name.trim(),
    });
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, signUp, signOut }),
    [status, user, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
