import { useSyncExternalStore } from 'react';

/** A reminder banner. `reminderId` is set on a fired banner, so it can offer Done and In 10 min. */
export type BannerItem = { id: string; kind: 'missed' | 'fired'; text: string; reminderId?: string };
let items: BannerItem[] = [];
/** Reminders that have had a fired banner this session: the next open never calls them earlier (QA r2 P05). */
const rung = new Set<string>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function addBanner(b: BannerItem) {
  if (items.some((x) => x.id === b.id)) return;
  if (b.kind === 'fired' && b.reminderId) rung.add(b.reminderId);
  items = [...items, b];
  emit();
}
export function dismissBanner(id: string) {
  items = items.filter((x) => x.id !== id);
  emit();
}
/** True when a banner for this reminder was shown in this session. */
export const bannerShown = (reminderId: string) => rung.has(reminderId);
/** True while a fired banner for this reminder is still on screen. */
export const bannerOpen = (reminderId: string) => items.some((x) => x.reminderId === reminderId);
export function useBanners(): BannerItem[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => items);
}
