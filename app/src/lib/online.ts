import { useSyncExternalStore } from 'react';

const subs = new Set<() => void>();
const bump = () => subs.forEach((s) => s());
if (typeof window !== 'undefined') {
  window.addEventListener('online', bump);
  window.addEventListener('offline', bump);
}
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => navigator.onLine,
  );
}
