// 收集热力图：纯函数（可单测）。365 天、周一为每周第一天，列=周，行=周一..周日。
import type { Item } from './types';

export interface HeatCell {
  key: string; // YYYY-MM-DD（本地日期）
  ts: number; // 当天 00:00 本地时间戳
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  col: number; // 第几周（0 起）
  row: number; // 0=周一 … 6=周日
}

export interface Heatmap {
  cells: HeatCell[];
  weeks: number;
  total: number; // 窗口内素材数
  activeDays: number;
  longest: number; // 窗口内最长连续天数
  current: number; // 截至今天（今天没收则从昨天算）的连续天数
  max: number;
  months: Array<{ col: number; label: string }>;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const startOfDay = (ts: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const addDays = (ts: number, n: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};
/** 周一=0 … 周日=6 */
export const weekRow = (ts: number) => (new Date(ts).getDay() + 6) % 7;

export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!(count > 0) || !(max > 0)) return 0;
  const r = count / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

export function buildHeatmap(items: Array<Pick<Item, 'createdAt'>>, now: number = Date.now(), days = 365): Heatmap {
  const today = startOfDay(now);
  const first = addDays(today, -(days - 1));
  const counts = new Map<string, number>();
  for (const it of items) {
    if (!Number.isFinite(it.createdAt)) continue;
    if (it.createdAt < first || it.createdAt >= addDays(today, 1)) continue;
    const k = dayKey(it.createdAt);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  const lead = weekRow(first); // 第一列顶部空出的格数
  const cells: HeatCell[] = [];
  const months: Array<{ col: number; label: string }> = [];
  let lastMonth = -1;
  let total = 0;
  let active = 0;
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days; i++) {
    const ts = addDays(first, i);
    const k = dayKey(ts);
    const count = counts.get(k) || 0;
    const col = Math.floor((i + lead) / 7);
    const row = (i + lead) % 7;
    cells.push({ key: k, ts, count, level: heatLevel(count, max), col, row });
    total += count;
    if (count > 0) {
      active++;
      run++;
      longest = Math.max(longest, run);
    } else run = 0;
    const m = new Date(ts).getMonth();
    if (m !== lastMonth && (row === 0 || i === 0)) {
      // 月份标签放在该月出现的第一个周一所在列
      months.push({ col, label: `${m + 1}月` });
      lastMonth = m;
    }
  }
  let current = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].count > 0) current++;
    else if (i === cells.length - 1) continue; // 今天还没收，不算断
    else break;
  }
  return { cells, weeks: cells[cells.length - 1].col + 1, total, activeDays: active, longest, current, max, months };
}

/** 某天（YYYY-MM-DD）收的素材，按时间倒序 */
export function itemsOnDay<T extends Pick<Item, 'createdAt'>>(items: T[], key: string): T[] {
  return items.filter((i) => dayKey(i.createdAt) === key).sort((a, b) => b.createdAt - a.createdAt);
}
