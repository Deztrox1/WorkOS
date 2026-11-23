import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSlice } from './store';
import type { Mode } from './types';

const KEY = 'workos.mode';
type Ctx = { mode: Mode; setMode: (m: Mode) => void; both: boolean; setBoth: (b: boolean) => void };
const ModeCtx = createContext<Ctx>({ mode: 'work', setMode: () => {}, both: false, setBoth: () => {} });

function stored(): Mode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'work' || v === 'personal' ? v : null;
  } catch {
    return null;
  }
}

/** Mode is remembered per device; os_settings.default_mode is the first-visit value (PRD 3). */
export function ModeProvider({ children }: { children: ReactNode }) {
  const settings = useSlice('settings');
  const [mode, setModeState] = useState<Mode | null>(stored());
  const [both, setBoth] = useState(false);

  useEffect(() => {
    if (mode) return;
    const d = settings.rows.find((r) => r.key === 'default_mode')?.value;
    if (d === 'work' || d === 'personal') {
      setModeState(d);
      try { localStorage.setItem(KEY, d); } catch { /* ignore */ }
    } else if (settings.status === 'ready' && !settings.stale) {
      setModeState('work');
    }
  }, [mode, settings.rows, settings.status, settings.stale]);

  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  };
  return <ModeCtx.Provider value={{ mode: mode ?? 'work', setMode, both, setBoth }}>{children}</ModeCtx.Provider>;
}

export const useMode = () => useContext(ModeCtx);
