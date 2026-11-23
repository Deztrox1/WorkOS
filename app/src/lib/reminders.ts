import { useEffect } from 'react';
import { timeText } from './logic/format';
import { deleteRow, isOnline, patchRow, settingValue, setSetting } from './actions';
import { addBanner, bannerOpen, bannerShown } from './banners';
import { nowMs, store, useSlice } from './store';
import { nextFire } from '../shared/nextFire';
import { istTime } from '../shared/ist';

/** Browser permission for notifications, or 'unsupported'. */
export function permission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** `last_opened_at` is the line the next open measures "earlier" from, so it moves whenever the owner has seen the screen. */
const markOpened = () => {
  if (isOnline()) void setSetting('last_opened_at', new Date(nowMs()).toISOString());
};

/**
 * While the app is open: at a reminder's next fire time show a banner and, when the user has
 * allowed notifications, a browser Notification (PRD 5.5 Delivery). Uses the same nextFire as push-due.
 */
export function useReminderWatcher(enabled: boolean) {
  const reminders = useSlice('reminders');
  const settings = useSlice('settings');

  // Earlier banner + last_opened_at, once per app session (PRD 5.5 Missed, TD-11, TD-30). A reminder that rang in front of
  // him, or in a banner this session, is never called earlier (QA r2 P05, C04).
  useEffect(() => {
    if (!enabled) return;
    if (reminders.status !== 'ready' || settings.status !== 'ready' || reminders.stale || settings.stale) return;
    const w = window as unknown as { __openHandled?: boolean };
    if (w.__openHandled || !isOnline()) return;
    w.__openHandled = true;
    const last = settingValue<string | null>('last_opened_at', null);
    if (last) {
      const lastMs = new Date(last).getTime();
      for (const r of reminders.rows) {
        // A daily reminder already sits in the plan, and the push timer stamps it every day: only a one-off gets a banner (R4Y04).
        if (r.repeat !== 'none') continue;
        if (r.last_fired_at && new Date(r.last_fired_at).getTime() > lastMs && !bannerShown(r.id) && !r.snooze_of) {
          addBanner({ id: `missed-${r.id}`, kind: 'missed', text: `Earlier: ${r.title} at ${timeText(r.last_fired_at)}` });
        }
      }
    }
    markOpened();
  }, [enabled, reminders.status, settings.status, reminders.stale, settings.stale, reminders.rows]);

  // Leaving the screen counts as seen, so what rings while it is hidden is the only thing the next open calls earlier.
  useEffect(() => {
    if (!enabled) return;
    const hide = () => { if (document.visibilityState === 'hidden') markOpened(); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const baseline = new Map<string, number>();
    const started = nowMs();
    const gone = new Set<string>();
    const tick = () => {
      const now = nowMs();
      // A snooze copy has done its job once it has rung and its banner is closed (QA r2 P10).
      for (const r of store.get('reminders').rows) {
        if (!r.snooze_of || r.active || !r.last_fired_at || gone.has(r.id) || bannerOpen(r.id)) continue;
        if (now - new Date(r.last_fired_at).getTime() < 5000 || !isOnline()) continue;
        gone.add(r.id);
        void deleteRow('reminders', { id: r.id }, { quiet: true });
      }
      for (const r of store.get('reminders').rows) {
        if (!r.active) continue;
        const from = baseline.get(r.id) ?? started;
        const f = nextFire(r, from);
        if (f === null || f > now) continue;
        baseline.set(r.id, f);
        if (r.last_fired_at && new Date(r.last_fired_at).getTime() >= f) continue; // push-due already fired it
        addBanner({ id: `fired-${r.id}-${f}`, kind: 'fired', text: `${r.title} at ${istTime(f)}`, reminderId: r.id });
        markOpened();
        if (permission() === 'granted') {
          try { new Notification(r.title, { body: r.notes ?? `At ${istTime(f)}`, tag: `${r.id}-${f}` }); } catch { /* some browsers need a service worker */ }
        }
        if (isOnline()) {
          void patchRow('reminders', { id: r.id }, r.repeat === 'none' ? { last_fired_at: new Date(f).toISOString(), active: false } : { last_fired_at: new Date(f).toISOString() }, { quiet: true });
        }
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enabled]);
}
