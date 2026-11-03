// v0.31 同步引擎（0613 文件型同步协议 + 0615 同步前快照 + 0628 派生数据不进同步）。
//
// 云端文件夹（全是密文，只有 glean-sync.json 是明文的参数和被包起来的数据钥）：
//   glean-sync.json            加密参数（Argon2id 盐与参数）+ 口令 / 恢复码各包一份的数据钥
//   ops/<设备>/<序号>.op        每台设备只追加自己的改动包（这一段时间里改过的整行 + 墓碑），序号 8 位递增，永不覆盖
//   snap/<设备>.snap           每台设备隔一段写一份「我现在的全库 + 我已经合并到每台设备的第几包」，新设备先读它再补后面的包
//   img/<名字>                 原图，内容寻址（HMAC(数据钥, sha256)），同一张图只传一次
// 一次同步 = 先推（本机 HLC 比上次推过的大的行）→ 再拉（别的设备比我看过的序号新的包，逐包按字段合并）。
// 拉到东西、要写本机库之前先拍一张操作快照（「同步前」），设置里一键回到同步前。
import { db as defaultDb, markRawTransaction, SYNC_TABLES, type LinganDB, type SyncTable } from '../db';
import { getDeviceId } from '../device';
import { HLC_ZERO, maxHlc, parseHlc, recv, tick } from '../hlc';
import { sha256Hex } from '../sha256';
import type { Item } from '../types';
import { fromSRow, mergeS, sameS, SKIP, toSRow, type Purge, type SRow } from './merge';
import type { SyncKey } from './crypto';
import type { SyncTransport } from './transport';

export const OP_ROWS = 400;
export const SNAP_EVERY = 40;
const PURGED_KEY = 'glean.sync.purged';

export interface SyncState {
  /** 我下一个包的序号（null = 还没核对过云端） */
  seq: number | null;
  /** 推过的最大 HLC */
  pushed: string;
  /** 每台别的设备我合并到了第几包 */
  seen: Record<string, number>;
  /** 上次写全库快照时我的序号 */
  snapSeq?: number;
  /** 最近一次「同步前」快照与那次拉进来改到的行（回到同步前用） */
  lastSnapId?: number | null;
  touched?: Array<{ t: SyncTable; u: string }>;
  /** 回到同步前生成的墓碑（同步新加的行放进回收站），下次推出去 */
  tomb?: SRow[];
  /** 已经传过的原图名字 */
  imgs?: string[];
}
export const freshState = (): SyncState => ({ seq: null, pushed: HLC_ZERO, seen: {} });

export interface SyncStats {
  pushedRows: number;
  pushedOps: number;
  pulledOps: number;
  pulledRows: number;
  changed: number;
  imagesUp: number;
  imagesDown: number;
  purged: number;
  snapId: number | null;
  fromSnapshot: boolean;
}
export interface SyncCtx {
  d?: LinganDB;
  tr: SyncTransport;
  key: SyncKey;
  state: SyncState;
  dev?: string;
  /** 拉到东西、写库之前拍快照（返回快照 id）；测试里可不传 */
  snapshot?: (label: string) => Promise<number | null>;
  onProgress?: (msg: string) => void;
  now?: number;
}

interface OpFile {
  v: 1;
  dev: string;
  seq: number;
  at: number;
  rows: SRow[];
  purged: Purge[];
}
interface SnapFile {
  v: 1;
  dev: string;
  at: number;
  /** 这份全库已经包含了每台设备到第几包（含我自己） */
  vec: Record<string, number>;
  rows: SRow[];
  purged: Purge[];
}

const opPath = (dev: string, seq: number) => `ops/${dev}/${String(seq).padStart(8, '0')}.op`;
const seqOf = (p: string) => Number((/(\d{8})\.op$/.exec(p) || [])[1] || 0);
const devOf = (h: string) => parseHlc(h)?.dev || '';

