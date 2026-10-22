// v0.14 每日一穗：3 件很久没碰的旧穗 + 1 个从没试过的远距离组合（4 件）。
// 完全本地、按日期种子确定：同一天结果一样（并存进 daily 表），第二天换一批（避开昨天那三穗）。
import { dayKey } from './heatmap';
import { cosine, jaccard, mulberry32, tokens } from './similarity';
import type { DailyPick, Development, Item } from './types';

export const DAILY_OLD = 3;
export const DAILY_COMBO = 4;
const DAY = 86400000;

/** 字符串 → 32 位种子（FNV-1a） */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 每件穗最近一次被碰的时间：打开 / 编辑（touchedAt）、拿去嫁接（新枝时间）、都没有就是拾进来的时间 */
export function lastTouchMap(items: Item[], devs: Array<Pick<Development, 'itemIds' | 'createdAt'>>): Map<number, number> {
  const m = new Map<number, number>();
  for (const it of items) if (it.id != null) m.set(it.id, Math.max(it.touchedAt || 0, it.createdAt || 0));
  for (const d of devs) for (const id of d.itemIds || []) if (m.has(id) && d.createdAt > m.get(id)!) m.set(id, d.createdAt);
  return m;
}

/** 有自己的穗（≥4）时只用自己的；否则示例也算 */
export function dailyPool(items: Item[]): Item[] {
  const withId = items.filter((i) => i.id != null);
  const own = withId.filter((i) => !i.sample);
  return own.length >= DAILY_COMBO ? own : withId;
}

/** 带缓存的相似度（与 similarity.ts 的口径一致），1000 穗里反复比较也不卡 */
function simFactory() {
  const tk = new Map<number, Set<string>>();
  const tok = (it: Item) => {
    let s = tk.get(it.id!);
    if (!s) tk.set(it.id!, (s = tokens(it)));
    return s;
  };
  return (a: Item, b: Item) => {
    if (a.embedding && b.embedding && a.embedModel === b.embedModel && a.embedding.length === b.embedding.length) return Math.max(0, Math.min(1, cosine(a.embedding, b.embedding)));
    return Math.min(1, jaccard(tok(a), tok(b)) * 3 + (a.type === b.type ? 0.15 : 0));
  };
}

/** 这组穗是否已经一起嫁接过（某根新枝的素材包含这组全部） */
export function triedTogether(ids: number[], devs: Array<Pick<Development, 'itemIds'>>): boolean {
  return devs.some((d) => ids.every((id) => (d.itemIds || []).includes(id)));
}

function pairsTried(ids: number[], pairSet: Set<string>): number {
  let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (pairSet.has(pk(ids[i], ids[j]))) n++;
  return n;
}
const pk = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** 从 arr 里按 rand 无放回抽 k 个（保持确定性） */
function sample<T>(arr: T[], k: number, rand: () => number): T[] {
  const a = [...arr];
  const out: T[] = [];
  while (out.length < k && a.length) out.push(a.splice(Math.floor(rand() * a.length), 1)[0]);
  return out;
}

export interface DailyInput {
  items: Item[];
  devs: Array<Pick<Development, 'itemIds' | 'createdAt'>>;
  day: string;
  /** 前一天（最近一次）的结果：旧穗尽量不重复，组合不重样 */
  prev?: Pick<DailyPick, 'oldIds' | 'comboIds'> | null;
}

