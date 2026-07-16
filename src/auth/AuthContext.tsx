import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { clearTokens } from '../api/tokenStore';
import { isApiError } from '../api/errors';
import { logger } from '../debug/logger';
import {
  authenticateAccount,
  clearSession,
  createAccount,
  getSessionUser,
  saveOnboarding,
  savePresence,
} from './sessionStore';
import type {
  AuthStatus,
  AuthUser,
  OnboardingInput,
  SignInInput,
  SignUpInput,
} from './types';
import {
  clearPendingOnboarding,
  clearPersistedUser,
  persistPendingOnboarding,
  persistUser,
  readPendingOnboarding,
  readPersistedUser,
} from './userStore';
import { normalizePhone } from './validation';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (input: SignInInput) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  completeOnboarding: (input: OnboardingInput) => Promise<void>;
  updatePresence: (input: {
    availability?: 'available' | 'busy' | 'offline';
    lat?: number;
    lng?: number;
  }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mergeSession(cached: AuthUser | null, remote: AuthUser): AuthUser {
  if (!cached || cached.id !== remote.id) return remote;
  // Never regress a locally sealed completion if the network read is stale.
  if (cached.onboardingComplete && !remote.onboardingComplete) {
    return {
      ...remote,
      onboardingComplete: true,
      onboarding: remote.onboarding ?? cached.onboarding,
    };
  }
  return remote;
}

function isPermanentOnboardingFailure(err: unknown): boolean {
  if (!isApiError(err)) return false;
  if (err.status >= 500) return false;
  if (err.status === 429) return false;
  // 4xx validation / config — user must fix and resubmit.
  return err.status >= 400 && err.status < 500;
}

/**
 * Auth backed by Dispatcher API.
 * onboardingComplete gates the app until the profile wizard is finished.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<AuthUser | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  /** Bumped on every intentional auth mutation so a slow bootstrap can’t clobber it. */
  const sessionGen = useRef(0);

  userRef.current = user;

  const applyUser = useCallback(async (next: AuthUser | null, genBump = false) => {
    if (genBump) sessionGen.current += 1;
    setUser(next);
    userRef.current = next;
    if (next) {
      await persistUser(next);
    } else {
      await clearPersistedUser();
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const gen = sessionGen.current;

    const stillCurrent = () => alive && gen === sessionGen.current;

    (async () => {
      try {
        const cached = await readPersistedUser();
        if (!stillCurrent()) return;
        if (cached) {
          // Show cached session immediately so a remount doesn’t flash the wizard.
          setUser(cached);
          userRef.current = cached;
          setStatus('authenticated');
          logger.info('auth', 'provider.cache_hydrate', {
            userId: cached.id,
            onboardingComplete: cached.onboardingComplete,
          });
        }

        const sessionUser = await getSessionUser();
        if (!stillCurrent()) return;

        // Null = no valid remote session (401). Do not keep a zombie cached user.
        if (!sessionUser) {
          await clearTokens();
          await clearPersistedUser();
          if (!stillCurrent()) return;
          setUser(null);
          userRef.current = null;
          setStatus('unauthenticated');
          logger.info('auth', 'provider.ready', {
            status: 'unauthenticated',
            reason: 'no_remote_session',
            onboardingComplete: null,
          });
          return;
        }

        // Prefer in-memory user (may already be optimistically sealed mid-bootstrap).
        const local = userRef.current ?? cached;
        const merged = mergeSession(local, sessionUser);

        // Retry anytime the server still says incomplete and we have a draft —
        // even if local merge sealed the gate (optimistic / stale cache).
        const pending = await readPendingOnboarding();
        if (!stillCurrent()) return;
        if (pending && sessionUser && !sessionUser.onboardingComplete) {
          logger.info('auth', 'provider.retry_pending_onboarding', {
            userId: merged.id,
            localComplete: merged.onboardingComplete,
          });
          try {
            const saved = await saveOnboarding(merged.phone, pending);
            if (!stillCurrent()) return;
            const sealed: AuthUser = { ...saved, onboardingComplete: true };
            await applyUser(sealed);
            setStatus('authenticated');
            await clearPendingOnboarding();
            logger.info('auth', 'provider.retry_pending_ok', {
              userId: sealed.id,
            });
            return;
          } catch (err) {
            logger.warn('auth', 'provider.retry_pending_fail', {
              err: err instanceof Error ? err.message : String(err),
            });
            // Keep local seal + pending; don’t bounce into the wizard.
            if (!stillCurrent()) return;
            if (merged.onboardingComplete) {
              await applyUser(merged);
              setStatus('authenticated');
              return;
            }
          }
        }

        if (!stillCurrent()) return;
        await applyUser(merged);
        setStatus('authenticated');
        logger.info('auth', 'provider.ready', {
          status: 'authenticated',
          onboardingComplete: merged.onboardingComplete,
          userId: merged.id,
        });
      } catch (err) {
        if (!stillCurrent()) return;
        const cached = await readPersistedUser();
        if (cached) {
          // Offline / blip — keep cached session instead of bouncing to auth.
          setUser(cached);
          userRef.current = cached;
          setStatus('authenticated');
          logger.warn('auth', 'provider.bootstrap_failed_use_cache', {
            userId: cached.id,
            err: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        logger.error('auth', 'provider.bootstrap_failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        setUser(null);
        userRef.current = null;
        setStatus('unauthenticated');
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyUser]);

  const signIn = useCallback(
    async (input: SignInInput) => {
      const next = await authenticateAccount({
        phone: normalizePhone(input.phone),
        password: input.password,
      });
      await clearPendingOnboarding();
      await applyUser(next, true);
      setStatus('authenticated');
      logger.info('auth', 'signed_in', {
        userId: next.id,
        onboardingComplete: next.onboardingComplete,
      });
    },
    [applyUser],
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const next = await createAccount({
        phone: normalizePhone(input.phone),
        name: input.name.trim(),
        password: input.password,
      });
      await clearPendingOnboarding();
      await applyUser(next, true);
      setStatus('authenticated');
      logger.info('auth', 'signed_up', {
        userId: next.id,
        onboardingComplete: next.onboardingComplete,
      });
    },
    [applyUser],
  );

  const completeOnboarding = useCallback(
    async (input: OnboardingInput) => {
      const current = userRef.current;
      if (!current) throw new Error('Not signed in.');
      logger.info('auth', 'complete_onboarding.start', { userId: current.id });

      // Survive remounts mid-request: draft + optimistic seal BEFORE network.
      await persistPendingOnboarding(input);
      const optimistic: AuthUser = {
        ...current,
        onboardingComplete: true,
        onboarding: {
          vehicleClass: input.vehicleClass,
          vehicleType: input.vehicleType,
          seats: input.seats,
          yearsDrivingUpstate: input.yearsDrivingUpstate,
          ...(input.extraInfo ? { extraInfo: input.extraInfo } : {}),
          ...(input.zelle ? { zelle: input.zelle } : {}),
          ...(input.selfPhotoUri ? { selfPhotoUri: input.selfPhotoUri } : {}),
          ...(input.vehicleInteriorUri
            ? { vehicleInteriorUri: input.vehicleInteriorUri }
            : {}),
          ...(input.vehicleExteriorUri
            ? { vehicleExteriorUri: input.vehicleExteriorUri }
            : {}),
        },
      };
      await applyUser(optimistic, true);
      setStatus('authenticated');

      try {
        const next = await saveOnboarding(current.phone, input);
        const sealed: AuthUser = {
          ...next,
          onboardingComplete: true,
          onboarding: next.onboarding ?? optimistic.onboarding,
        };
        await applyUser(sealed, true);
        await clearPendingOnboarding();
        logger.info('auth', 'complete_onboarding.done', {
          userId: sealed.id,
          onboardingComplete: sealed.onboardingComplete,
          serverFlag: next.onboardingComplete,
        });
      } catch (err) {
        if (isPermanentOnboardingFailure(err)) {
          // Bad payload — reopen wizard with the draft still pending.
          const reverted: AuthUser = {
            ...current,
            onboardingComplete: false,
            onboarding: optimistic.onboarding,
          };
          await applyUser(reverted, true);
          logger.error('auth', 'complete_onboarding.fail_revert', {
            userId: current.id,
            err: err instanceof Error ? err.message : String(err),
          });
        } else {
          // Network / blip — stay sealed; pending retries on next bootstrap.
          logger.error('auth', 'complete_onboarding.fail_keep_optimistic', {
            userId: current.id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }
    },
    [applyUser],
  );

  const updatePresence = useCallback(
    async (input: {
      availability?: 'available' | 'busy' | 'offline';
      lat?: number;
      lng?: number;
    }) => {
      const current = userRef.current;
      if (current && input.availability) {
        // Optimistic chip flip before network
        await applyUser({ ...current, availability: input.availability }, true);
      }
      const next = await savePresence(input);
      await applyUser(next, true);
    },
    [applyUser],
  );

  const signOut = useCallback(async () => {
    sessionGen.current += 1;
    await clearSession();
    await clearPersistedUser();
    await clearPendingOnboarding();
    setUser(null);
    userRef.current = null;
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
      updatePresence,
      signOut,
    }),
    [status, user, signIn, signUp, completeOnboarding, updatePresence, signOut],
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
