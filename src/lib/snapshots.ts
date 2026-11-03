// v0.26 数据保险（0621 0624）：大操作前的全库快照 + Dexie 升级前的原始库副本。
//
// 快照存在另一个 IndexedDB（glean-snap），和主库分开：主库升级 / 损坏 / 被清空都不影响它。
// - 操作快照（kind=op）：导入、清示例、清空、批量删、清空回收站 / 彻底删之前拍一张。存穗 / 新枝 / 套路墙 / 不要的理由的整行
//   （含缩略图 Blob，结构化克隆，不转 JSON）；原图不复制（批量删只是进回收站，原图还在主库）——只有会真的删掉原图的
//   操作（彻底删、清空回收站）才把那几张原图一起放进快照。保留最近 10 张。
// - 升级前副本（kind=pre-upgrade）：App 发现库版本比代码旧、即将迁移时，先用原生 IndexedDB 按旧版本打开、原样读出
//   items / developments / cliches / rejects / meta（不含原图表与派生的搜索索引）存一份。保留最近 3 份。迁移失败时
//   IndexedDB 会整体回滚（库仍是旧版本），兜底页可以把这份副本存成文件，用「导入备份」恢复。
import Dexie, { type Table } from 'dexie';
import { markRawTransaction, type LinganDB } from './db';
import type { Development, Item, Reject, StoredImage } from './types';
import type { Cliche } from './wall';

export type SnapKind = 'op' | 'pre-upgrade';
export interface SnapRow {
  id?: number;
  kind: SnapKind;
  /** 给人看的：「清空回收站前」「导入（替换）前」 */
  label: string;
  at: number;
  /** IndexedDB 版本 / 10（= Dexie version） */
  schema: number;
  appVersion?: string;
  counts: { items: number; developments: number; cliches: number; images: number };
  items: Item[];
  developments: Development[];
  cliches: Cliche[];
  rejects: Reject[];
  images: StoredImage[];
  meta?: Array<{ k: string; v: unknown }>;
  /** 升级前副本里没复制的内联大原图条数（v0.12 以前的旧库） */
  omittedImages?: number;
}
export type SnapInfo = Omit<SnapRow, 'items' | 'developments' | 'cliches' | 'rejects' | 'images' | 'meta'>;

export const SNAP_DB = 'glean-snap';
export const KEEP: Record<SnapKind, number> = { op: 10, 'pre-upgrade': 3 };

class SnapDB extends Dexie {
  snaps!: Table<SnapRow, number>;
  constructor(name = SNAP_DB) {
    super(name);
    this.version(1).stores({ snaps: '++id, kind, at' });
  }
}
let shared: SnapDB | null = null;
export function snapDb(name = SNAP_DB): SnapDB {
  if (name !== SNAP_DB) return new SnapDB(name);
  if (!shared) shared = new SnapDB();
  return shared;
}

function info(r: SnapRow): SnapInfo {
  const { items: _i, developments: _d, cliches: _c, rejects: _r, images: _im, meta: _m, ...rest } = r;
  void _i, void _d, void _c, void _r, void _im, void _m;
  return rest;
}

async function prune(s: SnapDB, kind: SnapKind) {
  const ids = (await s.snaps.where('kind').equals(kind).primaryKeys()) as number[];
  // 自增 id 即先后顺序
  ids.sort((a, b) => a - b);
  const drop = ids.slice(0, Math.max(0, ids.length - KEEP[kind]));
  if (drop.length) await s.snaps.bulkDelete(drop);
}

/** 拍一张操作快照。imagesOf = 这次操作会彻底删掉原图的穗 id（把这几张原图也存进来） */
export async function takeSnapshot(label: string, d: LinganDB, opts: { imagesOf?: number[]; now?: number; appVersion?: string; s?: SnapDB } = {}): Promise<number> {
  const s = opts.s || snapDb();
  const [items, developments, cliches, rejects] = await d.transaction('r', [d.items, d.developments, d.cliches, d.rejects], () => Promise.all([d.items.toArray(), d.developments.toArray(), d.cliches.toArray(), d.rejects.toArray()]));
  const imagesOf = [...new Set(opts.imagesOf || [])];
  const images = imagesOf.length ? ((await d.images.bulkGet(imagesOf)).filter(Boolean) as StoredImage[]) : [];
  const row: SnapRow = {
    kind: 'op',
    label,
    at: opts.now ?? Date.now(),
    schema: Math.round(d.verno),
    appVersion: opts.appVersion,
    counts: { items: items.filter((x) => !x.deletedAt).length, developments: developments.filter((x) => !x.deletedAt).length, cliches: cliches.length, images: images.length },
    items,
    developments,
    cliches,
    rejects,
    images,
  };
  const id = await s.snaps.add(row);
  await prune(s, 'op');
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('glean:snap'));
  return id;
}

