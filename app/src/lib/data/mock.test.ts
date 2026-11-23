import { beforeAll, describe, expect, it } from 'vitest';
import type { DataClient } from './types';
import { isPrimaryDup, isRuleError } from './types';
import { createMockClient } from './mock';

// The mock mirrors migration 0008 (statuses, copy hand-off, final rows frozen, server keys, update counts). It needs a browser-ish shell.
beforeAll(() => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.window = g;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
});

const fresh = (): DataClient => {
  (globalThis as unknown as { localStorage: Storage }).localStorage.removeItem('workos.mock.v1');
  return createMockClient();
};
const req = (over: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), area: 'work', title: 't', brief: 'b', status: 'queued', handoff: 'routine', task_id: null, ...over });
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'none');

describe('mock mirrors migration 0008', () => {
  it('update returns the number of rows changed', async () => {
    const c = fresh();
    await c.insert('os_claude_requests', req({ id: 'a' }));
    expect(await c.update('os_claude_requests', { id: 'a', status: 'queued' }, { status: 'cancelled' })).toBe(1);
    expect(await c.update('os_claude_requests', { id: 'a', status: 'queued' }, { status: 'cancelled' })).toBe(0); // the guard no longer holds
  });

  it('a new request starts queued, or sent for a copy hand-off with sent_at stamped; nothing else', async () => {
    const c = fresh();
    expect(await code(c.insert('os_claude_requests', req({ status: 'done' })))).toBe('23514');
    expect(await code(c.insert('os_claude_requests', req({ handoff: 'copy' })))).toBe('23514'); // a copy starts sent
    expect(await code(c.insert('os_claude_requests', req({ handoff: 'nope' })))).toBe('23514');
    const [row] = await c.insert('os_claude_requests', req({ handoff: 'copy', status: 'sent', sent_at: null }));
    expect(row.sent_at).toBeTruthy();
    expect(await code(c.insert('os_claude_requests', req({ session_url: 'https://claude.ai.evil.example/x' })))).toBe('23514');
  });

  it('the app moves queued to cancelled and sent to done or cancelled, and nothing back to queued', async () => {
    const c = fresh();
    await c.insert('os_claude_requests', req({ id: 'q' }));
    expect(await code(c.update('os_claude_requests', { id: 'q' }, { status: 'firing' }))).toBe('23514');
    expect(await code(c.update('os_claude_requests', { id: 'q' }, { status: 'done' }))).toBe('23514');
    await c.update('os_claude_requests', { id: 'q' }, { status: 'cancelled' });
    expect(await code(c.update('os_claude_requests', { id: 'q' }, { status: 'queued' }))).toBe('23514'); // R2S01 b
    await c.update('os_claude_requests', { id: 'q' }, { seen_at: new Date().toISOString() }); // only seen_at may change
    expect(await code(c.update('os_claude_requests', { id: 'q' }, { result: 'x' }))).toBe('23514');
  });

  it('brief, title, area and handoff never change after insert', async () => {
    const c = fresh();
    await c.insert('os_claude_requests', req({ id: 'f' }));
    for (const patch of [{ brief: 'new' }, { title: 'new' }, { area: 'personal' }, { handoff: 'copy' }]) {
      expect(await code(c.update('os_claude_requests', { id: 'f' }, patch))).toBe('23514');
    }
  });

  it('an app session cannot write the server keys', async () => {
    const c = fresh();
    expect(await code(c.upsert('os_settings', { key: 'claude_routine', value: { linked: true } }, 'key'))).toBe('42501');
    expect(await code(c.upsert('os_settings', { key: 'claude_fire_budget', value: 1e6 }, 'key'))).toBe('42501');
    expect(await code(c.upsert('os_settings', { key: 'default_mode', value: 'work' }, 'key'))).toBe('ok');
  });

  it('a clash names the key it broke, so a primary key clash can be told from the open-request rule', async () => {
    const c = fresh();
    await c.insert('os_claude_requests', req({ id: 'p', task_id: 't1' }));
    const pk = await c.insert('os_claude_requests', req({ id: 'p' })).catch((e) => e);
    const open = await c.insert('os_claude_requests', req({ task_id: 't1' })).catch((e) => e);
    expect(isPrimaryDup(pk)).toBe(true);
    expect(isPrimaryDup(open)).toBe(false);
    expect(isRuleError(pk)).toBe(false);
  });

  it('a snooze copy goes with its original, and select pages with range', async () => {
    const c = fresh();
    await c.insert('os_reminders', { id: 'r1', title: 'x', area: 'work', repeat: 'daily', active: true });
    await c.insert('os_reminders', { id: 'r2', title: 'x', area: 'work', repeat: 'none', active: true, snooze_of: 'r1' });
    await c.remove('os_reminders', { id: 'r1' });
    expect(await c.select('os_reminders', { filters: [['id', 'in', ['r1', 'r2']]] })).toHaveLength(0);
    for (let i = 0; i < 5; i++) await c.insert('os_notes', { id: `n${i}`, title: `n${i}`, body: '', area: 'work', pinned: false });
    const page = await c.select('os_notes', { filters: [['id', 'in', ['n0', 'n1', 'n2', 'n3', 'n4']]], order: [['id', 'asc']], range: [1, 3] });
    expect(page.map((r) => r.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('push addresses must be a known push host', async () => {
    const c = fresh();
    expect(await code(c.upsert('os_push_subscriptions', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'x', auth: 'y' }, 'endpoint'))).toBe('ok');
    expect(await code(c.upsert('os_push_subscriptions', { endpoint: 'https://127.0.0.1/x', p256dh: 'x', auth: 'y' }, 'endpoint'))).toBe('23514');
    expect(await code(c.upsert('os_push_subscriptions', { endpoint: 'http://fcm.googleapis.com/x', p256dh: 'x', auth: 'y' }, 'endpoint'))).toBe('23514');
  });
});
