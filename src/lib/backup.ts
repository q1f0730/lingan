import { withBundles } from './bundles';
// v0.21 数据地基：.glean 备份（流式 ZIP）+ 按 uid 去重的导入（合并 / 替换 / 只补缺，先预览条数）。
//
// .glean = ZIP（只存储不压缩）：
//   data.jsonl     一行一条：{"t":"item",…} / {"t":"dev",…,"itemUids":[…]} / {"t":"cliche",…} / {"t":"reject",…}（v0.24 不要的理由）/ {"t":"work",…}（v0.29 作品，引用本来就是 uid）
//   images/<sha256>.<ext>  原图原样二进制（按内容哈希命名，同一张图只存一份）
//   manifest.json  格式、版本、导出时间、设备、条数，以及每个文件的 sha256 与字节数
// 导出时一张一张读原图、边算哈希边写，data.jsonl 边生成边写（数据描述符），内存峰值≈一张原图，和库多大无关。
// 导入时只读 ZIP 目录与 data.jsonl，原图按需切片、逐张核对哈希；坏一张图只丢那一张，坏一行只丢那一行。
// 旧版 .json 备份（v0.1–v0.20，原图是 data URL）照样能导入，没有 uid 的按「记录时间 + 标题 + 内容哈希」认重复。
import { alive, clichesFromDevs, db as defaultDb, ensureUids, markRawTransaction, normalizeTags, notifyNewImages, type LinganDB } from './db';
import { getDeviceId } from './device';
import { graftStatsFromDevs } from './modes';
import { migrateDevelopment } from './provenance';
import { dataUrlToBlob, detachInlineImage, isDataUrl } from './imagestore';
import { Sha256, sha256Hex } from './sha256';
import type { Development, Item, Reject, Work } from './types';
import { isUlid, ulid } from './ulid';
import { cleanText, clicheKey, validKey, type Cliche } from './wall';
import { readZipBlob, zipEntryBlob, ZipWriter, type ByteSink } from './zipstream';

export const GLEAN_FORMAT = 'glean';
export const GLEAN_FORMAT_VERSION = 1;
export const GLEAN_EXT = 'glean';
export const GLEAN_MIME = 'application/zip';

export interface GleanFileInfo {
  sha256: string;
  bytes: number;
  lines?: number;
  mime?: string;
}
export interface GleanManifest {
  format: 'glean';
  formatVersion: number;
  app: string;
  appVersion: string;
  /** Dexie schema 版本 */
  schema: number;
  exportedAt: number;
  deviceId: string;
  counts: { items: number; developments: number; cliches: number; images: number; trashedItems: number; trashedDevelopments: number; works?: number };
  files: Record<string, GleanFileInfo>;
}
export interface ExportStats {
  items: number;
  developments: number;
  cliches: number;
  images: number;
  trashed: number;
  bytes: number;
}

const enc = new TextEncoder();
const LOCAL_ONLY = ['thumb', 'thumbW', 'thumbH', 'thumbTodo', 'thumbFail', 'hasImage', 'image'] as const;

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/heic': 'heic', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };
const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', bmp: 'image/bmp', svg: 'image/svg+xml', bin: 'application/octet-stream' };
/** 没写 type 的 Blob：看文件头 */
function sniffMime(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return 'application/octet-stream';
}
const extOf = (mime: string) => MIME_EXT[(mime || '').toLowerCase().split(';')[0].trim()] || 'bin';

