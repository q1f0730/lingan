// v0.16 Studio 视觉用到的纯函数（可单测）：书名号、短日期、按周分组、月历、搜索高亮、标签计数。
import { dayKey } from './heatmap';
import { itemText } from './similarity';
import { parseQuery, splitByTerms } from './search';
import type { Development, Item } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** 书名统一加书名号（电影、摘抄出处）：《一一》不加书名号会被读成破折号。已带的不重复加 */
export function bookTitle(t: string): string {
  const s = (t || '').trim().replace(/^《+|》+$/g, '');
  return s ? `《${s}》` : '';
}

/** 卡片 / 行里显示的标题：电影加书名号，摘抄显示原文（带引号），其余原样 */
export function displayTitle(it: Pick<Item, 'type' | 'title' | 'content'>): string {
  if (it.type === 'text' && it.content) return `“${it.content.replace(/^[「“"『]+|[」”"』]+$/g, '')}”`;
  if (it.type === 'film') return bookTitle(it.title);
  return it.title || '无题';
}

/** 摘抄的出处行：作者《书名》 */
export function quoteSource(it: Pick<Item, 'type' | 'title' | 'creator' | 'content'>): string {
  if (it.type !== 'text' || !it.content) return it.creator || '';
  const t = it.title && it.title !== it.content.slice(0, 18) ? bookTitle(it.title) : '';
  return [it.creator, t].filter(Boolean).join(' ');
}

/** 10/21 这样的短日期（列表右列、网格说明） */
export function shortDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  if (d.getFullYear() !== new Date(now).getFullYear()) return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export interface WeekGroup<T> {
  key: string; // 周一的 YYYY-MM-DD
  start: number;
  end: number; // 周日 00:00
  label: string; // 10/19 — 10/25
  items: T[];
}

/** 按周（周一起）分组，新→旧 */
export function groupByWeek<T extends Pick<Item, 'createdAt'>>(items: T[]): Array<WeekGroup<T>> {
  const m = new Map<string, WeekGroup<T>>();
  for (const it of [...items].sort((a, b) => b.createdAt - a.createdAt)) {
    const d = new Date(it.createdAt);
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    const k = dayKey(mon.getTime());
    let g = m.get(k);
    if (!g) {
      const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
      g = { key: k, start: mon.getTime(), end: sun.getTime(), label: `${pad(mon.getMonth() + 1)}/${pad(mon.getDate())} — ${pad(sun.getMonth() + 1)}/${pad(sun.getDate())}`, items: [] };
      m.set(k, g);
    }
    g.items.push(it);
  }
  return [...m.values()];
}

export interface MonthCell {
  key: string; // YYYY-MM-DD
  day: number; // 1..31，前面的空格为 0
  count: number;
}
export interface MonthGrid {
  year: number;
  month: number; // 0..11
  label: string; // 十月
  total: number;
  cells: MonthCell[]; // 周一开头，前面补空格
}
const CN_MONTH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

/** 某月的收集月历：有穗的日子 count>0（月历上是黑格），不算分数、不算连续天数 */
export function monthGrid(items: Array<Pick<Item, 'createdAt'>>, year: number, month: number): MonthGrid {
  const counts = new Map<string, number>();
  const from = new Date(year, month, 1).getTime();
  const to = new Date(year, month + 1, 1).getTime();
  let total = 0;
  for (const it of items) {
    if (it.createdAt < from || it.createdAt >= to) continue;
    const k = dayKey(it.createdAt);
    counts.set(k, (counts.get(k) || 0) + 1);
    total++;
  }
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ key: `pad${i}`, day: 0, count: 0 });
  for (let d = 1; d <= days; d++) {
    const k = `${year}-${pad(month + 1)}-${pad(d)}`;
    cells.push({ key: k, day: d, count: counts.get(k) || 0 });
  }
  return { year, month, label: CN_MONTH[month], total, cells };
}

/** 有穗的月份（新→旧），月历左右翻页用 */
export function activeMonths(items: Array<Pick<Item, 'createdAt'>>): Array<[number, number]> {
  const s = new Set<string>();
  for (const it of items) {
    const d = new Date(it.createdAt);
    s.add(`${d.getFullYear()}-${d.getMonth()}`);
  }
  return [...s].map((k) => k.split('-').map(Number) as [number, number]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
}

/** 把文字按关键词切开，命中段 hit=true（搜索结果里黑底白字）。v0.17 起与秒搜同一套规则：中文连续命中、英文按词首前缀，多个词各自高亮 */
export function splitHits(text: string, q: string): Array<{ t: string; hit: boolean }> {
  if (!text) return [{ t: text, hit: false }];
  return splitByTerms(text, parseQuery(q));
}

/** 搜新枝：标题、正文、嫁接点里有关键词 */
export function matchBranch(d: Pick<Development, 'idea'>, q: string): boolean {
  const k = q.trim().toLowerCase();
  if (!k) return false;
  return [d.idea.title, d.idea.idea, d.idea.bridge, d.idea.form || ''].join(' ').toLowerCase().includes(k);
}

/** 搜穗（与之前的过滤规则一致：标题、作者、内容、为什么、标签…） */
export function matchItem(it: Item, q: string): boolean {
  const k = q.trim().toLowerCase();
  return !k || itemText(it).toLowerCase().includes(k);
}

/** 标签和真实计数，多→少 */
export function tagCounts(items: Array<Pick<Item, 'tags'>>, max = 24): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) for (const t of it.tags) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max);
}

/** 这一穗长进了哪些新枝（来源溯源反查） */
export function branchesFrom(devs: Development[], itemId: number): Development[] {
  return devs.filter((d) => d.itemIds.includes(itemId) || (d.idea.refs || []).some((r) => d.itemIds[r - 1] === itemId));
}

/** 两位序号 01 02 03 */
export const nn = (i: number) => pad(i + 1);
