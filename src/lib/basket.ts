/**
 * v0.28 0408 待嫁接篮：浏览时随手丢进来，满 3 穗一键嫁接（最多 5 穗，和嫁接页一样）。
 * 只存穗 id，放在 localStorage（不是数据库 schema 变更）；多个窗口之间靠 storage 事件同步。
 */
import { useSyncExternalStore } from 'react';

export const BASKET_KEY = 'glean.basket.v1';
export const BASKET_MAX = 5;
export const BASKET_MIN = 3;
const EVT = 'glean:basket';

let cache: number[] | null = null;

export function parseBasket(raw: string | null): number[] {
  try {
    const a = JSON.parse(raw || '[]');
    if (!Array.isArray(a)) return [];
    const out: number[] = [];
    for (const x of a) if (Number.isInteger(x) && x > 0 && !out.includes(x)) out.push(x);
    return out.slice(0, BASKET_MAX);
  } catch {
    return [];
  }
}

export function getBasket(): number[] {
  if (cache) return cache;
  try {
    cache = parseBasket(localStorage.getItem(BASKET_KEY));
  } catch {
    cache = [];
  }
  return cache;
}

function write(ids: number[]) {
  cache = ids.slice(0, BASKET_MAX);
  try {
    if (cache.length) localStorage.setItem(BASKET_KEY, JSON.stringify(cache));
    else localStorage.removeItem(BASKET_KEY);
  } catch {
    /* 隐私模式：只在这次会话里有效 */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
}

/** 纯函数：放进去（已在就不动，满了就挤掉最早的一穗），返回新篮与结果 */
export function addTo(list: number[], id: number): { list: number[]; result: 'added' | 'already' | 'bumped'; bumped?: number } {
  if (list.includes(id)) return { list, result: 'already' };
  if (list.length >= BASKET_MAX) return { list: [...list.slice(1), id], result: 'bumped', bumped: list[0] };
  return { list: [...list, id], result: 'added' };
}

export function addToBasket(id: number) {
  const r = addTo(getBasket(), id);
  if (r.result !== 'already') write(r.list);
  return r;
}
export function removeFromBasket(id: number) {
  write(getBasket().filter((x) => x !== id));
}
export function toggleBasket(id: number): boolean {
  if (getBasket().includes(id)) {
    removeFromBasket(id);
    return false;
  }
  addToBasket(id);
  return true;
}
export function clearBasket() {
  write([]);
}
/** 篮里的穗被删 / 进回收站：清掉认不出的 id */
export function pruneBasket(alive: Set<number>) {
  const b = getBasket();
  const k = b.filter((x) => alive.has(x));
  if (k.length !== b.length) write(k);
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === BASKET_KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', onStorage);
  };
}
const EMPTY: number[] = [];
export function useBasket(): number[] {
  return useSyncExternalStore(subscribe, getBasket, () => EMPTY);
}

/** 篮子按钮上的话：还差几穗 / 可以接了 */
export function basketHint(n: number): string {
  if (n <= 0) return '篮子是空的';
  if (n < BASKET_MIN) return `再放 ${BASKET_MIN - n} 穗就能嫁接`;
  if (n >= BASKET_MAX) return `满了（最多 ${BASKET_MAX} 穗）`;
  return `可以嫁接了 · 还能放 ${BASKET_MAX - n} 穗`;
}