export function gleanName(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `glean-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${GLEAN_EXT}`;
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * 导出 .glean 到 sink（流式）。含回收站里的（带 deletedAt，导入到别处也还在回收站，删除能跟着走）。
 * onProgress(done, total) 按穗计。
 */
export async function exportGlean(
  sink: ByteSink,
  d: LinganDB = defaultDb,
  opts: { now?: number; appVersion?: string; onProgress?: (done: number, total: number) => void; batch?: number } = {},
): Promise<ExportStats> {
  const now = opts.now ?? Date.now();
  const batch = opts.batch ?? 100;
  await ensureUids(d);
  const zw = new ZipWriter(sink, now);
  const files: Record<string, GleanFileInfo> = {};
  const ids = (await d.items.toCollection().primaryKeys()) as number[];
  const total = ids.length;

  // 1) 原图：一张一张读，算 sha256 + CRC，写出（交给 sink 的是库里的 Blob 本身）
  const imgKeys = new Set((await d.images.toCollection().primaryKeys()) as number[]);
  const refOf = new Map<number, string>();
  let images = 0;
  for (let k = 0; k < ids.length; k += batch) {
    const slice = ids.slice(k, k + batch);
    const rows = await d.items.bulkGet(slice);
    for (let j = 0; j < slice.length; j++) {
      const id = slice[j];
      const row = rows[j];
      if (!row) continue;
      let blob: Blob | null = null;
      if (imgKeys.has(id)) blob = (await d.images.get(id))?.blob || null;
      if (!blob && isDataUrl(row.image)) {
        try {
          blob = dataUrlToBlob(row.image);
        } catch {
          blob = null;
        }
      }
      if (!blob) continue;
      let bytes: Uint8Array | null = new Uint8Array(await blob.arrayBuffer());
      const sha = await sha256Hex(bytes);
      const mime = blob.type || sniffMime(bytes);
      const path = `images/${sha}.${extOf(mime)}`;
      if (!zw.has(path)) {
        await zw.addFile(path, blob, row.createdAt, bytes);
        files[path] = { sha256: sha, bytes: bytes.length, mime };
        images++;
      }
      bytes = null;
      refOf.set(id, path);
    }
    opts.onProgress?.(Math.min(total, k + batch) / 2, total);
    await nextTick();
  }

  // 2) data.jsonl：边生成边写，256KB 一块
  const ent = await zw.begin('data.jsonl', now);
  const hash = new Sha256();
  let buf: Uint8Array[] = [];
  let bufLen = 0;
  let lines = 0;
  const flush = async () => {
    if (!bufLen) return;
    const out = new Uint8Array(bufLen);
    let p = 0;
    for (const b of buf) {
      out.set(b, p);
      p += b.length;
    }
    buf = [];
    bufLen = 0;
    hash.update(out);
    await ent.write(out);
  };
  const push = async (obj: unknown) => {
    const b = enc.encode(JSON.stringify(obj) + '\n');
    buf.push(b);
    bufLen += b.length;
    lines++;
    if (bufLen >= 256 * 1024) await flush();
  };
  const uidOf = new Map<number, string>();
  let nItems = 0;
  let trashed = 0;
  for (let k = 0; k < ids.length; k += batch) {
    const rows = await d.items.bulkGet(ids.slice(k, k + batch));
    for (const r of rows) {
      if (!r || r.id == null) continue;
      const out: Record<string, unknown> = { t: 'item', ...r };
      for (const key of LOCAL_ONLY) delete out[key];
      delete out.id;
      const ref = refOf.get(r.id);
      if (ref) out.imageRef = ref;
      if (r.uid) uidOf.set(r.id, r.uid);
      if (r.deletedAt) trashed++;
      nItems++;
      await push(out);
    }
    opts.onProgress?.(total / 2 + Math.min(total, k + batch) / 2, total);
  }
  const devs = await d.developments.toArray();
  for (const dv of devs) {
    const { id: _id, ...rest } = dv;
    void _id;
    if (dv.deletedAt) trashed++;
    await push({ t: 'dev', ...rest, itemUids: (dv.itemIds || []).map((x) => uidOf.get(x) ?? null) });
  }
  const cl = await d.cliches.toArray();
  for (const c of cl) {
    const { id: _id, ...rest } = c;
    void _id;
    await push({ t: 'cliche', ...rest });
  }
  // v0.24 不要的理由（旧版读到不认识的行会跳过，不影响导入）
  for (const r of await d.rejects.toArray()) {
    const { id: _id, ...rest } = r;
    void _id;
    await push({ t: 'reject', ...rest });
  }
  // v0.29 作品（引用存的是 uid，原样写；旧版读到不认识的行会跳过）
  const works = await d.works.toArray();
  for (const w of works) {
    const { id: _id, ...rest } = w;
    void _id;
    await push({ t: 'work', ...rest });
  }
  await flush();
  const { size } = await ent.end();
  files['data.jsonl'] = { sha256: hash.hex(), bytes: size, lines };

  // 3) manifest.json
  const manifest: GleanManifest = {
    format: 'glean',
    formatVersion: GLEAN_FORMAT_VERSION,
    app: '拾穗 Glean',
    appVersion: opts.appVersion || '',
    schema: Math.round(d.verno),
    exportedAt: now,
    deviceId: getDeviceId(),
    counts: { items: nItems, developments: devs.length, cliches: cl.length, images, trashedItems: await d.items.where('deletedAt').above(0).count(), trashedDevelopments: devs.filter((x) => x.deletedAt).length, works: works.length },
    files,
  };
  await zw.addFile('manifest.json', JSON.stringify(manifest, null, 2), now);
  const bytes = await zw.finish();
  return { items: nItems, developments: devs.length, cliches: cl.length, images, trashed, bytes };
}

// ───────────────────────── 导入 ─────────────────────────

export type ImportMode = 'merge' | 'replace' | 'missing';
export const MODE_LABEL: Record<ImportMode, string> = { merge: '合并', missing: '只补缺', replace: '替换' };

export type InItem = Item & { imageRef?: string; t?: string };
export type InDev = Development & { itemUids?: Array<string | null>; t?: string };

export interface Incoming {
  format: 'glean' | 'json';
  exportedAt?: number;
  appVersion?: string;
  deviceId?: string;
  items: InItem[];
  developments: InDev[];
  /** null = 旧备份没有套路墙（按导入的新枝重建） */
  cliches: Cliche[] | null;
  /** v0.24 不要的理由（旧备份没有） */
  rejects?: Reject[];
  /** v0.29 作品（旧备份没有） */
  works?: Work[];
  /** .glean：按 ref 从包里取原图（未核对）；json：原图在行里 */
  image?: (ref: string) => Promise<Blob | null>;
  /** ref → 期望的 sha256 */
  imageSha?: Map<string, string>;
  imageCount: number;
  /** 读的时候发现的问题（坏行、哈希不对……），给人看 */
  problems: string[];
}

/** 旧 .json 备份对象（或 v0.20 兜底页的原始导出） */
export function incomingFromObject(b: unknown): Incoming {
  if (!b || typeof b !== 'object' || (b as { app?: string }).app !== 'lingan' || !Array.isArray((b as { items?: unknown }).items)) {
    throw new Error('不是拾穗（灵感暗房）的备份文件');
  }
  const bk = b as { exportedAt?: number; items: InItem[]; developments?: InDev[]; cliches?: Cliche[]; works?: Work[] };
  const items = bk.items.filter((it) => it && typeof it.title === 'string' && it.type);
  return {
    format: 'json',
    exportedAt: typeof bk.exportedAt === 'number' ? bk.exportedAt : undefined,
    items,
    developments: (bk.developments || []).filter((dv) => dv && dv.idea),
    cliches: Array.isArray(bk.cliches) ? bk.cliches : null,
    works: Array.isArray(bk.works) ? bk.works.filter(validWork) : undefined,
    imageCount: items.filter((it) => isDataUrl(it.image)).length,
    problems: [],
  };
}

async function blobText(b: Blob): Promise<{ text: string; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  return { text: new TextDecoder().decode(bytes), bytes };
}

/** 读一个 .glean */
export async function readGlean(file: Blob): Promise<Incoming> {
  const entries = await readZipBlob(file);
  const me = entries.get('manifest.json');
  const de = entries.get('data.jsonl');
  if (!de) throw new Error('不是 .glean 备份：缺 data.jsonl');
  const problems: string[] = [];
  let manifest: Partial<GleanManifest> = {};
  if (me) {
    try {
      manifest = JSON.parse((await blobText(await zipEntryBlob(file, me))).text);
    } catch {
      problems.push('manifest.json 读不出（按内容继续导入）');
    }
  } else problems.push('缺 manifest.json（按内容继续导入）');
  if (manifest.format && manifest.format !== GLEAN_FORMAT) throw new Error('不是 .glean 备份');
  if ((manifest.formatVersion || 1) > GLEAN_FORMAT_VERSION) problems.push(`备份格式 v${manifest.formatVersion} 比这个版本新，可能有字段读不懂`);
  const { text, bytes } = await blobText(await zipEntryBlob(file, de));
  const want = manifest.files?.['data.jsonl']?.sha256;
  if (want && want !== (await sha256Hex(bytes))) problems.push('data.jsonl 哈希对不上（文件可能损坏），能读的行照常导入');
  const items: InItem[] = [];
  const developments: InDev[] = [];
  const cliches: Cliche[] = [];
  const rejects: Reject[] = [];
  const works: Work[] = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: { t?: string } & Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    if (o.t === 'item' && typeof o.title === 'string' && o.type) items.push(o as unknown as InItem);
    else if (o.t === 'dev' && o.idea) developments.push(o as unknown as InDev);
    else if (o.t === 'cliche' && typeof o.text === 'string') cliches.push(o as unknown as Cliche);
    else if (o.t === 'reject' && typeof o.reason === 'string') rejects.push(o as unknown as Reject);
    else if (o.t === 'work' && validWork(o)) works.push(o as unknown as Work);
    else bad++;
  }
  if (bad) problems.push(`${bad} 行读不出，已跳过`);
  const imageSha = new Map<string, string>();
  for (const [path, info] of Object.entries(manifest.files || {})) if (path.startsWith('images/') && info?.sha256) imageSha.set(path, info.sha256);
  return {
    format: 'glean',
    exportedAt: manifest.exportedAt,
    appVersion: manifest.appVersion,
    deviceId: manifest.deviceId,
    items,
    developments,
    cliches,
    rejects,
    works,
    imageCount: new Set(items.map((x) => x.imageRef).filter(Boolean)).size,
    imageSha,
    image: async (ref: string) => {
      const e = entries.get(ref);
      if (!e) return null;
      const ext = ref.split('.').pop() || 'bin';
      return zipEntryBlob(file, e, EXT_MIME[ext] || '');
    },
    problems,
  };
}

