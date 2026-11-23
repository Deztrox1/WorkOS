import { createSupabaseClient, hasLiveConfig } from './supabase';
import type { DataClient } from './types';

const MODE_KEY = 'workos.data';

/** Sample data from the Settings toggle (remembered per browser). */
export function chooseSampleData() {
  try { localStorage.setItem(MODE_KEY, 'mock'); } catch { /* ignore */ }
}

/**
 * mock when VITE_DATA=mock, or when the Settings toggle chose sample data. A ?mock=1 link switches to sample data only in a
 * dev build, so a crafted link cannot show fake rows on the live app (QA r1 Q15). ?mock=0 always returns to live.
 */
export function selectedKind(): 'mock' | 'supabase' {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('mock') === '1' && (import.meta.env.DEV || import.meta.env.VITE_DATA === 'mock')) localStorage.setItem(MODE_KEY, 'mock');
    if (q.get('mock') === '0') localStorage.removeItem(MODE_KEY);
    if (import.meta.env.VITE_DATA === 'mock') return 'mock';
    return localStorage.getItem(MODE_KEY) === 'mock' ? 'mock' : 'supabase';
  } catch {
    return import.meta.env.VITE_DATA === 'mock' ? 'mock' : 'supabase';
  }
}

let client: DataClient | null = null;
let makeMock: (() => DataClient) | null = null;

/**
 * The sample client and its data load only when sample data is chosen, so they stay out of the main file (QA r4 R4S01).
 * main.tsx waits for this before the first render, which keeps getClient() simple and synchronous.
 */
export async function prepareClient(): Promise<void> {
  if (selectedKind() === 'mock') makeMock = (await import('./mock')).createMockClient;
}

export function getClient(): DataClient {
  if (!client) client = makeMock && selectedKind() === 'mock' ? makeMock() : createSupabaseClient();
  return client;
}

export function liveConfigMissing(): boolean {
  return selectedKind() === 'supabase' && !hasLiveConfig();
}
export * from './types';
