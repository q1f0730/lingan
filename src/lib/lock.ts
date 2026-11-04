// v0.39 0907 敏感穗上锁：首屏只要这几行状态（PIN 校验 / 设置在懒加载的 lockpin.ts）。
// 上锁的穗：没解锁时卡片只显示「上锁的一穗」，秒搜 / 口味 / 每日一穗里看不到；不管解没解锁，都永远不进分享、花园、Agent / MCP、AI。
// PIN 只在这台设备上（PBKDF2 哈希存 localStorage，不同步、不进备份）；解锁 5 分钟，或 App 切到后台就重新锁上。
// 这是「防随手翻 + 防外发」的帘子，不是加密：库本身仍是明文存在本机（同步时照常端到端加密）。
import { useSyncExternalStore } from 'react';
import type { Item } from './types';

export const LOCK_KEY = 'glean.lock.v1';
export const UNLOCK_MS = 5 * 60 * 1000;

let until = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** 设过 PIN 没有 */
export function lockReady(): boolean {
  try {
    return !!localStorage.getItem(LOCK_KEY);
  } catch {
    return false;
  }
}
export function unlocked(): boolean {
  return Date.now() < until;
}
/** 这一穗现在要不要挡住（上锁且没解锁） */
export function hidden(it: { locked?: 1 } | null | undefined): boolean {
  return !!it?.locked && !unlocked();
}
export function openFor(ms = UNLOCK_MS): void {
  until = Date.now() + ms;
  clearTimeout(timer);
  timer = setTimeout(relock, ms + 50);
  emit();
}
export function relock(): void {
  if (!until) return;
  until = 0;
  clearTimeout(timer);
  emit();
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && relock());

function sub(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
/** 组件里用：解锁 / 重新锁上时重画 */
export function useUnlocked(): boolean {
  return useSyncExternalStore(sub, unlocked, () => false);
}

export const LOCKED_TITLE = '上锁的一穗';
/** 没解锁时把上锁的穗换成只剩类型和时间的空壳（穗仓卡片 / 列表 / 时间线 / 标签云都用它，筛选也匹配不到内容） */
export function masked<T extends Item>(it: T): T {
  if (!it.locked || unlocked()) return it;
  return { ...it, title: LOCKED_TITLE, content: '', creator: '', year: '', url: '', why: '', tags: [], caption: undefined, ocr: undefined, snap: undefined, revisits: undefined, hasImage: undefined, thumb: undefined, image: undefined, bundles: undefined, links: undefined, work: undefined, source: undefined };
}
