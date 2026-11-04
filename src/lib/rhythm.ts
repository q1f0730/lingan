// v0.45 拾穗的节奏（懒加载，穗仓回看卡 / 设置 / 到点递一穗共用的纯逻辑）：
// 0924 封存到某天、0942 一年前的今天、0311 作品停了 7 天、0843 补一句为什么、ROADMAP v0.33 到点递一穗（时间 / 文案）。
import { dayKey } from './heatmap';
import type { Item, Work } from './types';

const DAY = 86400000;

// ── 0924 封存到某天 ──
/** 拆封日 = 那天本地 0 点 */
export function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
/** 几个现成的拆封日：一个月 / 半年 / 一年后的同一天（月底对不上就落到那个月最后一天） */
export function sealChoices(now = Date.now()): Array<{ label: string; at: number }> {
  const d = new Date(now);
  const add = (m: number) => {
    const t = new Date(d.getFullYear(), d.getMonth() + m, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)).getTime();
  };
  return [
    { label: '一个月后', at: add(1) },
    { label: '半年后', at: add(6) },
    { label: '一年后', at: add(12) },
  ];
}
/** 用户自己挑的日期（yyyy-mm-dd）：必须是明天或以后，最多 10 年 */
export function parseSealDate(s: string, now = Date.now()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  if (!Number.isFinite(t) || dayKey(t) !== s.trim()) return null;
  return t > dayStart(now) && t <= now + 3660 * DAY ? t : null;
}
export const sealed = (it: Pick<Item, 'sealUntil' | 'deletedAt'>) => !!it.sealUntil && !it.deletedAt;
/** 到期的来信（最早封存的在前） */
export function dueLetters<T extends Pick<Item, 'sealUntil' | 'sealAt' | 'createdAt' | 'deletedAt'>>(items: T[], now = Date.now()): T[] {
  return items.filter((i) => sealed(i) && i.sealUntil! <= now).sort((a, b) => (a.sealAt || a.createdAt) - (b.sealAt || b.createdAt));
}
/** 还在封存中的：数量 + 最近一次拆封日 */
export function sealedSummary(items: Array<Pick<Item, 'sealUntil' | 'deletedAt'>>, now = Date.now()): { n: number; next: number | null } {
  let n = 0;
  let next: number | null = null;
  for (const i of items) {
    if (!sealed(i) || i.sealUntil! <= now) continue;
    n++;
    if (next == null || i.sealUntil! < next) next = i.sealUntil!;
  }
  return { n, next };
}
export const daysBetween = (a: number, b: number) => Math.max(0, Math.round((dayStart(b) - dayStart(a)) / DAY));

// ── 0942 一年前的今天：只在打开 App 时安静出现，不推送；同一天固定是那一穗 ──
export function yearAgo<T extends Pick<Item, 'id' | 'createdAt' | 'deletedAt' | 'sample' | 'locked' | 'down' | 'sealUntil'>>(items: T[], now = Date.now()): T | null {
  const d = new Date(now);
  const hits = items.filter((i) => {
    if (i.deletedAt || i.sample || i.locked || i.down || i.sealUntil || i.id == null) return false;
    const c = new Date(i.createdAt);
    return c.getFullYear() < d.getFullYear() && c.getMonth() === d.getMonth() && c.getDate() === d.getDate();
  });
  if (!hits.length) return null;
  hits.sort((a, b) => a.createdAt - b.createdAt);
  return hits[(d.getFullYear() * 31 + d.getDate()) % hits.length];
}

// ── 0311 作品停了 7 天：今日卡下面轻推一次（同一段停顿只推一次；作品一动，下一段停顿再推） ──
export const STALE_DAYS = 7;
export const WORK_SEEN_KEY = 'glean.worknudge';
export function staleWork<T extends Pick<Work, 'uid' | 'stage' | 'updatedAt' | 'createdAt' | 'deletedAt'>>(works: T[], seen: Record<string, number>, now = Date.now()): { work: T; days: number } | null {
  let best: { work: T; days: number } | null = null;
  for (const w of works) {
    if (w.deletedAt || w.stage === 'done' || !w.uid) continue;
    const t = w.updatedAt || w.createdAt;
    const days = Math.floor((now - t) / DAY);
    if (days < STALE_DAYS || seen[w.uid] === t) continue;
    if (!best || days < best.days) best = { work: w, days };
  }
  return best;
}

