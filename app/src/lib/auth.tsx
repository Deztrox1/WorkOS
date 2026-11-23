import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getClient } from './data';
import type { AuthUser } from './data';
import { store } from './store';

const OWNER_KEY = 'workos.cache.user';

/**
 * The cached rows belong to one account. When a different user signs in on this browser, the cache goes first, so one
 * account never sees another's rows, even for a moment (QA r2 S08).
 */
function adoptUser(u: AuthUser | null) {
  if (!u) return;
  try {
    const prev = localStorage.getItem(OWNER_KEY);
    if (prev && prev !== u.email) {
      store.clearCache();
      void store.refreshAll();
    }
    localStorage.setItem(OWNER_KEY, u.email);
  } catch { /* ignore */ }
}

type Ctx = { user: AuthUser | null; ready: boolean; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ user: null, ready: false, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const auth = getClient().auth;
    let alive = true;
    void auth.getUser().then((u) => {
      if (!alive) return;
      adoptUser(u);
      setUser(u);
      setReady(true);
    });
    const off = auth.onChange((u) => {
      adoptUser(u);
      setUser(u);
      setReady(true);
      if (!u) store.clearCache();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const signOut = async () => {
    await getClient().auth.signOut();
    store.clearCache();
    setUser(null);
  };
  return <AuthCtx.Provider value={{ user, ready, signOut }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/** Capture a Supabase recovery link (/#/reset#access_token=...) before the router reads the hash. */
export type Recovery = { access_token: string; refresh_token: string } | null;
let recovery: Recovery = null;
export function parseRecoveryHash(hash: string): Recovery {
  const i = hash.indexOf('access_token=');
  if (i < 0) return null;
  const qs = new URLSearchParams(hash.slice(i).replace(/^[#?]/, ''));
  if (hash.includes('type=recovery') || qs.get('type') === 'recovery') {
    return { access_token: qs.get('access_token') ?? '', refresh_token: qs.get('refresh_token') ?? '' };
  }
  return null;
}
export function captureRecovery() {
  const r = parseRecoveryHash(location.hash);
  if (r) {
    recovery = r;
    history.replaceState(null, '', location.pathname + location.search + '#/reset');
  }
}
export const takeRecovery = () => recovery;
