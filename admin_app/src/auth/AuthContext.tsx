import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  clearSession,
  getToken,
  isSessionPresent,
  setSession,
} from '../api/client';

type AuthCtx = {
  authed: boolean;
  token: string | null;
  login: (token: string, expiresAt?: string) => void;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    isSessionPresent() ? getToken() : null,
  );

  const value = useMemo<AuthCtx>(
    () => ({
      authed: Boolean(token),
      token,
      login: (t, expiresAt) => {
        setSession(t, expiresAt);
        setToken(t);
      },
      logout: () => {
        clearSession();
        setToken(null);
      },
    }),
    [token],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