/** 写入失败多半是空间不够：这种时候快照拍不下也不该拦着用户去删东西腾地方 */
export function isQuotaError(e: unknown): boolean {
  const n = (e as { name?: string; inner?: { name?: string } } | null)?.name || '';
  const inner = (e as { inner?: { name?: string } } | null)?.inner?.name || '';
  return /Quota/i.test(n) || /Quota/i.test(inner) || /quota/i.test(String((e as Error)?.message || ''));
}

/**
 * 0621 统一包裹大操作：先拍快照再动手。快照失败：required=true（导入、清空这类）就不动手、把错误抛出去；
 * required=false（清空回收站这种腾地方的操作）照做，返回 snapId=null。
 */
export async function withSnapshot<T>(label: string, d: LinganDB, fn: () => Promise<T>, opts: { imagesOf?: number[]; required?: boolean; appVersion?: string; s?: SnapDB } = {}): Promise<{ result: T; snapId: number | null }> {
  let snapId: number | null = null;
  try {
    snapId = await takeSnapshot(label, d, opts);
  } catch (e) {
    if (opts.required !== false) throw new Error(`操作前快照没拍成（${(e as Error)?.message || e}），什么都没改`);
  }
  const result = await fn();
  return { result, snapId };
}

export async function listSnapshots(s: SnapDB = snapDb()): Promise<SnapInfo[]> {
  const out: SnapInfo[] = [];
  // 逐行只取摘要（不把每张快照的整库行都留在内存里）
  await s.snaps.orderBy('at').reverse().each((r) => void out.push(info(r)));
  return out;
}
export async function getSnapshot(id: number, s: SnapDB = snapDb()): Promise<SnapRow | undefined> {
  return s.snaps.get(id);
}
export async function deleteSnapshot(id: number, s: SnapDB = snapDb()) {
  await s.snaps.delete(id);
}

/**
 * 回到某张操作快照拍下的那一刻：穗 / 新枝 / 套路墙 / 不要的理由整表换成快照里的（同样的本机 id，新枝来源不断），
 * 快照之后新收的穗不在快照里——为了能反悔，先给「现在」再拍一张（「恢复快照前」）。
 * 原图：快照里带的放回去；快照里没有、主库里也已经没有行的原图删掉（避免孤儿）。
 */
export async function restoreSnapshot(id: number, d: LinganDB, opts: { s?: SnapDB; appVersion?: string } = {}): Promise<{ items: number; developments: number; undoId: number }> {
  const s = opts.s || snapDb();
  const snap = await s.snaps.get(id);
  if (!snap) throw new Error('快照不在了');
  if (snap.kind !== 'op') throw new Error('升级前副本请存成文件后用「导入备份」恢复');
  if (snap.schema > Math.round(d.verno)) throw new Error('这张快照来自更新的版本，当前版本恢复不了');
  const undoId = await takeSnapshot(`恢复「${snap.label}」前`, d, { s, appVersion: opts.appVersion });
  const keep = new Set(snap.items.map((x) => x.id!));
  await d.transaction('rw', [d.items, d.developments, d.cliches, d.rejects, d.images, d.daily], async () => {
    markRawTransaction();
    await d.items.clear();
    await d.developments.clear();
    await d.cliches.clear();
    await d.rejects.clear();
    if (snap.items.length) await d.items.bulkPut(snap.items);
    if (snap.developments.length) await d.developments.bulkPut(snap.developments);
    if (snap.cliches.length) await d.cliches.bulkPut(snap.cliches);
    if (snap.rejects.length) await d.rejects.bulkPut(snap.rejects);
    const imgKeys = (await d.images.toCollection().primaryKeys()) as number[];
    const orphan = imgKeys.filter((k) => !keep.has(k));
    if (orphan.length) await d.images.bulkDelete(orphan);
    if (snap.images.length) await d.images.bulkPut(snap.images);
    await d.daily.clear();
  });
  return { items: snap.counts.items, developments: snap.counts.developments, undoId };
}

