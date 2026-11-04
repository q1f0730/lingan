// v0.40 时间与回看：周记 / 月度麦捆 / 一年的麦田 / 被遗忘的好东西 / 本月在拾 + 休耕 / 口味会说话 / 田埂。纯函数，可单测；全部离线统计。
import { dayKey } from './heatmap';
import { hashSeed, lastTouchMap } from './daily';
import { TYPE_LABEL, type Development, type Item, type ItemType, type Work } from './types';

const DAY = 86400000;
type It = Pick<Item, 'createdAt' | 'tags' | 'type'> & Partial<Item>;

/** 口味页 / 热力图 / 麦捆共用的口径：没删、不是「我讨厌的」、没上锁 */
export const fieldItems = <T extends Partial<Item>>(a: T[]) => a.filter((x) => !x.deletedAt && x.polarity !== -1 && !x.locked && !x.sealUntil);

const count = <K>(a: K[]) => {
  const m = new Map<K, number>();
  for (const k of a) m.set(k, (m.get(k) || 0) + 1);
  return m;
};
const top = <K>(m: Map<K, number>, n = 1) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const inRange = (a: It[], from: number, to: number) => a.filter((i) => i.createdAt >= from && i.createdAt < to);

// ── 0923 休耕：考试周之类可以手动标，「本月有 n 天在拾」断了不清零，休耕的日子单独记 ──
export const FALLOW_KEY = 'glean.fallow';
export type Fallow = Array<[string, string]>;
export function readFallow(): Fallow {
  try {
    const a = JSON.parse(localStorage.getItem(FALLOW_KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => Array.isArray(x) && x.length === 2) : [];
  } catch {
    return [];
  }
}
export function writeFallow(f: Fallow) {
  if (f.length) localStorage.setItem(FALLOW_KEY, JSON.stringify(f.slice(-24)));
  else localStorage.removeItem(FALLOW_KEY);
}
export const isFallow = (key: string, f: Fallow) => f.some(([a, b]) => key >= a && key <= b);
/** 从今天起休耕 n 天 / 今天结束休耕（正在休耕的那段截到昨天） */
export function toggleFallow(f: Fallow, now = Date.now(), days = 7): Fallow {
  const t = dayKey(now);
  if (isFallow(t, f)) {
    const y = dayKey(now - DAY);
    return f.map(([a, b]): [string, string] => (t >= a && t <= b ? [a, y] : [a, b])).filter(([a, b]) => a <= b);
  }
  return [...f, [t, dayKey(now + (days - 1) * DAY)]];
}
/** 本月有几天在拾 / 休耕了几天（到今天为止） */
export function monthDays(items: It[], now = Date.now(), f: Fallow = []) {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const on = new Set(inRange(items, from, now + DAY).map((i) => dayKey(i.createdAt)));
  let rest = 0;
  for (let i = 1; i <= d.getDate(); i++) if (isFallow(dayKey(new Date(d.getFullYear(), d.getMonth(), i, 12).getTime()), f)) rest++;
  return { days: on.size, rest, resting: isFallow(dayKey(now), f) };
}

// ── 0922 / 0155 周记：周日（到周一）出一张卡 ──
export function weekKey(now = Date.now()): string | null {
  const d = new Date(now);
  const wd = d.getDay();
  if (wd !== 0 && wd !== 1) return null;
  return dayKey(now - (wd === 1 ? DAY : 0));
}
export function weekNote(items: It[], now = Date.now()) {
  const d = new Date(now);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (d.getDay() === 1 ? 0 : 1)).getTime();
  const w = inRange(items, end - 7 * DAY, end).filter((i) => !i.sample);
  const tag = top(count(w.flatMap((i) => i.tags)))[0];
  const type = top(count(w.map((i) => i.type)))[0];
  return { n: w.length, tag: tag && tag[1] >= 2 ? tag[0] : '', type: type ? TYPE_LABEL[type[0] as ItemType] : '', noWhy: w.filter((i) => !i.why?.trim()).length, items: w };
}
export const WEEK_QS = ['本周最打动你的一穗？', '哪穗你现在不同意了？', '下周想多拾什么？'];

// ── ROADMAP v0.37 月度麦捆 + 0925 被遗忘的好东西 ──
const SLOTS: Array<[string, number]> = [['凌晨', 6], ['早上', 11], ['中午', 14], ['下午', 18], ['晚上', 23], ['深夜', 24]];
const slot = (ts: number) => {
  const h = new Date(ts).getHours();
  return SLOTS.find(([, e]) => h < e)![0];
};
/** 每月 1–7 号出上个月那一捆；返回要看的 [年, 月(0 起)]，不在这几天返回 null */
export function sheafMonth(now = Date.now()): [number, number] | null {
  const d = new Date(now);
  if (d.getDate() > 7) return null;
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return [p.getFullYear(), p.getMonth()];
}
export function sheaf(items: It[], devs: Development[], y: number, m: number) {
  const from = new Date(y, m, 1).getTime();
  const to = new Date(y, m + 1, 1).getTime();
  const w = inRange(items, from, to);
  const ds = devs.filter((x) => !x.deletedAt && x.createdAt >= from && x.createdAt < to);
  // 最意外的一根：和已有新枝最不像的（0241 新颖度）；没测过就取做成 / 试过的
  const odd = ds.filter((x) => x.idea.nearest).sort((a, b) => a.idea.nearest!.sim - b.idea.nearest!.sim)[0] || ds.find((x) => x.status === 'done' || x.status === 'tried');
  const peak = top(count(w.map((i) => slot(i.createdAt))))[0];
  return { y, m, n: w.length, days: new Set(w.map((i) => dayKey(i.createdAt))).size, peak: peak ? peak[0] : '', branches: ds.length, odd };
}
/** 一年的麦田：去年整年 */
export function yearField(items: It[], devs: Development[], y: number) {
  const w = inRange(items, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime());
  const tag = top(count(w.flatMap((i) => i.tags)))[0];
  return { y, n: w.length, days: new Set(w.map((i) => dayKey(i.createdAt))).size, branches: devs.filter((x) => !x.deletedAt && new Date(x.createdAt).getFullYear() === y).length, tag: tag ? tag[0] : '' };
}
/** 半年以上没打开、没嫁接过的 k 穗（按月份种子固定，同一个月看到的一样） */
export function forgotten<T extends Item>(items: T[], devs: Development[], now = Date.now(), k = 3): T[] {
  const old = now - 182 * DAY;
  const last = lastTouchMap(items, devs);
  const seed = dayKey(now).slice(0, 7);
  return items
    .filter((i) => i.id != null && !i.down && !i.sample && !i.locked && !i.deletedAt && !i.graftCount && i.createdAt < old && (last.get(i.id) || 0) < old)
    .sort((a, b) => hashSeed(seed + (a.uid || a.id)) - hashSeed(seed + (b.uid || b.id)))
    .slice(0, k);
}

