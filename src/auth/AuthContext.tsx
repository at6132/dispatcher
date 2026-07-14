import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { logger } from '../debug/logger';
import {
  authenticateAccount,
  clearSession,
  createAccount,
  getSessionUser,
  saveOnboarding,
} from './sessionStore';
import type {
  AuthStatus,
  AuthUser,
  OnboardingInput,
  SignInInput,
  SignUpInput,
} from './types';
import { normalizePhone } from './validation';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (input: SignInInput) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  completeOnboarding: (input: OnboardingInput) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Auth backed by Dispatcher API.
 * onboardingComplete gates the app until the profile wizard is finished.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sessionUser = await getSessionUser();
        if (!alive) return;
        setUser(sessionUser);
        setStatus(sessionUser ? 'authenticated' : 'unauthenticated');
        logger.info('auth', 'provider.ready', {
          status: sessionUser ? 'authenticated' : 'unauthenticated',
          onboardingComplete: sessionUser?.onboardingComplete ?? null,
        });
      } catch (err) {
        if (!alive) return;
        logger.error('auth', 'provider.bootstrap_failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        setUser(null);
        setStatus('unauthenticated');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (input: SignInInput) => {
    const next = await authenticateAccount({
      phone: normalizePhone(input.phone),
      password: input.password,
    });
    setUser(next);
    setStatus('authenticated');
    logger.info('auth', 'signed_in', {
      userId: next.id,
      onboardingComplete: next.onboardingComplete,
    });
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const next = await createAccount({
      phone: normalizePhone(input.phone),
      name: input.name.trim(),
      password: input.password,
    });
    setUser(next);
    setStatus('authenticated');
    logger.info('auth', 'signed_up', {
      userId: next.id,
      onboardingComplete: next.onboardingComplete,
    });
  }, []);

  const completeOnboarding = useCallback(
    async (input: OnboardingInput) => {
      if (!user) throw new Error('Not signed in.');
      logger.info('auth', 'complete_onboarding.start', { userId: user.id });
      const next = await saveOnboarding(user.phone, input);
      setUser(next);
      logger.info('auth', 'complete_onboarding.done', {
        userId: next.id,
        onboardingComplete: next.onboardingComplete,
      });
    },
    [user],
  );

  const signOut = useCallback(async () => {
    await clearSession();
    setUser(null);
    setStatus('unauthenticated');
    logger.info('auth', 'signed_out');
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      signIn,
      signUp,
      completeOnboarding,
      signOut,
    }),
    [status, user, signIn, signUp, completeOnboarding, signOut],
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
