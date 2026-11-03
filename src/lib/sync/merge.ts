// v0.31 0619 字段级 LWW 合并 + 0628 派生数据不进同步。
//
// 同步时每一行换成「同步行」SRow：只带会同步的字段（r），外加 hc（新建时的 HLC）、fh（改过的字段 → 那次的 HLC）。
// 一个字段的时间 = fh[字段] ?? hc。合并 = 每个字段取时间大的那边（同一个 HLC 就是同一次修改，值一定相同）。
// 这是逐字段取最大值，所以与顺序无关：交换、结合、幂等，任意顺序、重复应用都收敛（merge.test 的属性测试）。
// 本机自增 id（新枝的 itemIds / anchorId）在同步行里换成 uid，落地时再换回本机 id。
// 不进同步（对端自己重建 / 只对本机有意义）：缩略图、原图（另走内容寻址的加密文件）、向量、重复钥匙、标签建议、
// 碰过时间、嫁接次数统计、套路墙的计数。
import { HLC_ZERO, maxHlc, parseHlc } from '../hlc';
import type { SyncTable } from '../db';

export interface SRow {
  t: SyncTable;
  /** uid */
  u: string;
  /** 会同步的字段 */
  r: Record<string, unknown>;
  hc: string;
  fh?: Record<string, string>;
  /** 行里最大的 HLC */
  h: string;
  /** 最后修改时间（墙钟，只给人看） */
  at?: number;
  /** 原图内容寻址名（有图的穗） */
  img?: string;
  /** 只带了几个字段的墓碑行（「回到同步前」时把同步新加的那几行放进回收站） */
  p?: 1;
}
export interface Purge {
  t: SyncTable;
  u: string;
  h: string;
}

const META = ['id', 'uid', 'hlc', 'hc', 'fh', 'updatedAt', 'deviceId', 'imgSha'];
export const SKIP: Record<SyncTable, Set<string>> = {
  items: new Set([...META, 'thumb', 'thumbW', 'thumbH', 'thumbTodo', 'thumbFail', 'hasImage', 'image', 'embedding', 'embedModel', 'dup', 'tagSugg', 'touchedAt', 'graftCount', 'graftedAt', 'metaTodo']),
  developments: new Set(META),
  cliches: new Set([...META, 'listed', 'blocked', 'lastAt']),
  rejects: new Set(META),
  works: new Set(META),
};

export function fieldHlc(s: Pick<SRow, 'fh' | 'hc'>, k: string): string {
  return s.fh?.[k] ?? s.hc ?? HLC_ZERO;
}

type Row = Record<string, unknown> & { uid?: string; hlc?: string; hc?: string; fh?: Record<string, string>; updatedAt?: number };

/** 本机一行 → 同步行。idToUid：本机穗 id → uid（只有新枝要用） */
export function toSRow(t: SyncTable, row: Row, idToUid?: (id: number) => string | null): SRow {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!SKIP[t].has(k) && v !== undefined) r[k] = v;
  if (t === 'developments') {
    const map = (x: unknown) => (typeof x === 'number' && idToUid ? idToUid(x) : null);
    r.itemIds = Array.isArray(row.itemIds) ? (row.itemIds as unknown[]).map(map) : [];
    if (typeof row.anchorId === 'number') r.anchorId = map(row.anchorId);
  }
  const hc = row.hc || row.hlc || HLC_ZERO;
  const fh: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.fh || {})) if (!SKIP[t].has(k) && v !== hc) fh[k] = v;
  const out: SRow = { t, u: String(row.uid), r, hc, h: maxHlc(row.hlc, hc) };
  if (Object.keys(fh).length) out.fh = fh;
  if (typeof row.updatedAt === 'number') out.at = row.updatedAt;
  return out;
}

function stable(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

/** 字段级合并（纯函数，与顺序无关） */
export function mergeS(a: SRow, b: SRow): SRow {
  if (a.u !== b.u || a.t !== b.t) throw new Error('mergeS: 不是同一行');
  const keys = new Set([...Object.keys(a.r), ...Object.keys(b.r), ...Object.keys(a.fh || {}), ...Object.keys(b.fh || {})]);
  // hc 是新建那一刻的 HLC，同一行在每台设备上都一样；墓碑行（p）没有 hc
  const hc = a.p && !b.p ? b.hc : b.p && !a.p ? a.hc : a.hc > b.hc ? a.hc : b.hc;
  const r: Record<string, unknown> = {};
  const fh: Record<string, string> = {};
  let h = hc;
  for (const k of [...keys].sort()) {
    const ha = fieldHlc(a, k);
    const hb = fieldHlc(b, k);
    let win: SRow;
    if (ha !== hb) win = ha > hb ? a : b;
    else win = stable(a.r[k]) >= stable(b.r[k]) ? a : b; // 同一 HLC 值不同只会是坏数据：也要确定地选一边
    const w = ha > hb ? ha : hb;
    if (win.r[k] !== undefined) r[k] = win.r[k];
    if (w !== hc) fh[k] = w;
    if (w > h) h = w;
  }
  const out: SRow = { t: a.t, u: a.u, r, hc, h: maxHlc(h, maxHlc(a.h, b.h)) };
  if (Object.keys(fh).length) out.fh = fh;
  const at = Math.max(a.at || 0, b.at || 0);
  if (at) out.at = at;
  const img = a.h >= b.h ? a.img || b.img : b.img || a.img;
  if (img) out.img = img;
  if (a.p && b.p) out.p = 1;
  return out;
}

/** 两行同步上一样吗（不比 at / img） */
export function sameS(a: SRow, b: SRow): boolean {
  return a.hc === b.hc && stable(sortObj(a.r)) === stable(sortObj(b.r)) && stable(sortObj(a.fh || {})) === stable(sortObj(b.fh || {}));
}
function sortObj(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1)));
}

/**
 * 同步行 → 本机要写的那一行：本机只有的字段（缩略图、向量……）留着，会同步的字段整组换成合并结果。
 * uidToId：uid → 本机穗 id（新枝用；找不到给 -1，和导入一致）
 */
export function fromSRow(s: SRow, local: Row | undefined, uidToId?: (uid: string) => number | undefined): Row {
  const out: Row = {};
  if (local) for (const [k, v] of Object.entries(local)) if (SKIP[s.t].has(k)) out[k] = v;
  for (const [k, v] of Object.entries(s.r)) out[k] = v;
  if (s.t === 'developments') {
    const back = (u: unknown) => (typeof u === 'string' && uidToId ? uidToId(u) ?? -1 : -1);
    out.itemIds = Array.isArray(s.r.itemIds) ? (s.r.itemIds as unknown[]).map(back) : [];
    if (s.r.anchorId != null) {
      const a = back(s.r.anchorId);
      if (a >= 0) out.anchorId = a;
      else delete out.anchorId;
    }
  }
  out.uid = s.u;
  out.hc = s.hc;
  out.hlc = s.h;
  if (s.fh) out.fh = { ...s.fh };
  else delete out.fh;
  out.updatedAt = s.at || local?.updatedAt || (typeof s.r.createdAt === 'number' ? s.r.createdAt : Date.now());
  out.deviceId = parseHlc(s.h)?.dev || local?.deviceId;
  if (s.img) out.imgSha = s.img;
  return out;
}
