// v0.44（v0.43 遗留）：嫁接配方（glean.recipes ≤8）与智能穗束（glean.smart ≤12）进同步。
// 它们只在本机 localStorage，不改 Dexie：每台设备在云端写一份 prefs/<设备>.json（和别的同步文件一样加密），
// 内容是这台设备眼里的登记表 { r: {配方名: [hlc, 配方 | 0]}, s: {查询: [hlc, {q, at} | 0]} }，0 = 删了（墓碑）。
// 一次同步：① 本机列表和本机登记表比，新加 / 改过的盖新章，登记表里有、本机列表里没了的记墓碑；
// ② 读别的设备的 prefs 文件（etag 没变就不下），同一个名字按 HLC 大的为准；
// ③ 结果写回本机列表（新章在前、各自上限），登记表变了才上传自己那份。
import { tick, recv } from '../hlc';
import type { SyncKey } from './crypto';
import type { SyncTransport } from './transport';

type Ent = [string, unknown];
export interface PrefReg {
  r: Record<string, Ent>;
  s: Record<string, Ent>;
}
export interface PrefStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const KEYS = { r: 'glean.recipes', s: 'glean.smart' } as const;
const MAX = { r: 8, s: 12 };
const REG = 'glean.sync.prefs';
const TOMBS = 40;

const parse = <T,>(st: PrefStore, k: string, fb: T): T => {
  try {
    const v = st.getItem(k);
    return v == null ? fb : (JSON.parse(v) as T);
  } catch {
    return fb;
  }
};
const nameOf = (k: 'r' | 's', x: unknown): string => {
  const o = x as { name?: unknown; q?: unknown } | null;
  const n = k === 'r' ? o?.name : o?.q;
  return typeof n === 'string' && n.trim() ? n : '';
};

/** ① 本机列表 → 登记表（盖章 / 墓碑）；返回新登记表 */
export function stampLocal(st: PrefStore, reg: PrefReg, now = Date.now()): PrefReg {
  const out: PrefReg = { r: { ...reg.r }, s: { ...reg.s } };
  for (const k of ['r', 's'] as const) {
    const list = parse<unknown[]>(st, KEYS[k], []);
    const have = new Set<string>();
    for (const x of Array.isArray(list) ? list : []) {
      const n = nameOf(k, x);
      if (!n || have.has(n)) continue;
      have.add(n);
      const e = out[k][n];
      if (!e || !e[1] || JSON.stringify(e[1]) !== JSON.stringify(x)) out[k][n] = [tick(now), x];
    }
    for (const [n, e] of Object.entries(out[k])) if (e[1] && !have.has(n)) out[k][n] = [tick(now), 0];
  }
  return out;
}

/** ② 按名字合并：HLC 大的赢；墓碑只留最近 40 个 */
export function mergeReg(a: PrefReg, b: PrefReg): PrefReg {
  const out: PrefReg = { r: { ...a.r }, s: { ...a.s } };
  for (const k of ['r', 's'] as const)
    for (const [n, e] of Object.entries(b[k] || {})) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || (e[1] && nameOf(k, e[1]) !== n)) continue;
      const mine = out[k][n];
      if (!mine || e[0] > mine[0]) out[k][n] = [e[0], e[1] || 0];
    }
  for (const k of ['r', 's'] as const) {
    const dead = Object.entries(out[k]).filter(([, e]) => !e[1]).sort((x, y) => (x[1][0] < y[1][0] ? 1 : -1));
    for (const [n] of dead.slice(TOMBS)) delete out[k][n];
  }
  return out;
}

/** ③ 登记表 → 本机列表（新章在前，各自上限） */
export function listsOf(reg: PrefReg): { r: unknown[]; s: unknown[] } {
  const pick = (k: 'r' | 's') =>
    Object.values(reg[k])
      .filter((e) => e[1])
      .sort((x, y) => (x[0] < y[0] ? 1 : -1))
      .slice(0, MAX[k])
      .map((e) => e[1]);
  return { r: pick('r'), s: pick('s') };
}

const stable = (reg: PrefReg) => JSON.stringify(['r', 's'].map((k) => Object.entries(reg[k as 'r' | 's']).sort((x, y) => (x[0] < y[0] ? -1 : 1))));
/** 登记表的短指纹：写进回执（dev/<设备>.json 的 pv），别的设备看它变了才来下 prefs 文件——不多列目录 */
const hash = (t: string) => {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = (h * 33 + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + t.length.toString(36);
};

/** 一次配方 / 智能穗束同步；pv = 各设备回执里的指纹。返回本机变了几样（0 = 没变） */
export async function syncPrefs(c: { tr: SyncTransport; key: SyncKey; dev: string; state: { prefsUp?: string; prefsTags?: Record<string, string> }; pv: Map<string, string | undefined>; store?: PrefStore; now?: number }): Promise<number> {
  const st = c.store || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!st) return 0;
  const now = c.now ?? Date.now();
  let reg = stampLocal(st, parse<PrefReg>(st, REG, { r: {}, s: {} }), now);
  const tags: Record<string, string> = {};
  for (const [d, pv] of c.pv) {
    if (d === c.dev || !pv) continue;
    const old = c.state.prefsTags?.[d];
    if (old === pv) {
      tags[d] = pv;
      continue;
    }
    const path = `prefs/${d}.json`;
    const box = await c.tr.get(path);
    if (!box) continue;
    try {
      const other = await c.key.openJson<PrefReg>(box, path);
      for (const k of ['r', 's'] as const) for (const x of Object.values(other[k] || {})) if (Array.isArray(x)) recv(String(x[0]), now);
      reg = mergeReg(reg, other);
      tags[d] = pv;
    } catch {
      /* 解不开的就当没有：只是这次少并一台 */
    }
  }
  c.state.prefsTags = tags;
  // 写回本机列表（变了几样：0 / 1 / 2）
  const after = listsOf(reg);
  let changed = 0;
  for (const k of ['r', 's'] as const) {
    const t = JSON.stringify(after[k]);
    if (t !== (st.getItem(KEYS[k]) || '[]')) {
      st.setItem(KEYS[k], t);
      changed++;
    }
  }
  st.setItem(REG, JSON.stringify(reg));
  const sig = hash(stable(reg));
  if (sig !== c.state.prefsUp && (Object.keys(reg.r).length || Object.keys(reg.s).length || c.state.prefsUp)) {
    const path = `prefs/${c.dev}.json`;
    await c.tr.put(path, await c.key.sealJson(reg, path));
    c.state.prefsUp = sig;
  }
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event('glean:prefs'));
  return changed;
}
