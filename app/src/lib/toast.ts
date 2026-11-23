import { useSyncExternalStore } from 'react';

export type ToastAction = { label: string; run: () => void };
export type ToastItem = { id: number; text: string; kind: 'ok' | 'error'; action?: ToastAction };
let items: ToastItem[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** A short message. With an action (for example Undo) it stays 5 s and carries one button, and it replaces the last one: fast ticks never stack (R4P30). */
export function toast(text: string, kind: 'ok' | 'error' = 'ok', action?: ToastAction, ms = action ? 5000 : 3500) {
  const id = ++seq;
  items = [...items.filter((t) => !(action && t.action)), { id, text, kind, action }];
  emit();
  setTimeout(() => dismissToast(id), ms);
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => items,
  );
}