// ───────── 0624 升级前副本 ─────────

function idbReq<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const RAW_STORES = ['items', 'developments', 'cliches', 'rejects', 'meta'] as const;

/** 用原生 IndexedDB 按现有版本打开（不触发升级），原样读出各表存进快照库 */
export async function dumpBeforeUpgrade(name: string, fromIdbVersion: number, toSchema: number, opts: { s?: SnapDB; appVersion?: string; now?: number } = {}): Promise<number | null> {
  const s = opts.s || snapDb();
  const idb = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(name, fromIdbVersion);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('数据库被占用'));
    // 版本号对不上（别的标签页刚升级过）：不在这里建库
    r.onupgradeneeded = () => {
      r.transaction?.abort();
    };
  });
  try {
    const got: Record<string, unknown[]> = {};
    for (const st of RAW_STORES) {
      got[st] = idb.objectStoreNames.contains(st) ? await idbReq(idb.transaction(st).objectStore(st).getAll()) : [];
    }
    // 只存「丢了就找不回」的：缩略图、向量是派生的（新版会重建），不进副本；v0.12 以前行里内联的大原图（data URL）
    // 不复制——迁移失败时 IndexedDB 整体回滚、原图还在旧库里，而把上百 MB 字符串再写一遍会让第一次打开卡住
    let omitted = 0;
    const items = (got.items as Item[]).map((it) => {
      const { thumb: _t, embedding: _e, ...rest } = it as Item & Record<string, unknown>;
      void _t, void _e;
      if (typeof rest.image === 'string' && rest.image.length > 200_000) {
        delete rest.image;
        omitted++;
      }
      return rest as Item;
    });
    if (!items.length && !got.developments.length) return null; // 空库没什么可保的
    const row: SnapRow = {
      kind: 'pre-upgrade',
      label: `升级前（库版本 ${Math.round(fromIdbVersion / 10)} → ${toSchema}）`,
      at: opts.now ?? Date.now(),
      schema: Math.round(fromIdbVersion / 10),
      appVersion: opts.appVersion,
      counts: { items: items.length, developments: got.developments.length, cliches: got.cliches.length, images: 0 },
      omittedImages: omitted || undefined,
      items,
      developments: got.developments as Development[],
      cliches: got.cliches as Cliche[],
      rejects: got.rejects as Reject[],
      images: [],
      meta: got.meta as Array<{ k: string; v: unknown }>,
    };
    const id = await s.snaps.add(row);
    await prune(s, 'pre-upgrade');
    return id;
  } finally {
    idb.close();
  }
}

/**
 * 快照 → 「导入备份」认得的 JSON（和 v0.20 兜底页的原始导出同一种格式：app=lingan + raw=true）。
 * 缩略图、向量这类本机派生字段不带；原图不在副本里（迁移不动原图表，原图仍在本机库里）。
 */
export function snapshotToBackupJson(snap: SnapRow): string {
  const strip = (it: Item) => {
    const { thumb: _t, thumbW: _w, thumbH: _h, thumbTodo: _td, thumbFail: _f, hasImage: _hi, embedding: _e, ...rest } = it;
    void _t, void _w, void _h, void _td, void _f, void _hi, void _e;
    if (typeof rest.image === 'string' && !rest.image.startsWith('data:')) delete rest.image;
    return rest;
  };
  return JSON.stringify({
    app: 'lingan',
    version: 1,
    raw: true,
    snapshot: { label: snap.label, at: snap.at, schema: snap.schema, appVersion: snap.appVersion || '' },
    exportedAt: snap.at,
    items: snap.items.map(strip),
    developments: snap.developments,
    cliches: snap.cliches.map(({ id: _id, ...c }) => (void _id, c)),
  });
}

export function snapFileName(snap: Pick<SnapRow, 'kind' | 'at' | 'schema'>): string {
  const d = new Date(snap.at);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return snap.kind === 'pre-upgrade' ? `glean-pre-upgrade-v${snap.schema}-${stamp}.json` : `glean-snapshot-${stamp}.json`;
}