// ── ROADMAP v0.35 口味会说话 + 0919 现在的我 vs 一年前的我 ──
function shift(a: It[], b: It[]) {
  const ca = count(a.flatMap((i) => i.tags));
  const cb = count(b.flatMap((i) => i.tags));
  const up = [...ca.entries()].map(([t, n]): [string, number] => [t, n - (cb.get(t) || 0)]).filter(([, d]) => d >= 2).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const fade = [...cb.entries()].filter(([t, n]) => n >= 2 && !ca.has(t)).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t]) => t);
  return { up, fade };
}
export function tasteTalk(items: It[], now = Date.now()) {
  const rec = inRange(items, now - 30 * DAY, now + DAY);
  const prev = inRange(items, now - 60 * DAY, now - 30 * DAY);
  const { up, fade } = shift(rec, prev);
  const tt = top(count(rec.map((i) => i.type)))[0];
  let line = rec.length ? `最近 30 天拾了 ${rec.length} 穗，${TYPE_LABEL[tt[0] as ItemType]}最多` : '最近 30 天还没拾';
  if (up.length) line += `；${up.map(([t]) => t).join('、')}在升`;
  if (fade.length) line += `，${fade.join('、')}淡了`;
  line += '。';
  // 一年前那一年 vs 最近一年：前 10 个标签里哪些留下、哪些是新的、哪些不见了
  const ya = inRange(items, now - 365 * DAY, now + DAY);
  const yb = inRange(items, now - 730 * DAY, now - 365 * DAY);
  let year: { kept: string[]; fresh: string[]; gone: string[] } | null = null;
  if (yb.length >= 5 && ya.length >= 5) {
    const ta = top(count(ya.flatMap((i) => i.tags)), 10).map(([t]) => t);
    const tb = top(count(yb.flatMap((i) => i.tags)), 10).map(([t]) => t);
    year = { kept: ta.filter((t) => tb.includes(t)).slice(0, 5), fresh: ta.filter((t) => !tb.includes(t)).slice(0, 5), gone: tb.filter((t) => !ta.includes(t)).slice(0, 5) };
  }
  return { line, up, fade, year };
}

// ── 0926 / 0939 田埂：只记「第一次」，不弹窗、无积分 ──
export interface First {
  k: string;
  label: string;
  at: number;
  item?: Item;
}
export function firsts(items: Item[], devs: Development[], works: Work[] = []): First[] {
  const own = items.filter((i) => !i.sample && !i.deletedAt && !i.locked);
  const byId = new Map(own.map((i) => [i.id, i]));
  const ds = devs.filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt);
  const out: First[] = [];
  const min = <T>(a: T[], f: (x: T) => number) => a.reduce<T | undefined>((m, x) => (m === undefined || f(x) < f(m) ? x : m), undefined);
  const i0 = min(own, (i) => i.createdAt);
  if (i0) out.push({ k: 'item', label: '拾下第一穗', at: i0.createdAt, item: i0 });
  if (ds[0]) out.push({ k: 'graft', label: '第一次嫁接', at: ds[0].createdAt });
  const cross = ds.find((d) => new Set(d.itemIds.map((id) => byId.get(id)?.type).filter(Boolean)).size >= 2);
  if (cross) out.push({ k: 'cross', label: '第一次跨媒介嫁接', at: cross.createdAt });
  const done = min(ds.filter((d) => d.status === 'done'), (d) => d.statusAt || d.createdAt);
  if (done) out.push({ k: 'done', label: '第一根做成的新枝', at: done.statusAt || done.createdAt });
  const w0 = min(works.filter((w) => !w.deletedAt), (w) => w.createdAt);
  if (w0) out.push({ k: 'work', label: `第一次立项：${w0.title}`, at: w0.createdAt });
  let ry: First | undefined;
  for (const i of own) for (const r of i.revisits || []) if (r.y && (!ry || r.at < ry.at)) ry = { k: 'year', label: '第一次改写一年前的为什么', at: r.at, item: i };
  if (ry) out.push(ry);
  return out.sort((a, b) => a.at - b.at);
}
/** 0915 改变了看法的穗：一年后重写过为什么 */
export const changedMind = (items: Item[]) => items.filter((i) => i.revisits?.some((r) => r.y)).length;
/** 0915 这一穗到了「一年后再写一次」的时候：满 365 天、写过为什么、还没写过「现在的为什么」 */
export const yearDue = (it: Pick<Item, 'createdAt' | 'why' | 'revisits'>, now = Date.now()) => now - it.createdAt >= 365 * DAY && !!it.why?.trim() && !it.revisits?.some((r) => r.y);