/** 纯函数：算出某一天的每日一穗。穗不够 4 件返回 null */
export function pickDaily({ items, devs, day, prev }: DailyInput): Pick<DailyPick, 'day' | 'oldIds' | 'comboIds'> | null {
  const pool = dailyPool(items).sort((a, b) => a.id! - b.id!);
  if (pool.length < DAILY_COMBO) return null;
  const rand = mulberry32(hashSeed('glean-daily:' + day));
  const touch = lastTouchMap(pool, devs);
  // 1) 很久没碰：最久没碰的那一截（至少 6 件、约三成）里按种子抽 3 件；昨天出现过的先让开
  let byOld = [...pool].sort((a, b) => touch.get(a.id!)! - touch.get(b.id!)! || a.id! - b.id!);
  // 最近 3 天碰过的不算「很久没碰」（剩下的够 3 件时）
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const stale = Number.isFinite(dayStart) ? byOld.filter((i) => touch.get(i.id!)! < dayStart - 2 * DAY) : byOld;
  if (stale.length >= DAILY_OLD) byOld = stale;
  const k = Math.min(byOld.length, Math.max(6, Math.ceil(byOld.length * 0.3)));
  let cand = byOld.slice(0, k);
  const prevOld = new Set(prev?.oldIds || []);
  const fresh = cand.filter((i) => !prevOld.has(i.id!));
  if (fresh.length >= DAILY_OLD) cand = fresh;
  else if (prevOld.size) {
    // 最久没碰的一截全是昨天的：往后多看一些，仍然优先没出现过的
    const more = byOld.filter((i) => !prevOld.has(i.id!));
    if (more.length >= DAILY_OLD) cand = more.slice(0, Math.max(DAILY_OLD, k));
  }
  const old = sample(cand, DAILY_OLD, rand).sort((a, b) => touch.get(a.id!)! - touch.get(b.id!)! || a.id! - b.id!);
  // 2) 远距离组合：以一件旧穗为锚，贪心挑离得最远的 3 件；没一起嫁接过的优先，两两都没碰过头更好
  const sim = simFactory();
  const pairSet = new Set<string>();
  for (const d of devs) {
    const ids = (d.itemIds || []).filter((x) => x > 0);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairSet.add(pk(ids[i], ids[j]));
  }
  const prevCombo = prev?.comboIds ? [...prev.comboIds].sort((a, b) => a - b).join(',') : '';
  let best: { ids: number[]; score: number } | null = null;
  const tries = 36;
  for (let t = 0; t < tries; t++) {
    const anchor = old[t % old.length];
    const rest = pool.filter((p) => p !== anchor);
    const sub = rest.length > 80 ? sample(rest, 80, rand) : rest;
    const chosen: Item[] = [anchor];
    while (chosen.length < DAILY_COMBO) {
      const left = sub.filter((p) => !chosen.includes(p));
      if (!left.length) break;
      const scored = left.map((r) => ({ r, d: chosen.reduce((s, c) => s + sim(r, c), 0) / chosen.length + (chosen.some((c) => c.type === r.type) ? 0.08 : 0) + (pairSet.has(pk(r.id!, anchor.id!)) ? 0.2 : 0) }));
      scored.sort((a, b) => a.d - b.d || a.r.id! - b.r.id!);
      const top = scored.slice(0, Math.min(3, scored.length));
      chosen.push(top[Math.floor(rand() * top.length)].r);
    }
    if (chosen.length < DAILY_COMBO) continue;
    const ids = chosen.map((c) => c.id!);
    let s = 0;
    let n = 0;
    for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) (s += sim(chosen[i], chosen[j])), n++;
    let score = s / n + 0.15 * pairsTried(ids, pairSet) + 0.04 * (chosen.length - new Set(chosen.map((c) => c.type)).size);
    if (triedTogether(ids, devs)) score += 10;
    if ([...ids].sort((a, b) => a - b).join(',') === prevCombo) score += 5;
    if (!best || score < best.score - 1e-9) best = { ids, score };
  }
  if (!best) return null;
  return { day, oldIds: old.map((o) => o.id!), comboIds: best.ids };
}

export function todayKey(now = Date.now()): string {
  return dayKey(now);
}

/** 记录还能不能用：里面的穗都还在（当天新拾的穗不会让今天的内容变，第二天才算进来） */
export function pickStillValid(rec: Pick<DailyPick, 'oldIds' | 'comboIds'>, items: Item[]): boolean {
  const ids = new Set(items.filter((i) => i.id != null).map((i) => i.id!));
  return rec.oldIds.length === DAILY_OLD && rec.comboIds.length === DAILY_COMBO && [...rec.oldIds, ...rec.comboIds].every((id) => ids.has(id));
}

/** 某件穗多少天没碰了（展示用） */
export function daysUntouched(it: Item, devs: Array<Pick<Development, 'itemIds' | 'createdAt'>>, now = Date.now()): number {
  const t = lastTouchMap([it], devs).get(it.id!) || it.createdAt;
  return Math.max(0, Math.floor((now - t) / DAY));
}