// ── 0843 补一句为什么：拾进来 24 小时后还没写的，一次最多 3 条（最近的在前） ──
export function needWhy<T extends Pick<Item, 'id' | 'why' | 'createdAt' | 'deletedAt' | 'sample' | 'locked' | 'down' | 'sealUntil' | 'polarity'>>(items: T[], now = Date.now(), n = 3): T[] {
  return items
    .filter((i) => i.id != null && !i.deletedAt && !i.sample && !i.locked && !i.down && !i.sealUntil && i.polarity !== -1 && !(i.why || '').trim() && i.createdAt <= now - DAY)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, n);
}

// ── ROADMAP v0.33 到点递一穗 ──
export const PING_KEY = 'glean.ping';
export interface PingCfg {
  on: boolean;
  /** 本地时间 HH:MM */
  at: string;
  /** 0843 文案里带上「还有 n 穗没写为什么」 */
  why: boolean;
  /** 0839 同时推到微信（Server酱 SendKey 在钥匙串里） */
  wx: boolean;
}
export const PING_DEFAULT: PingCfg = { on: false, at: '21:30', why: true, wx: false };
export function readPing(): PingCfg {
  try {
    const o = JSON.parse(localStorage.getItem(PING_KEY) || '{}');
    return { on: !!o.on, at: hm(o.at) ? o.at : PING_DEFAULT.at, why: o.why !== false, wx: !!o.wx };
  } catch {
    return { ...PING_DEFAULT };
  }
}
export function writePing(c: PingCfg) {
  localStorage.setItem(PING_KEY, JSON.stringify(c));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('glean:ping'));
}
export function hm(s: unknown): [number, number] | null {
  const m = typeof s === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) : null;
  return m ? [+m[1], +m[2]] : null;
}
/** 今天几点该递（本地时间） */
export function fireAt(at: string, now = Date.now()): number {
  const [h, m] = hm(at) || [21, 30];
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
}
/** 现在该不该递：过了今天的点、今天还没递过、离那个点不超过 3 小时（晚上关着机、第二天早上开机不补昨天的） */
export function pingDue(cfg: PingCfg, last: string | null, now = Date.now()): boolean {
  if (!cfg.on) return false;
  const t = fireAt(cfg.at, now);
  return now >= t && now - t < 3 * 3600000 && last !== dayKey(now);
}

export interface PingMsg {
  title: string;
  body: string;
}
/**
 * 一条通知的文字。只给标题级信息（不带正文 / 为什么原文）；上锁的穗、私密穗只说「一穗」；
 * 开了 PIN 上锁（hidden）就整条不带任何标题。来信优先：拆封那天的通知只说有信到，不剧透是哪一穗。
 */
export function pingMessage(o: { hero?: Pick<Item, 'title' | 'type' | 'content' | 'private' | 'locked'> | null; untouched?: number; letters?: number; noWhy?: number; hidden?: boolean; withWhy?: boolean }): PingMsg {
  const tail = o.withWhy && (o.noWhy || 0) >= 3 ? `；还有 ${o.noWhy} 穗没写为什么` : '';
  if (o.letters) return { title: '一封给未来的穗到了', body: `${o.letters > 1 ? `${o.letters} 穗` : '你封存的一穗'}今天可以拆开了${tail}` };
  const h = o.hero;
  if (!h) return { title: '今日一穗', body: `今天的几穗在等你${tail}` };
  const name = o.hidden || h.private || h.locked ? '一穗' : `「${(h.title || h.content || '无题').replace(/\s+/g, ' ').slice(0, 24)}」`;
  const days = o.untouched && o.untouched > 0 ? `，${o.untouched} 天没碰了` : '';
  return { title: '今日一穗', body: `${name}${days}${tail}` };
}

// ── 0839 Server酱 SendKey → 推送地址（SCT… = Server酱 Turbo；sctp<uid>t… = Server酱³） ──
export function sctUrl(key: string): string | null {
  const k = key.trim();
  const m3 = /^sctp(\d+)t[A-Za-z0-9]+$/.exec(k);
  if (m3) return `https://${m3[1]}.push.ft07.com/send/${k}.send`;
  if (/^SCT[A-Za-z0-9]{8,}$/.test(k)) return `https://sctapi.ftqq.com/${k}.send`;
  return null;
}
export const PUSH_HOSTS = ['sctapi.ftqq.com', '*.push.ft07.com'];
