import { getClient } from './data';
import { liveConfig } from './data/supabase';
import { upsertRow, deleteRow } from './actions';
import { store } from './store';
import { toast } from './toast';

const THIS_DEVICE = 'workos.push.endpoint';

export type PushResult = 'ok' | 'denied' | 'unsupported' | 'error';

function vapidKey(): string {
  return (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || __VAPID_FILE__ || '';
}
function b64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const toB64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))) : '');

/** Settings > Enable: ask permission, register the service worker, subscribe, save to os_push_subscriptions. */
export async function enablePush(label: string): Promise<PushResult> {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let endpoint = '';
    let p256dh = '';
    let auth = '';
    try {
      const key = vapidKey();
      if (!key) throw new Error('no VAPID key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) as BufferSource });
      endpoint = sub.endpoint;
      p256dh = toB64(sub.getKey('p256dh'));
      auth = toB64(sub.getKey('auth'));
    } catch (e) {
      if (getClient().kind !== 'mock') throw e;
      // mock mode has no push service: save a stand-in subscription so the flow can be tested
      endpoint = `mock://device/${crypto.randomUUID()}`;
      p256dh = 'mock';
      auth = 'mock';
    }
    try { localStorage.setItem(THIS_DEVICE, endpoint); } catch { /* ignore */ }
    const ok = await upsertRow('push_subs', { endpoint, p256dh, auth, device_label: label, created_at: new Date().toISOString() }, 'endpoint', { ok: 'Notifications on' });
    return ok ? 'ok' : 'error';
  } catch {
    toast('Could not turn on notifications.', 'error');
    return 'error';
  }
}

export async function removeDevice(endpoint: string) {
  const ok = await deleteRow('push_subs', { endpoint }, { ok: 'Removed' });
  if (ok && !endpoint.startsWith('mock://')) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub && sub.endpoint === endpoint) await sub.unsubscribe();
    } catch { /* ignore */ }
  }
}

export const liveUrl = () => liveConfig().url;

/** The push address of this browser, or null when it is not subscribed. */
async function thisEndpoint(): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) return sub.endpoint;
  } catch { /* ignore */ }
  try { return localStorage.getItem(THIS_DEVICE); } catch { return null; }
}

/**
 * After a password change: every other device stops getting notifications, so a stolen session cannot keep listening
 * (QA r2 S10). This browser's own address stays. Returns how many devices were removed.
 */
export async function dropOtherDevices(): Promise<number> {
  const mine = await thisEndpoint();
  const others = store.get('push_subs').rows.filter((s) => s.endpoint !== mine);
  let n = 0;
  for (const s of others) if (await deleteRow('push_subs', { endpoint: s.endpoint }, { quiet: true })) n++;
  return n;
}
