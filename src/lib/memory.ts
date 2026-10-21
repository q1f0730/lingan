// 记忆：时间线分组 + 「那年今天 / 一周前的你」回顾。纯函数，可单测。
import { dayKey } from './heatmap';
import type { Item } from './types';

export interface DayGroup<T> {
  key: string;
  ts: number;
  items: T[];
}

/** 按本地日期分组，天内与天间均为新→旧 */
export function groupByDay<T extends Pick<Item, 'createdAt'>>(items: T[]): Array<DayGroup<T>> {
  const m = new Map<string, DayGroup<T>>();
  for (const it of [...items].sort((a, b) => b.createdAt - a.createdAt)) {
    const k = dayKey(it.createdAt);
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, ts: it.createdAt, items: [] }));
    g.items.push(it);
  }
  return [...m.values()];
}

export interface Throwback<T> {
  label: string;
  items: T[];
}

const DAY = 86400000;
const sameDay = (a: number, b: number) => dayKey(a) === dayKey(b);
const shiftYears = (ts: number, y: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear() - y, d.getMonth(), d.getDate(), 12).getTime();
};

/** 找出「一周前 / 一个月前 / N 年前的今天」收的素材，只返回有素材的 */
export function throwbacks<T extends Pick<Item, 'createdAt'>>(items: T[], now: number = Date.now()): Array<Throwback<T>> {
  const out: Array<Throwback<T>> = [];
  const add = (label: string, target: number) => {
    const hit = items.filter((i) => sameDay(i.createdAt, target)).sort((a, b) => b.createdAt - a.createdAt);
    if (hit.length) out.push({ label, items: hit });
  };
  const noon = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate(), 12).getTime();
  add('一周前的你', noon - 7 * DAY);
  add('一个月前的你', noon - 30 * DAY);
  for (let y = 1; y <= 10; y++) add(y === 1 ? '那年今天 · 1 年前' : `那年今天 · ${y} 年前`, shiftYears(noon, y));
  return out;
}