/** v0.29 作品行最起码要有标题、形态、创建时间 */
function validWork(o: unknown): boolean {
  const w = o as Partial<Work> | null;
  return !!w && typeof w.title === 'string' && typeof w.form === 'string' && typeof w.createdAt === 'number';
}

/** 选中的文件：ZIP 头（PK）= .glean，否则当旧 JSON */
export async function readBackupFile(file: Blob): Promise<Incoming> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return readGlean(file);
  const text = await file.text();
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('既不是 .glean 也不是 JSON 备份');
  }
  return incomingFromObject(obj);
}

// ── 认重复 ──
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
/** 没 uid 的旧备份：记录时间 + 标题 + 内容哈希 */
export function itemFingerprint(it: Pick<Item, 'createdAt' | 'title' | 'content' | 'url' | 'type'>): string {
  return `${it.createdAt || 0}|${it.type}|${(it.title || '').trim()}|${fnv(`${it.content || ''}\u0001${it.url || ''}`)}`;
}
export function devFingerprint(dv: Pick<Development, 'createdAt' | 'idea'>): string {
  return `${dv.createdAt || 0}|${(dv.idea?.title || '').trim()}|${fnv(dv.idea?.idea || '')}`;
}

type Action = 'add' | 'update' | 'skip';
export interface ItemOp {
  inc: InItem;
  local?: Item;
  action: Action;
}
export interface DevOp {
  inc: InDev;
  local?: Development;
  action: Action;
}
export interface ImportCounts {
  mode: ImportMode;
  items: { add: number; update: number; skip: number; trash: number };
  developments: { add: number; update: number; skip: number; trash: number };
  images: number;
  cliches: number;
}
export interface ImportPlan {
  mode: ImportMode;
  items: ItemOp[];
  developments: DevOp[];
  /** 替换：本机没在备份里的，移进回收站 */
  trashItems: number[];
  trashDevelopments: number[];
  counts: ImportCounts;
}

