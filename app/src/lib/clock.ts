import { useSyncExternalStore } from 'react';
import { istDate, nextIstMidnight } from '../shared/ist';
import { isOnline, setSetting } from './actions';
import { nowMs, store } from './store';

// "Today" is the Asia/Kolkata date, never the device date (PRD 2 Time).
let today = istDate(nowMs());
const subs = new Set<() => void>();
let started = false;

function check() {
  const t = istDate(nowMs());
  if (t !== today) {
    today = t;
    subs.forEach((s) => s());
    void store.refreshAll();
    if (isOnline()) void setSetting('last_opened_at', new Date(nowMs()).toISOString());
  }
}

export function startClock() {
  if (started) return;
  started = true;
  const schedule = () => {
    const ms = Math.max(1000, nextIstMidnight(nowMs()) - nowMs() + 100);
    setTimeout(() => {
      check();
      schedule();
    }, ms);
  };
  schedule();
  setInterval(check, 30_000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
}

export function useToday(): string {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => today,
  );
}
