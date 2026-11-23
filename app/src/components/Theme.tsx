import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'workos.theme';

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}
function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
export function effectiveTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;
}
export function applyTheme(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
  if (pref === 'light' || pref === 'dark') document.documentElement.setAttribute('data-theme', pref);
  else document.documentElement.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effectiveTheme(pref) === 'dark' ? '#0f1413' : '#eef1f1');
  listeners.forEach((l) => l());
}
const listeners = new Set<() => void>();

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readTheme);
  useEffect(() => {
    const l = () => setPref(readTheme());
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [pref, applyTheme];
}

/** The capsule: one tap flips light and dark. "System" lives in Settings. */
export function ThemeToggle() {
  const [pref, set] = useThemePref();
  const [, tick] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => tick((n) => n + 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const cur = effectiveTheme(pref);
  const next = cur === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button" className="theme-cap" data-theme={cur} role="switch" aria-checked={cur === 'dark'}
      aria-label={`Dark theme ${cur === 'dark' ? 'on' : 'off'}. Switch to ${next}.`} title={`Switch to ${next}`}
      onClick={() => set(next)}
    >
      <span className="cap" aria-hidden>
        <Sun size={14} />
        <Moon size={14} />
        <span className="chip-dot">{cur === 'dark' ? <Moon size={13} /> : <Sun size={13} />}</span>
      </span>
    </button>
  );
}