function decide(mode: ImportMode, incTime: number, local: { updatedAt?: number; createdAt?: number } | undefined, incDeleted: boolean): Action {
  if (!local) return incDeleted ? 'skip' : 'add';
  if (mode === 'missing') return 'skip';
  if (mode === 'replace') return 'update';
  return incTime > (local.updatedAt || local.createdAt || 0) ? 'update' : 'skip';
}

interface LocalIndex {
  items: Item[];
  devs: Development[];
  clicheKeys: Set<string>;
}
async function localIndex(d: LinganDB): Promise<LocalIndex> {
  const [items, devs, cl] = await Promise.all([d.items.toArray(), d.developments.toArray(), d.cliches.toArray()]);
  return { items, devs, clicheKeys: new Set(cl.map((c) => c.key)) };
}

function planWith(inc: Incoming, L: LocalIndex, mode: ImportMode): ImportPlan {
  // 本机：uid → 行、指纹 → 行（一行只认一次）
  const byUid = new Map<string, Item>();
  const byFp = new Map<string, Item>();
  for (const it of L.items) {
    if (it.uid) byUid.set(it.uid, it);
    const fp = itemFingerprint(it);
    if (!byFp.has(fp)) byFp.set(fp, it);
  }
  const used = new Set<number>();
  const seen = new Set<string>();
  const items: ItemOp[] = [];
  // 备份里同一个 uid / 指纹出现多次：后面的为准
  const incItems = [...inc.items].reverse().filter((x) => {
    const k = isUlid(x.uid) ? 'u:' + x.uid : 'f:' + itemFingerprint(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  incItems.reverse();
  for (const x of incItems) {
    let local = isUlid(x.uid) ? byUid.get(x.uid) : undefined;
    if (!local) {
      const f = byFp.get(itemFingerprint(x));
      if (f && !used.has(f.id!) && !(isUlid(x.uid) && f.uid && f.uid !== x.uid && byUidHasIncoming(inc, f.uid))) local = f;
    }
    if (local && used.has(local.id!)) local = undefined;
    if (local) used.add(local.id!);
    items.push({ inc: x, local, action: decide(mode, x.updatedAt || x.createdAt || 0, local, !!x.deletedAt) });
  }
  const trashItems = mode === 'replace' ? L.items.filter((it) => alive(it) && !used.has(it.id!)).map((it) => it.id!) : [];

  const dByUid = new Map<string, Development>();
  const dByFp = new Map<string, Development>();
  for (const dv of L.devs) {
    if (dv.uid) dByUid.set(dv.uid, dv);
    const fp = devFingerprint(dv);
    if (!dByFp.has(fp)) dByFp.set(fp, dv);
  }
  const dUsed = new Set<number>();
  const dSeen = new Set<string>();
  const devs: DevOp[] = [];
  for (const x of [...inc.developments].reverse()) {
    const k = isUlid(x.uid) ? 'u:' + x.uid : 'f:' + devFingerprint(x);
    if (dSeen.has(k)) continue;
    dSeen.add(k);
    let local = isUlid(x.uid) ? dByUid.get(x.uid) : undefined;
    if (!local) local = dByFp.get(devFingerprint(x));
    if (local && dUsed.has(local.id!)) local = undefined;
    if (local) dUsed.add(local.id!);
    devs.push({ inc: x, local, action: decide(mode, x.updatedAt || x.createdAt || 0, local, !!x.deletedAt) });
  }
  devs.reverse();
  const trashDevelopments = mode === 'replace' ? L.devs.filter((dv) => alive(dv) && !dUsed.has(dv.id!)).map((dv) => dv.id!) : [];

  const cnt = (ops: Array<{ action: Action }>, trash: number) => ({ add: ops.filter((o) => o.action === 'add').length, update: ops.filter((o) => o.action === 'update').length, skip: ops.filter((o) => o.action === 'skip').length, trash });
  const imgs = items.filter((o) => o.action !== 'skip' && (o.inc.imageRef || isDataUrl(o.inc.image))).length;
  let newCliches = 0;
  const incCl = inc.cliches ?? clichesFromDevs(devs.filter((o) => o.action === 'add').map((o) => o.inc));
  const ck = new Set<string>();
  for (const c of incCl) {
    const key = clicheKey(c?.key || cleanText(c?.text)) || clicheKey(cleanText(c?.text));
    if (validKey(key) && !L.clicheKeys.has(key) && !ck.has(key)) {
      ck.add(key);
      newCliches++;
    }
  }
  return {
    mode,
    items,
    developments: devs,
    trashItems,
    trashDevelopments,
    counts: { mode, items: cnt(items, trashItems.length), developments: cnt(devs, trashDevelopments.length), images: imgs, cliches: newCliches },
  };
}
// 指纹撞上的本机行已经有别的 uid、而且备份里也有那个 uid 的行：说明是两件不同的穗，别合并
function byUidHasIncoming(inc: Incoming, uid: string): boolean {
  return inc.items.some((x) => x.uid === uid);
}

export async function planImport(inc: Incoming, d: LinganDB = defaultDb, mode: ImportMode = 'merge'): Promise<ImportPlan> {
  return planWith(inc, await localIndex(d), mode);
}
/** 预览：三种模式各会怎样（只读一遍本机库） */
export async function previewImport(inc: Incoming, d: LinganDB = defaultDb): Promise<Record<ImportMode, ImportCounts>> {
  const L = await localIndex(d);
  return { merge: planWith(inc, L, 'merge').counts, missing: planWith(inc, L, 'missing').counts, replace: planWith(inc, L, 'replace').counts };
}

function cleanRow(x: InItem): Item {
  const row = { ...x } as Record<string, unknown>;
  for (const k of ['t', 'imageRef', 'id', 'thumb', 'thumbW', 'thumbH', 'thumbTodo', 'thumbFail', 'hasImage']) delete row[k];
  const it = row as unknown as Item;
  it.tags = normalizeTags(Array.isArray(it.tags) ? it.tags : []);
  // v0.28 穗束：只认字符串数组
  if (it.bundles !== undefined) {
    const b = Array.isArray(it.bundles) ? withBundles([], it.bundles.filter((x): x is string => typeof x === 'string')) : [];
    if (b.length) it.bundles = b;
    else delete it.bundles;
  }
  if (typeof it.createdAt !== 'number') it.createdAt = Date.now();
  if (typeof it.updatedAt !== 'number') it.updatedAt = it.createdAt;
  if (!isUlid(it.uid)) it.uid = ulid(it.createdAt);
  if (!it.deviceId) it.deviceId = getDeviceId();
  return it;
}

export interface ImportResult extends ImportCounts {
  /** 坏掉（哈希不对 / 缺失）没能导入的原图 */
  badImages: number;
  problems: string[];
}

/** 按计划写库（一个事务；原图先在事务外逐张核对哈希） */
export async function applyImport(inc: Incoming, plan: ImportPlan, d: LinganDB = defaultDb, now = Date.now()): Promise<ImportResult> {
  // 1) .glean 的原图：事务外读出并核对（读文件会让 IndexedDB 事务提前提交，所以不能放进事务里）
  const blobs = new Map<string, Blob>();
  let badImages = 0;
  if (inc.format === 'glean' && inc.image) {
    const refs = new Set(plan.items.filter((o) => o.action !== 'skip' && o.inc.imageRef).map((o) => o.inc.imageRef!));
    for (const ref of refs) {
      const b = await inc.image(ref).catch(() => null);
      if (!b) {
        badImages++;
        continue;
      }
      const want = inc.imageSha?.get(ref) || ref.match(/^images\/([0-9a-f]{64})\./)?.[1];
      if (want) {
        const got = await sha256Hex(new Uint8Array(await b.arrayBuffer()));
        if (got !== want) {
          badImages++;
          continue;
        }
      }
      blobs.set(ref, b);
    }
  }
  let wroteImages = 0;
  const addedDevs: Development[] = [];
  const noCount: number[] = [];
  await d.transaction('rw', [d.items, d.developments, d.images, d.cliches, d.rejects, d.works], async () => {
    markRawTransaction();
    const uidToId = new Map<string, number>();
    const oldToId = new Map<number, number>();
    for (const op of plan.items) {
      let id: number;
      if (op.action === 'skip') {
        if (!op.local) continue;
        id = op.local.id!;
      } else {
        const row = cleanRow(op.inc);
        let blob: Blob | null = null;
        let keepLocalImage = false;
        if (inc.format === 'glean') {
          if (op.inc.imageRef) {
            blob = blobs.get(op.inc.imageRef) || null;
            if (!blob) keepLocalImage = true; // 坏图：保留本机原来的
          }
          delete row.image;
        } else blob = detachInlineImage(row);
        if (op.action === 'add') {
          if (blob) {
            row.hasImage = 1;
            row.thumbTodo = 1;
          }
          id = await d.items.add(row);
          if (typeof op.inc.graftCount !== 'number') noCount.push(id);
        } else {
          const L = op.local!;
          id = L.id!;
          row.id = id;
          row.uid = L.uid || row.uid;
          row.graftCount = Math.max(L.graftCount || 0, row.graftCount || 0);
          if (L.graftedAt || row.graftedAt) row.graftedAt = Math.max(L.graftedAt || 0, row.graftedAt || 0);
          if (L.touchedAt || row.touchedAt) row.touchedAt = Math.max(L.touchedAt || 0, row.touchedAt || 0);
          if (!row.embedding && L.embedding) {
            row.embedding = L.embedding;
            row.embedModel = L.embedModel;
          }
          if (blob) {
            row.hasImage = 1;
            row.thumbTodo = 1;
          } else if (keepLocalImage && L.hasImage) {
            row.hasImage = 1;
            if (L.thumb) {
              row.thumb = L.thumb;
              row.thumbW = L.thumbW;
              row.thumbH = L.thumbH;
            } else row.thumbTodo = 1;
          }
          await d.items.put(row);
          if (!blob && !keepLocalImage) await d.images.delete(id);
        }
        if (blob) {
          await d.images.put({ itemId: id, blob });
          wroteImages++;
        }
      }
      if (op.inc.uid) uidToId.set(op.inc.uid, id);
      if (typeof op.inc.id === 'number') oldToId.set(op.inc.id, id);
    }
    if (plan.trashItems.length)
      await d.items
        .where(':id')
        .anyOf(plan.trashItems)
        .modify((it: Item) => {
          it.deletedAt = now;
          it.updatedAt = now;
          it.deviceId = getDeviceId();
        });
    for (const op of plan.developments) {
      if (op.action === 'skip') continue;
      const { id: oldId, itemUids, t: _t, ...rest } = op.inc;
      void _t;
      void oldId;
      const itemIds = Array.isArray(itemUids) ? itemUids.map((u) => (u ? uidToId.get(u) ?? -1 : -1)) : (rest.itemIds || []).map((x) => oldToId.get(x) ?? -1);
      const nd: Development = { ...rest, itemIds };
      if (!isUlid(nd.uid)) nd.uid = ulid(nd.createdAt || now);
      if (typeof nd.updatedAt !== 'number') nd.updatedAt = nd.createdAt || now;
      if (!nd.deviceId) nd.deviceId = getDeviceId();
      migrateDevelopment(nd);
      if (op.action === 'add') {
        await d.developments.add(nd);
        addedDevs.push(nd);
      } else {
        nd.id = op.local!.id;
        nd.uid = op.local!.uid || nd.uid;
        await d.developments.put(nd);
      }
    }
    if (plan.trashDevelopments.length)
      await d.developments
        .where(':id')
        .anyOf(plan.trashDevelopments)
        .modify((dv: Development) => {
          dv.deletedAt = now;
          dv.updatedAt = now;
          dv.deviceId = getDeviceId();
        });
    // v0.18 旧备份没有嫁接次数：按一起导入的新枝回填，没有就补 0
    const fill = noCount;
    if (fill.length) {
      const stats = graftStatsFromDevs(addedDevs);
      for (const nid of fill) {
        const st = stats.get(nid);
        await d.items.update(nid, st ? { graftCount: st.count, graftedAt: st.last } : { graftCount: 0 });
      }
    }
    // v0.19 套路墙：备份里有就按 key 合并（我加的 / 划掉的状态带过来），旧备份没有就从导入的新枝里重建
    const incoming: Cliche[] = (inc.cliches ?? clichesFromDevs(addedDevs))
      .map((c) => {
        const text = cleanText(c?.text);
        const key = clicheKey(c?.key || text) || clicheKey(text);
        const t = typeof c?.lastAt === 'number' ? c.lastAt : now;
        const row: Cliche = { key, text: text || key, source: c?.source === 'user' ? 'user' : 'ai', struck: c?.struck ? 1 : 0, listed: Number(c?.listed) || 0, blocked: Number(c?.blocked) || 0, createdAt: typeof c?.createdAt === 'number' ? c.createdAt : t, lastAt: t };
        if (isUlid(c?.uid)) row.uid = c.uid;
        row.updatedAt = typeof c?.updatedAt === 'number' ? c.updatedAt : t;
        row.deviceId = c?.deviceId || getDeviceId();
        return row;
      })
      .filter((c) => validKey(c.key));
    for (const c of incoming) {
      const row = await d.cliches.where('key').equals(c.key).first();
      if (!row) {
        if (c.uid && (await d.cliches.where('uid').equals(c.uid).count())) delete c.uid;
        await d.cliches.add(c);
      } else if (plan.mode !== 'missing')
        await d.cliches.update(row.id!, {
          listed: Math.max(row.listed || 0, c.listed),
          blocked: Math.max(row.blocked || 0, c.blocked),
          lastAt: Math.max(row.lastAt, c.lastAt),
          ...(c.source === 'user' ? { source: 'user' as const } : {}),
          ...(c.struck && !row.struck ? { struck: 1 as const } : {}),
        });
    }
    // v0.24 不要的理由：按 uid 去重，只补本机没有的（替换模式也不删本机的理由）
    for (const r of inc.rejects || []) {
      if (!r || typeof r.reason !== 'string' || typeof r.createdAt !== 'number') continue;
      if (isUlid(r.uid) && (await d.rejects.where('uid').equals(r.uid!).count())) continue;
      const { t: _t, id: _id, ...row } = r as Reject & { t?: string };
      void _t;
      void _id;
      if (!isUlid(row.uid)) row.uid = ulid(row.createdAt);
      await d.rejects.add({ ...row, title: String(row.title || ''), updatedAt: row.updatedAt || row.createdAt, deviceId: row.deviceId || getDeviceId() });
    }
    // v0.29 作品：按 uid 认；合并 = 备份里更新的覆盖，只补缺 = 只加本机没有的，替换 = 备份为准、本机多出来的进回收站
    if (inc.works) {
      const seenW = new Set<string>();
      for (const w of inc.works) {
        const { t: _t, id: _id, ...row } = w as Work & { t?: string };
        void _t;
        void _id;
        if (!isUlid(row.uid)) row.uid = ulid(row.createdAt);
        seenW.add(row.uid!);
        row.devUids = Array.isArray(row.devUids) ? row.devUids : [];
        row.itemUids = Array.isArray(row.itemUids) ? row.itemUids : [];
        row.todos = Array.isArray(row.todos) ? row.todos : [];
        row.draft = typeof row.draft === 'string' ? row.draft : '';
        if (typeof row.updatedAt !== 'number') row.updatedAt = row.createdAt;
        if (!row.deviceId) row.deviceId = getDeviceId();
        const local = await d.works.where('uid').equals(row.uid!).first();
        if (!local) {
          if (!row.deletedAt) await d.works.add(row);
        } else if (plan.mode === 'replace' || (plan.mode === 'merge' && row.updatedAt! > (local.updatedAt || local.createdAt))) await d.works.put({ ...row, id: local.id });
      }
      if (plan.mode === 'replace')
        await d.works
          .filter((x) => !x.deletedAt && !seenW.has(x.uid || ''))
          .modify((x: Work) => {
            x.deletedAt = now;
            x.updatedAt = now;
            x.deviceId = getDeviceId();
          });
    }
  });
  if (wroteImages) notifyNewImages();
  return { ...plan.counts, badImages, problems: [...inc.problems, ...(badImages ? [`${badImages} 张图坏了或缺失，没导进来`] : [])] };
}

/** 一步到位：读对象 → 计划 → 写库 */
export async function importBackupObject(b: unknown, d: LinganDB = defaultDb, mode: ImportMode = 'merge'): Promise<ImportResult> {
  const inc = incomingFromObject(b);
  const plan = await planImport(inc, d, mode);
  return applyImport(inc, plan, d);
}
export async function importBackupFile(file: Blob, d: LinganDB = defaultDb, mode: ImportMode = 'merge'): Promise<ImportResult> {
  const inc = await readBackupFile(file);
  const plan = await planImport(inc, d, mode);
  return applyImport(inc, plan, d);
}

/** 测试与内存用：把 sink 收到的块拼成一个 Blob（Blob 块不复制） */
export class BlobSink implements ByteSink {
  parts: BlobPart[] = [];
  size = 0;
  async write(c: Uint8Array | Blob) {
    this.parts.push(c as BlobPart);
    this.size += c instanceof Blob ? c.size : c.length;
  }
  blob(type = GLEAN_MIME) {
    return new Blob(this.parts, { type });
  }
}