export function readPurged(): Purge[] {
  try {
    const v = JSON.parse(localStorage.getItem(PURGED_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

type AnyRow = Record<string, unknown> & { id?: number; uid?: string; hlc?: string; hc?: string; fh?: Record<string, string>; key?: string };

/** 本机在 since 之后（我自己）改过的行，换成同步行 */
async function localChanges(d: LinganDB, since: string, dev: string): Promise<SRow[]> {
  const out: SRow[] = [];
  const idToUid = new Map<number, string>();
  for (const t of SYNC_TABLES) {
    const rows = (await d.table(t).where('hlc').above(since).toArray()) as AnyRow[];
    for (const r of rows) {
      if ((dev && devOf(r.hlc || '') !== dev) || !r.uid) continue;
      if (t === 'items' && typeof r.id === 'number') idToUid.set(r.id, r.uid);
      if (t === 'developments') {
        const need = [...((r.itemIds as number[]) || []), ...(typeof r.anchorId === 'number' ? [r.anchorId as number] : [])].filter((x) => typeof x === 'number' && x >= 0 && !idToUid.has(x));
        if (need.length) for (const it of await d.items.bulkGet(need)) if (it?.id != null && it.uid) idToUid.set(it.id, it.uid);
      }
      out.push(toSRow(t, r, (id) => idToUid.get(id) ?? null));
    }
  }
  return out;
}

/** 全库（含回收站）换成同步行：写全库快照用 */
async function allRows(d: LinganDB): Promise<SRow[]> {
  const out: SRow[] = [];
  const idToUid = new Map<number, string>();
  await d.items.each((it) => void (it.id != null && it.uid && idToUid.set(it.id, it.uid)));
  for (const t of SYNC_TABLES) {
    const rows = (await d.table(t).toArray()) as AnyRow[];
    for (const r of rows) if (r.uid) out.push(toSRow(t, r, (id) => idToUid.get(id) ?? null));
  }
  // 原图名字带上（新设备从快照起步时也要下图）
  return out;
}

async function sealImage(key: SyncKey, blob: Blob, path: string): Promise<Uint8Array> {
  const type = new TextEncoder().encode(blob.type || '');
  const body = new Uint8Array(await blob.arrayBuffer());
  const buf = new Uint8Array(2 + type.length + body.length);
  buf[0] = type.length >> 8;
  buf[1] = type.length & 255;
  buf.set(type, 2);
  buf.set(body, 2 + type.length);
  return key.seal(buf, path);
}
async function openImage(key: SyncKey, box: Uint8Array, path: string): Promise<Blob> {
  const buf = await key.open(box, path);
  const n = (buf[0] << 8) | buf[1];
  const type = new TextDecoder().decode(buf.subarray(2, 2 + n));
  return new Blob([buf.slice(2 + n)], { type });
}

/** 给要推的穗算原图名字、没传过的传上去 */
async function attachImages(c: Required<Pick<SyncCtx, 'd' | 'tr' | 'key'>> & { state: SyncState }, rows: SRow[]): Promise<number> {
  const { d, tr, key, state } = c;
  const known = new Set(state.imgs || []);
  let up = 0;
  for (const s of rows) {
    if (s.t !== 'items') continue;
    const it = await d.items.where('uid').equals(s.u).first();
    if (!it?.hasImage || it.id == null) continue;
    const im = await d.images.get(it.id);
    if (!im?.blob) continue;
    let sha = it.imgSha;
    if (!sha) {
      sha = await sha256Hex(new Uint8Array(await im.blob.arrayBuffer()));
      await d.transaction('rw', d.items, async () => {
        markRawTransaction(true);
        await d.items.update(it.id!, { imgSha: sha });
      });
    }
    const name = await key.blobName(sha);
    s.img = name;
    if (known.has(name)) continue;
    const path = `img/${name}`;
    await tr.put(path, await sealImage(key, im.blob, path), { ifNone: true });
    known.add(name);
    up++;
  }
  state.imgs = [...known].slice(-20000);
  return up;
}

/** 0613 推：本机改动打成一个或几个只追加的包 */
export async function push(ctx: SyncCtx, stats: SyncStats): Promise<void> {
  const d = ctx.d || defaultDb;
  const dev = ctx.dev || getDeviceId();
  const st = ctx.state;
  if (st.seq == null) {
    // 第一次（或本机状态丢了）：接着云端我自己那一列的最大序号往后写，绝不覆盖
    const mine = await ctx.tr.list(`ops/${dev}`);
    st.seq = Math.max(0, ...mine.map((e) => seqOf(e.path))) + 1;
  }
  // 第一次推：全库都推（迁移来的旧行 deviceId 可能是别的设备的）；之后只推本机盖的章
  const rows = [...(await localChanges(d, st.pushed, st.pushed === HLC_ZERO ? '' : dev)), ...(st.tomb || [])];
  const purged = readPurged().filter((p) => p.h > st.pushed);
  if (!rows.length && !purged.length) return;
  ctx.onProgress?.(`推送 ${rows.length} 行`);
  stats.imagesUp += await attachImages({ d, tr: ctx.tr, key: ctx.key, state: st }, rows);
  let top = st.pushed;
  for (const r of rows) top = maxHlc(top, r.h);
  for (const p of purged) top = maxHlc(top, p.h);
  for (let i = 0; i < Math.max(rows.length, 1); i += OP_ROWS) {
    const op: OpFile = { v: 1, dev, seq: st.seq!, at: ctx.now ?? Date.now(), rows: rows.slice(i, i + OP_ROWS), purged: i === 0 ? purged : [] };
    for (;;) {
      const path = opPath(dev, st.seq!);
      op.seq = st.seq!;
      const ok = await ctx.tr.put(path, await ctx.key.sealJson(op, path), { ifNone: true });
      st.seq!++;
      if (ok) break;
    }
    stats.pushedOps++;
  }
  stats.pushedRows += rows.length;
  st.pushed = top;
  st.tomb = [];
}

/** 把一批同步行按字段合并进本机库（一个事务，不盖本机章） */
export async function applyRows(d: LinganDB, rows: SRow[], purged: Purge[], touched?: Map<string, { t: SyncTable; u: string }>): Promise<{ changed: number; purged: number; needImages: Array<{ id: number; img: string }> }> {
  let changed = 0;
  let nPurged = 0;
  const needImages: Array<{ id: number; img: string }> = [];
  const gone = new Set(purged.map((p) => `${p.t}:${p.u}`));
  const order = (t: SyncTable) => SYNC_TABLES.indexOf(t);
  const sorted = [...rows].sort((a, b) => order(a.t) - order(b.t));
  await d.transaction('rw', [d.items, d.developments, d.cliches, d.rejects, d.works, d.images], async () => {
    markRawTransaction(true);
    const uidCache = new Map<string, number>();
    const uidToId = async (u: string) => {
      if (uidCache.has(u)) return uidCache.get(u);
      const it = await d.items.where('uid').equals(u).first();
      if (it?.id != null) uidCache.set(u, it.id);
      return it?.id;
    };
    for (const s of sorted) {
      if (gone.has(`${s.t}:${s.u}`)) continue;
      const tb = d.table(s.t);
      let local = (await tb.where('uid').equals(s.u).first()) as AnyRow | undefined;
      // 套路墙按 key 唯一：两台设备各自长出同一条套路 → 合成一行，uid 取小的那个（两边结果一样）
      if (!local && s.t === 'cliches' && typeof s.r.key === 'string') {
        const byKey = (await tb.where('key').equals(s.r.key).first()) as AnyRow | undefined;
        if (byKey) {
          if (String(byKey.uid) < s.u) s.u = String(byKey.uid);
          local = byKey;
        }
      }
      if (!local && s.p) continue; // 墓碑：本机本来就没有这行
      let refs: Map<string, number> | undefined;
      if (s.t === 'developments') {
        refs = new Map();
        const us = [...((s.r.itemIds as unknown[]) || []), s.r.anchorId].filter((x): x is string => typeof x === 'string');
        for (const u of us) {
          const id = await uidToId(u);
          if (id != null) refs.set(u, id);
        }
      }
      const idToUidLocal = new Map<number, string>();
      if (local && s.t === 'developments') {
        const ids = [...((local.itemIds as number[]) || []), ...(typeof local.anchorId === 'number' ? [local.anchorId as number] : [])];
        for (const it of await d.items.bulkGet(ids.filter((x) => x >= 0))) if (it?.id != null && it.uid) idToUidLocal.set(it.id, it.uid);
      }
      const ls = local ? toSRow(s.t, local, (id) => idToUidLocal.get(id) ?? null) : null;
      if (ls && s.t === 'cliches') ls.u = s.u;
      const m = ls ? mergeS(ls, s) : s;
      if (ls && sameS(m, ls) && local!.uid === m.u) {
        if (s.t === 'items' && m.img && local!.imgSha !== m.img && local!.id != null && !(await d.images.get(local!.id as number))) needImages.push({ id: local!.id as number, img: m.img });
        continue;
      }
      const row = fromSRow(m, local, (u) => refs?.get(u));
      if (s.t === 'items') {
        const it = row as unknown as Item;
        if (m.img && local?.imgSha !== m.img) {
          // 原图换了 / 新来的：图稍后下，先把缩略图状态清掉
          delete it.thumb;
          it.hasImage = undefined;
        }
      }
      let id: number;
      if (local?.id != null) {
        row.id = local.id;
        await tb.put(row);
        id = local.id;
      } else {
        delete row.id;
        id = (await tb.add(row)) as number;
      }
      if (s.t === 'items') uidCache.set(m.u, id);
      if (s.t === 'items' && m.img && (local?.imgSha !== m.img || !(await d.images.get(id)))) needImages.push({ id, img: m.img });
      touched?.set(`${s.t}:${m.u}`, { t: s.t, u: m.u });
      changed++;
    }
    for (const p of purged) {
      const tb = d.table(p.t);
      const row = (await tb.where('uid').equals(p.u).first()) as AnyRow | undefined;
      if (!row?.id) continue;
      await tb.delete(row.id);
      if (p.t === 'items') await d.images.delete(row.id);
      nPurged++;
    }
  });
  return { changed, purged: nPurged, needImages };
}

async function fetchImages(d: LinganDB, tr: SyncTransport, key: SyncKey, need: Array<{ id: number; img: string }>): Promise<number> {
  let n = 0;
  for (const { id, img } of need) {
    const path = `img/${img}`;
    const box = await tr.get(path).catch(() => null);
    if (!box) continue;
    let blob: Blob;
    try {
      blob = await openImage(key, box, path);
    } catch {
      continue;
    }
    await d.transaction('rw', d.items, d.images, async () => {
      markRawTransaction(true);
      await d.images.put({ itemId: id, blob });
      await d.items.update(id, { hasImage: 1, thumbTodo: 1, imgSha: img });
    });
    n++;
  }
  return n;
}

/** 0613 拉：别的设备比我看过的新的包；第一次先从最全的那份全库快照起步 */
export async function pull(ctx: SyncCtx, stats: SyncStats): Promise<void> {
  const d = ctx.d || defaultDb;
  const dev = ctx.dev || getDeviceId();
  const st = ctx.state;
  const plan: Array<{ dev: string; seq: number; path: string }> = [];
  let start: SnapFile | null = null;
  const devs = (await ctx.tr.list('ops')).filter((e) => e.dir).map((e) => e.path.split('/').pop()!);
  // 新设备 / 本机清空过（看过的进度归零）：连自己那一列也拉（合并是幂等的，多拉无害）
  const fresh = !Object.keys(st.seen).length;
  if (fresh) {
    // 挑覆盖最多的全库快照
    let best: { path: string; score: number } | null = null;
    for (const e of await ctx.tr.list('snap')) {
      if (e.dir || !e.path.endsWith('.snap')) continue;
      const box = await ctx.tr.get(e.path);
      if (!box) continue;
      try {
        const sf = await ctx.key.openJson<SnapFile>(box, e.path);
        const score = Object.values(sf.vec).reduce((a, b) => a + b, 0);
        if (!best || score > best.score) {
          best = { path: e.path, score };
          start = sf;
        }
      } catch {
        /* 坏的跳过 */
      }
    }
  }
  const base: Record<string, number> = { ...st.seen };
  if (start) for (const [k, v] of Object.entries(start.vec)) base[k] = Math.max(base[k] || 0, v);
  for (const other of devs) {
    if (other === dev && !fresh) continue;
    const files = await ctx.tr.list(`ops/${other}`);
    for (const f of files) {
      const seq = seqOf(f.path);
      if (seq > (base[other] || 0)) plan.push({ dev: other, seq, path: f.path });
    }
  }
  plan.sort((a, b) => (a.dev === b.dev ? a.seq - b.seq : a.dev < b.dev ? -1 : 1));
  if (!plan.length && !start) return;
  stats.snapId = ctx.snapshot ? await ctx.snapshot('同步前') : null;
  const touched = new Map<string, { t: SyncTable; u: string }>();
  const need: Array<{ id: number; img: string }> = [];
  const take = async (rows: SRow[], purged: Purge[]) => {
    for (const r of rows) recv(r.h);
    const res = await applyRows(d, rows, purged, touched);
    stats.pulledRows += rows.length;
    stats.changed += res.changed;
    stats.purged += res.purged;
    need.push(...res.needImages);
  };
  if (start) {
    ctx.onProgress?.('从全库快照起步');
    await take(start.rows, start.purged || []);
    stats.fromSnapshot = true;
    for (const [k, v] of Object.entries(start.vec)) if (k !== dev) st.seen[k] = Math.max(st.seen[k] || 0, v);
    // 起步快照算「看过」：哪怕它只有我自己，下次也不再当新设备
    if (!Object.keys(st.seen).length) st.seen[dev] = start.vec[dev] || 0;
  }
  for (const p of plan) {
    const box = await ctx.tr.get(p.path);
    if (!box) continue;
    let op: OpFile;
    try {
      op = await ctx.key.openJson<OpFile>(box, p.path);
    } catch {
      throw new Error(`同步包解不开：${p.path}（数据钥不对或文件损坏），这一次什么都没再往下写`);
    }
    ctx.onProgress?.(`合并 ${p.dev.slice(-4)} 的第 ${p.seq} 包`);
    await take(op.rows || [], op.purged || []);
    stats.pulledOps++;
    st.seen[p.dev] = Math.max(st.seen[p.dev] || 0, p.seq);
    void dev;
  }
  if (need.length) {
    ctx.onProgress?.(`下载 ${need.length} 张原图`);
    stats.imagesDown += await fetchImages(d, ctx.tr, ctx.key, need);
  }
  st.lastSnapId = stats.snapId;
  st.touched = [...touched.values()].slice(0, 20000);
}

/** 隔一段写一份全库快照（新设备起步用） */
export async function maybeSnapshot(ctx: SyncCtx, force = false): Promise<boolean> {
  const d = ctx.d || defaultDb;
  const dev = ctx.dev || getDeviceId();
  const st = ctx.state;
  if (st.seq == null) return false;
  const mineDone = st.seq - 1;
  if (!force && mineDone - (st.snapSeq || 0) < SNAP_EVERY && st.snapSeq != null) return false;
  if (mineDone <= 0 && !Object.keys(st.seen).length) return false;
  const rows = await allRows(d);
  // 有图的穗带上名字
  for (const s of rows) {
    if (s.t !== 'items') continue;
    const it = await d.items.where('uid').equals(s.u).first();
    if (it?.imgSha) s.img = await ctx.key.blobName(it.imgSha);
  }
  const path = `snap/${dev}.snap`;
  const sf: SnapFile = { v: 1, dev, at: ctx.now ?? Date.now(), vec: { ...st.seen, [dev]: mineDone }, rows, purged: readPurged() };
  await ctx.tr.put(path, await ctx.key.sealJson(sf, path));
  st.snapSeq = mineDone;
  return true;
}

export function emptyStats(): SyncStats {
  return { pushedRows: 0, pushedOps: 0, pulledOps: 0, pulledRows: 0, changed: 0, imagesUp: 0, imagesDown: 0, purged: 0, snapId: null, fromSnapshot: false };
}

/** 一次完整同步：推 → 拉 → 需要时写全库快照。状态（ctx.state）就地更新 */
export async function syncOnce(ctx: SyncCtx): Promise<SyncStats> {
  const stats = emptyStats();
  await push(ctx, stats);
  await pull(ctx, stats);
  await maybeSnapshot(ctx);
  return stats;
}

/**
 * 0615 回到同步前：本机库回到「同步前」那张快照；为了别的设备也跟着回去（而不是下次又被同步回来），
 * 被那次同步改过、快照里有的行重新盖本机章（这次「回去」成为最新的修改），同步新加进来的行生成墓碑、放进回收站。
 */
export async function undoLastSync(ctx: SyncCtx, restore: (id: number) => Promise<void>): Promise<{ restamped: number; trashed: number }> {
  const d = ctx.d || defaultDb;
  const st = ctx.state;
  if (st.lastSnapId == null) throw new Error('没有可以回去的同步');
  const touched = st.touched || [];
  // 回去之前记下这些行现在（同步后）有哪些字段：回去后这些字段都要盖新章，多出来的字段要清掉
  const after = new Map<string, Set<string>>();
  for (const x of touched) {
    const r = (await d.table(x.t).where('uid').equals(x.u).first()) as AnyRow | undefined;
    if (r) after.set(`${x.t}:${x.u}`, new Set([...Object.keys(r).filter((k) => !SKIP[x.t].has(k)), ...Object.keys(r.fh || {})]));
  }
  await restore(st.lastSnapId);
  let restamped = 0;
  const tomb: SRow[] = [];
  const now = ctx.now ?? Date.now();
  await d.transaction('rw', [d.items, d.developments, d.cliches, d.rejects, d.works], async () => {
    markRawTransaction(true);
    for (const x of touched) {
      const tb = d.table(x.t);
      const r = (await tb.where('uid').equals(x.u).first()) as AnyRow | undefined;
      const h = tick();
      if (r?.id != null) {
        const keys = new Set([...(after.get(`${x.t}:${x.u}`) || []), ...Object.keys(r).filter((k) => !SKIP[x.t].has(k))]);
        const fh: Record<string, string> = { ...(r.fh || {}) };
        for (const k of keys) fh[k] = h;
        await tb.update(r.id, { hlc: h, fh, updatedAt: now, deviceId: ctx.dev || getDeviceId() });
        restamped++;
      } else if (x.t !== 'cliches') tomb.push({ t: x.t, u: x.u, r: { deletedAt: now }, fh: { deletedAt: h }, hc: HLC_ZERO, h, p: 1 });
    }
  });
  st.tomb = [...(st.tomb || []), ...tomb];
  st.lastSnapId = null;
  st.touched = [];
  return { restamped, trashed: tomb.length };
}
