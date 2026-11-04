import { enqueuePending, isStorageError, PendingWriteError, replayPending } from './safewrite';
import Dexie, { type Table, type Transaction } from 'dexie';
import { adoptDeviceId, getDeviceId } from './device';
import { isUlid, ulid } from './ulid';
import { hlcFromWall, isHlc, tick } from './hlc';
import { DAILY_COMBO, pickDaily, pickStillValid, todayKey } from './daily';
import { graftStatsFromDevs } from './modes';
import { migrateDevelopment } from './provenance';
import { drawSamples, sampleTimes } from './sampledraw';
import { blobToDataUrl, dataUrlToBlob, detachInlineImage, isDataUrl, migrateInlineImages, setItemImage } from './imagestore';
import type { DailyPick, Development, FtRow, Item, Reject, StoredImage, Work } from './types';
import { cleanText, clicheKey, validKey, wallCandidates, type Cliche } from './wall';
import { dupKeys, imageKey, mergedPatch, refreshDup } from './dupe';
import { sha256Hex } from './sha256';
import { resolveTag } from './tagalias';

export class LinganDB extends Dexie {
  items!: Table<Item, number>;
  developments!: Table<Development, number>;
  images!: Table<StoredImage, number>;
  daily!: Table<DailyPick, string>;
  ftidx!: Table<FtRow, string>;
  cliches!: Table<Cliche, number>;
  meta!: Table<MetaRow, string>;
  rejects!: Table<Reject, number>;
  works!: Table<Work, number>;
  constructor(name = 'lingan') {
    super(name);
    this.version(1).stores({
      items: '++id, type, createdAt, updatedAt, *tags',
      developments: '++id, createdAt, starred',
    });
    // v0.12 新枝溯源：给旧新枝补上 refs 与 evidence 标记（不删不改正文）
    this.version(2)
      .stores({ developments: '++id, createdAt, starred, evidence' })
      .upgrade((tx) =>
        tx
          .table('developments')
          .toCollection()
          .modify((d: Development) => {
            migrateDevelopment(d);
          }),
      );
    // v0.13 千穗不卡：原图搬进独立的 images 表，列表行只留缩略图；thumbTodo 索引给后台补缩略图用
    this.version(3)
      .stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo', images: '&itemId' })
      .upgrade((tx) => migrateInlineImages(tx.table('items'), tx.table('images')).then(() => undefined));
    // v0.14 每日一穗 + 示例池：items 加 sample（一键清示例）与 touchedAt（很久没碰）索引；daily 表存每天定下来的内容。
    // 迁移：按已有新枝补上每件穗最后一次被拿去嫁接的时间（不动正文）
    this.version(4)
      .stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt', daily: '&day' })
      .upgrade(async (tx) => {
        const last = new Map<number, number>();
        await tx
          .table('developments')
          .toCollection()
          .each((d: Development) => {
            for (const id of d.itemIds || []) if (id > 0 && (last.get(id) || 0) < d.createdAt) last.set(id, d.createdAt);
          });
        if (!last.size) return;
        await tx
          .table('items')
          .toCollection()
          .modify((it: Item) => {
            const t = it.id != null ? last.get(it.id) : undefined;
            if (t && t > (it.touchedAt || 0)) it.touchedAt = t;
          });
      });
    // v0.17 秒搜：全文索引表（每件穗 / 每根新枝一行：切好的词 + 内容签名）。升级时不切词、不动旧数据，
    // 打开后由 lib/ftsync 在空闲时后台补齐；增删改穗 / 新枝时增量更新
    this.version(5).stores({ ftidx: '&key, kind' });
    // v0.18 五种嫁接：每件穗记被嫁接的次数（graftCount，带索引）与最后一次时间（graftedAt）。
    // 迁移：按已有新枝回填（同一批三根算一次，旧的单根新枝每根算一次），从没接过的补 0；不动正文
    this.version(6)
      .stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt, graftCount' })
      .upgrade(async (tx) => {
        const devs = (await tx.table('developments').toArray()) as Development[];
        const stats = graftStatsFromDevs(devs);
        await tx
          .table('items')
          .toCollection()
          .modify((it: Item) => {
            const st = it.id != null ? stats.get(it.id) : undefined;
            it.graftCount = st ? st.count : 0;
            if (st && st.last) it.graftedAt = st.last;
          });
      });
    // v0.19 我的套路墙：cliches 表（key 唯一）。迁移：把旧新枝里模型列出过的套路沉淀上墙（同一批三根算一次），不动新枝本身
    this.version(7)
      .stores({ cliches: '++id, &key, source, struck, lastAt' })
      .upgrade(async (tx) => {
        const devs = (await tx.table('developments').toArray()) as Development[];
        const rows = clichesFromDevs(devs);
        if (rows.length) await tx.table('cliches').bulkAdd(rows);
      });
    // v0.21 数据地基：每件穗 / 新枝 / 套路一个全局 uid（ULID，唯一索引）+ updatedAt + deviceId；
    // 穗与新枝加 deletedAt（墓碑 / 回收站）索引；meta 表记本机 deviceId。迁移只补字段，不删不改任何内容
    this.version(8)
      .stores({
        items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt, graftCount, &uid, deletedAt',
        developments: '++id, createdAt, starred, evidence, &uid, deletedAt',
        cliches: '++id, &key, source, struck, lastAt, &uid',
        meta: '&k',
      })
      .upgrade(async (tx) => {
        const dev = getDeviceId();
        await tx
          .table('items')
          .toCollection()
          .modify((it: Item) => {
            if (!isUlid(it.uid)) it.uid = ulid(it.createdAt || Date.now());
            if (!it.deviceId) it.deviceId = dev;
            if (typeof it.updatedAt !== 'number') it.updatedAt = it.createdAt || Date.now();
          });
        await tx
          .table('developments')
          .toCollection()
          .modify((d: Development) => {
            if (!isUlid(d.uid)) d.uid = ulid(d.createdAt || Date.now());
            if (!d.deviceId) d.deviceId = dev;
            if (typeof d.updatedAt !== 'number') d.updatedAt = d.createdAt || Date.now();
          });
        await tx
          .table('cliches')
          .toCollection()
          .modify((c: Cliche) => {
            if (!isUlid(c.uid)) c.uid = ulid(c.createdAt || Date.now());
            if (!c.deviceId) c.deviceId = dev;
            if (typeof c.updatedAt !== 'number') c.updatedAt = c.lastAt || c.createdAt || Date.now();
          });
        await tx.table('meta').put({ k: 'deviceId', v: dev });
      });
    // v0.23 待理与补为什么：items 加 inbox（待理收件箱）与 *dup（重复钥匙：链接 / 原图哈希 / 文字指纹）索引。
    // 迁移：老穗一律不进待理（升级不把整个穗仓塞进收件箱）；按链接与文字补上重复钥匙，原图哈希由后台空闲时补（backfillImageDup）。不动任何内容
    this.version(9)
      .stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt, graftCount, &uid, deletedAt, inbox, *dup' })
      .upgrade((tx) =>
        tx
          .table('items')
          .toCollection()
          .modify((it: Item) => {
            it.dup = dupKeys(it);
          }),
      );
    // v0.24 嫁接反馈：rejects 表存「不要」的理由（快捷理由 / 自定义原话 + 那根新枝的标题），按时间取最近 20 条写进嫁接提示词。
    // 迁移：新表，不动任何旧数据（旧版没有记过理由）
    this.version(10).stores({ rejects: '++id, &uid, createdAt, reason' });
    // v0.29 作品工坊（0301）：works 表（新枝立项后的作品：素材 / 草稿 / 待办 / 分镜 / 歌单 / 情绪板，引用都存 uid）。
    // 迁移：新表，不动任何旧数据（旧版没有作品）
    this.version(11).stores({ works: '++id, &uid, updatedAt, createdAt, deletedAt, stage' });
    // v0.31 同步地基（0602 0619）：五张会同步的表每行加 hlc（混合逻辑时钟，行里最新一次修改）+ hc（新建时的 HLC）
    // + fh（改过的字段 → 那次的 HLC，字段级合并用），hlc 建索引（同步只推 hlc 比上次推过的大的行）。
    // 迁移：按每行自己的 updatedAt 和 deviceId 换算 hlc = hc，不动任何内容
    this.version(12)
      .stores({
        items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt, graftCount, &uid, deletedAt, inbox, *dup, hlc',
        developments: '++id, createdAt, starred, evidence, &uid, deletedAt, hlc',
        cliches: '++id, &key, source, struck, lastAt, &uid, hlc',
        rejects: '++id, &uid, createdAt, reason, hlc',
        works: '++id, &uid, updatedAt, createdAt, deletedAt, stage, hlc',
      })
      .upgrade(async (tx) => {
        const dev = getDeviceId();
        for (const t of SYNC_TABLES)
          await tx
            .table(t)
            .toCollection()
            .modify((r: Stamped & { lastAt?: number }) => {
              if (!isHlc(r.hlc)) r.hlc = hlcFromWall(r.updatedAt || r.lastAt || r.createdAt || 0, r.deviceId || dev);
              if (!isHlc(r.hc)) r.hc = r.hlc;
            });
      });
    stampHooks(this);
    dupHooks(this);
    // 库里记的设备 id 为准（localStorage 被清了但库还在时沿用原来的）
    // 不返回 Promise：不拖慢打开（冷启动），读完再对齐
    this.on('ready', () => {
      void this.meta
        .get('deviceId')
        .then((row) => {
          if (row && typeof row.v === 'string') adoptDeviceId(row.v);
          else return this.meta.put({ k: 'deviceId', v: getDeviceId() });
        })
        .catch(() => undefined);
    });
  }
}

export interface MetaRow {
  k: string;
  v: unknown;
}

/** 这些字段的变化不算「修改」（缩略图、碰过、向量、嫁接统计、自身盖章） */
/** v0.31 会同步的表（顺序 = 应用顺序：穗先于引用它的新枝 / 作品） */
export const SYNC_TABLES = ['items', 'developments', 'cliches', 'rejects', 'works'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
const STAMP_META = ['hlc', 'hc', 'fh'];
const ITEM_LOCAL = new Set([...STAMP_META, 'imgSha', 'thumb', 'thumbW', 'thumbH', 'thumbTodo', 'thumbFail', 'hasImage', 'image', 'touchedAt', 'embedding', 'embedModel', 'graftCount', 'graftedAt', 'uid', 'deviceId', 'updatedAt', 'dup', 'tagSugg', 'metaTodo']);
const DEV_LOCAL = new Set([...STAMP_META, 'uid', 'deviceId', 'updatedAt']);
const CLICHE_LOCAL = new Set([...STAMP_META, 'listed', 'blocked', 'lastAt', 'uid', 'deviceId', 'updatedAt']);

/** 导入 / 迁移时原样写入（不盖本机章）：迁移事务、或事务上打了 __gleanRaw 标记 */
function rawTx(tx: Transaction | undefined): boolean {
  if (!tx) return false;
  const t = tx as Transaction & { __gleanRaw?: boolean; mode?: string; idbtrans?: IDBTransaction };
  return !!t.__gleanRaw || t.mode === 'versionchange' || t.idbtrans?.mode === 'versionchange';
}
/**
 * 在当前事务里关掉自动盖章（导入备份要保留对方的 updatedAt / deviceId）。
 * v0.31：sync=true 是同步引擎在写（行的 HLC 原样）；其余的原样写入（导入、恢复快照）字段的 HLC 保留，
 * 但行的 hlc 换成本机新的一刻——这样下次同步会把它们推出去（不然从别的设备备份导进来的旧行永远推不出去）
 */
export function markRawTransaction(sync = false) {
  const t = Dexie.currentTransaction as (Transaction & { __gleanRaw?: boolean; __gleanSync?: boolean }) | null;
  if (t) {
    t.__gleanRaw = true;
    if (sync) t.__gleanSync = true;
  }
}
/** 原样写入、但不是同步也不是迁移：行要重新盖一个本机 hlc */
function restampTx(tx: Transaction | undefined): boolean {
  const t = tx as (Transaction & { __gleanSync?: boolean; mode?: string; idbtrans?: IDBTransaction }) | undefined;
  return !!t && !t.__gleanSync && t.mode !== 'versionchange' && t.idbtrans?.mode !== 'versionchange';
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Blob || b instanceof Blob) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

type Stamped = { uid?: string; deviceId?: string; updatedAt?: number; createdAt?: number; hlc?: string; hc?: string; fh?: Record<string, string> };
const PURGED_KEY = 'glean.sync.purged';
/** v0.31 同步开着时，彻底删掉的行记一笔墓碑（表 + uid + HLC），下次同步推给别的设备，免得被拉回来 */
function notePurge(t: string, uid: string | undefined) {
  if (!uid) return;
  try {
    if (!localStorage.getItem('glean.sync.v1')) return;
    const v = JSON.parse(localStorage.getItem(PURGED_KEY) || '[]');
    const list = Array.isArray(v) ? v : [];
    list.push({ t, u: uid, h: tick() });
    localStorage.setItem(PURGED_KEY, JSON.stringify(list.slice(-5000)));
  } catch {
    /* ignore */
  }
}
function stampTable(name: string, table: Table<Stamped, number>, local: Set<string>) {
  table.hook('creating', function (_pk, obj, tx) {
    if (!isUlid(obj.uid)) obj.uid = ulid(typeof obj.createdAt === 'number' ? obj.createdAt : Date.now());
    if (rawTx(tx)) {
      // 导入 / 同步写进来的行：字段带着对方的 HLC；旧备份没有就按它的 updatedAt 换算
      if (!isHlc(obj.hc)) obj.hc = isHlc(obj.hlc) ? obj.hlc : hlcFromWall(obj.updatedAt || obj.createdAt || 0, obj.deviceId || getDeviceId());
      if (!isHlc(obj.hlc)) obj.hlc = obj.hc;
      if (restampTx(tx)) obj.hlc = tick();
      return;
    }
    if (!obj.deviceId) obj.deviceId = getDeviceId();
    if (typeof obj.updatedAt !== 'number') obj.updatedAt = typeof obj.createdAt === 'number' ? obj.createdAt : Date.now();
    obj.hlc = obj.hc = tick();
    delete obj.fh;
  });
  table.hook('updating', function (mods, _pk, obj, tx) {
    const m = mods as Record<string, unknown>;
    if (rawTx(tx)) {
      if (!restampTx(tx) || 'hlc' in m) return undefined;
      return Object.keys(m).some((k) => !local.has(k.split('.')[0]) && !sameValue(m[k], Dexie.getByKeyPath(obj, k))) ? { hlc: tick() } : undefined;
    }
    const add: Record<string, unknown> = {};
    if (!isUlid(obj.uid) && !('uid' in m)) add.uid = ulid(typeof obj.createdAt === 'number' ? obj.createdAt : Date.now());
    // Dexie 会把没变的字段（例如多值索引 tags）也放进 mods：逐个和旧值比，真变了才算修改
    const changed = [...new Set(Object.keys(m).filter((k) => !local.has(k.split('.')[0]) && !sameValue(m[k], Dexie.getByKeyPath(obj, k))).map((k) => k.split('.')[0]))];
    if (changed.length) {
      add.deviceId = getDeviceId();
      if (!('updatedAt' in m)) add.updatedAt = Date.now();
      // 0619 字段级：记下这次改了哪几个字段、在什么时刻
      const h = tick();
      add.hlc = h;
      const fh: Record<string, string> = { ...(obj.fh || {}) };
      for (const k of changed) fh[k] = h;
      add.fh = fh;
      if (!isHlc(obj.hc)) add.hc = hlcFromWall(obj.createdAt || 0, obj.deviceId || getDeviceId());
    }
    return Object.keys(add).length ? add : undefined;
  });
  table.hook('deleting', function (_pk, obj, tx) {
    if (!rawTx(tx)) notePurge(name, obj?.uid);
  });
}
const DUP_FIELDS = ['type', 'title', 'content', 'creator', 'url'];
/** v0.23 重复钥匙跟着内容走：新建时补上（保留已有的图片钥匙），改了标题 / 正文 / 链接 / 作者 / 类型就重算 */
function dupHooks(d: LinganDB) {
  d.items.hook('creating', function (_pk, obj) {
    obj.dup = refreshDup(obj);
  });
  d.items.hook('updating', function (mods, _pk, obj) {
    const m = mods as Record<string, unknown>;
    // Dexie 会把没变的多值索引（tags / dup）也放进 mods：真改了 dup 才算显式写入；内容字段真变了才重算
    if ('dup' in m && !sameValue(m.dup, obj.dup)) return undefined;
    const o = obj as unknown as Record<string, unknown>;
    if (!DUP_FIELDS.some((k) => k in m && !sameValue(m[k], o[k]))) return undefined;
    const next = { ...obj } as Item;
    for (const k of DUP_FIELDS) if (k in m) (next as unknown as Record<string, unknown>)[k] = m[k];
    const dup = refreshDup(next);
    return sameValue(dup, obj.dup) ? undefined : { dup };
  });
}

/** v0.21 自动盖章：新建时补 uid / deviceId / updatedAt；改了内容（不是缩略图、碰过这类派生字段）时更新 updatedAt 与 deviceId */
function stampHooks(d: LinganDB) {
  stampTable('items', d.items as unknown as Table<Stamped, number>, ITEM_LOCAL);
  stampTable('developments', d.developments as unknown as Table<Stamped, number>, DEV_LOCAL);
  stampTable('cliches', d.cliches as unknown as Table<Stamped, number>, CLICHE_LOCAL);
  stampTable('rejects', d.rejects as unknown as Table<Stamped, number>, DEV_LOCAL);
  stampTable('works', d.works as unknown as Table<Stamped, number>, DEV_LOCAL);
}

/** v0.19 从新枝里收集模型列出过的套路：同一批（batch.id）只算一次；返回可直接入库的行 */
export function clichesFromDevs(devs: Array<Pick<Development, 'idea' | 'batch' | 'createdAt' | 'id'>>): Cliche[] {
  const seenBatch = new Set<string>();
  const m = new Map<string, Cliche>();
  for (const d of [...devs].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    const bid = d.batch?.id ? `b:${d.batch.id}` : `d:${d.id ?? Math.random()}`;
    if (seenBatch.has(bid)) continue;
    seenBatch.add(bid);
    for (const c of wallCandidates(d.idea?.cliches)) {
      const t = d.createdAt || Date.now();
      const row = m.get(c.key);
      if (row) {
        row.listed++;
        row.lastAt = Math.max(row.lastAt, t);
      } else m.set(c.key, { key: c.key, text: c.text, source: 'ai', struck: 0, listed: 1, blocked: 0, createdAt: t, lastAt: t });
    }
  }
  return [...m.values()];
}

/** v0.19 这次嫁接模型列出的套路沉淀上墙：已有的 +1 次（划掉的保持划掉），新的加上。返回新上墙的条数 */
export async function depositCliches(list: unknown, d: LinganDB = db, now = Date.now()): Promise<number> {
  const cands = wallCandidates(list);
  if (!cands.length) return 0;
  let added = 0;
  await d.transaction('rw', d.cliches, async () => {
    for (const c of cands) {
      const row = await d.cliches.where('key').equals(c.key).first();
      if (row) await d.cliches.update(row.id!, { listed: (row.listed || 0) + 1, lastAt: now });
      else {
        await d.cliches.add({ key: c.key, text: c.text, source: 'ai', struck: 0, listed: 1, blocked: 0, createdAt: now, lastAt: now });
        added++;
      }
    }
  });
  return added;
}

/** v0.19 本地校验拦下了这些套路：给墙上对应条目记一次「拦下」 */
export async function markBlocked(keys: string[], d: LinganDB = db) {
  const list = [...new Set(keys)];
  if (!list.length) return;
  await d.transaction('rw', d.cliches, async () => {
    await d.cliches
      .where('key')
      .anyOf(list)
      .modify((c: Cliche) => {
        c.blocked = (c.blocked || 0) + 1;
      });
  });
}

export type AddClicheResult = { status: 'added' | 'restored' | 'exists' | 'invalid'; text: string };
/** v0.19 我手动加一个讨厌的词 / 梗。已在墙上但被划掉的：恢复；已在墙上的：不重复 */
export async function addUserCliche(raw: string, d: LinganDB = db, now = Date.now()): Promise<AddClicheResult> {
  const text = cleanText(raw);
  const key = clicheKey(text);
  if (!validKey(key)) return { status: 'invalid', text };
  return d.transaction('rw', d.cliches, async () => {
    const row = await d.cliches.where('key').equals(key).first();
    if (row) {
      if (row.struck) {
        await d.cliches.update(row.id!, { struck: 0, lastAt: now });
        return { status: 'restored' as const, text: row.text };
      }
      return { status: 'exists' as const, text: row.text };
    }
    await d.cliches.add({ key, text, source: 'user', struck: 0, listed: 0, blocked: 0, createdAt: now, lastAt: now });
    return { status: 'added' as const, text };
  });
}

/** v0.19 划掉（误伤，不再禁用）/ 恢复 */
export async function strikeCliche(id: number, struck: boolean, d: LinganDB = db) {
  await d.cliches.update(id, { struck: struck ? 1 : 0 });
}

export const db = new LinganDB();

export function normalizeTags(input: string | string[]): string[] {
  const arr = Array.isArray(input) ? input : input.split(/[,，、\s#]+/);
  const out: string[] = [];
  for (const t of arr) {
    const raw = t.trim().replace(/^#/, '');
    const s = raw ? resolveTag(raw) : raw;
    if (s && !out.includes(s) && s.length <= 24) out.push(s);
  }
  return out.slice(0, 12);
}

type Listener = () => void;
const imageListeners = new Set<Listener>();
/** 有新原图入库时通知后台缩略图任务（thumbjob 订阅） */
export function onNewImage(fn: Listener): () => void {
  imageListeners.add(fn);
  return () => imageListeners.delete(fn);
}
const notifyImage = () => imageListeners.forEach((f) => f());
/** 导入等批量写入了原图之后，通知后台补缩略图 */
export const notifyNewImages = notifyImage;
const addListeners = new Set<(row: Item, d: LinganDB) => void>();
/** v0.37 0723 新穗提交后立刻通知（穗仓先把这一穗插进列表，不等 liveQuery 把全表重读一遍） */
export function onItemAdded(fn: (row: Item, d: LinganDB) => void): () => void {
  addListeners.add(fn);
  return () => addListeners.delete(fn);
}

/** 新增一件穗：有图时原图进 images 表，行里只标「待做缩略图」 */
export async function addItem(data: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>, d: LinganDB = db, at?: { createdAt?: number; uid?: string; inbox?: boolean; noQueue?: boolean }): Promise<number> {
  const now = Date.now();
  // v0.22 极速拾收件箱：保留在原生面板里按下「存」的那一刻（createdAt）和原生生成的 uid（ULID），重复收也认得出
  const created = at?.createdAt && Number.isFinite(at.createdAt) && at.createdAt > 0 && at.createdAt <= now + 60000 ? Math.floor(at.createdAt) : now;
  const row: Item = { graftCount: 0, ...data, tags: normalizeTags(data.tags), createdAt: created, updatedAt: now };
  if (at?.uid && isUlid(at.uid)) row.uid = at.uid;
  // v0.23 待理：速记 / 分享 / 极速拾 / 选字 / 正在播放 收进来的先进待理（设置里关掉待理时不进）
  if (at?.inbox && inboxEnabled()) row.inbox = 1;
  else delete row.inbox;
  delete row.thumb;
  delete row.thumbW;
  delete row.thumbH;
  delete row.thumbTodo;
  delete row.thumbFail;
  delete row.hasImage;
  let id = 0;
  let had = false;
  const blob = detachInlineImage(row);
  if (!blob) delete row.image;
  // v0.23 原图哈希：同一张图再收一次认得出（ROADMAP v0.31）
  let ik: string | undefined;
  if (blob) ik = await blobHash(blob);
  row.dup = dupKeys(row, ik);
  try {
    await d.transaction('rw', d.items, d.images, async () => {
      id = await d.items.add(row);
      if (blob) {
        await d.images.put({ itemId: id, blob, fresh: Date.now() });
        had = true;
      }
    });
  } catch (e) {
    // v0.26 0605：存储层写不进去 → 暂存进待写队列，下次打开补上（原生收件箱来的不暂存：它没 ack 会自己再来）
    if (at?.noQueue || !isStorageError(e)) throw e;
    let entry;
    try {
      entry = enqueuePending({ ...data, tags: row.tags }, { createdAt: created, uid: row.uid, inbox: !!row.inbox });
    } catch {
      throw e;
    }
    throw new PendingWriteError(entry, e);
  }
  if (had) notifyImage();
  // 行对象就是刚写进去的那份（钩子盖的章也在上面）；不再读库——这时全表重读正占着 IndexedDB，单取一行也要排在它后面
  addListeners.forEach((f) => f({ ...row, id }, d));
  return id;
}

/** v0.26 0605：把暂存的穗补进库（启动后空闲时；有暂存才会被调用） */
export async function replayPendingWrites(d: LinganDB = db): Promise<{ done: number; left: number }> {
  return replayPending(
    (e) => addItem(e.data as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>, d, { createdAt: e.createdAt, uid: e.uid, inbox: e.inbox, noQueue: true }),
    async (uid) => (await d.items.where('uid').equals(uid).count()) > 0,
  );
}

async function blobHash(b: Blob): Promise<string | undefined> {
  try {
    return imageKey(await sha256Hex(new Uint8Array(await b.arrayBuffer())));
  } catch {
    return undefined;
  }
}

// ——— v0.23 待理（0101）———
export const INBOX_DAYS = 7;
const INBOX_OFF = 'glean.inbox';
/** 设置里能关掉待理：关掉后新穗直接进穗仓，已在待理里的也都显示在穗仓 */
export function inboxEnabled(): boolean {
  try {
    return localStorage.getItem(INBOX_OFF) !== 'off';
  } catch {
    return true;
  }
}
export function setInboxEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(INBOX_OFF);
    else localStorage.setItem(INBOX_OFF, 'off');
  } catch {
    /* ignore */
  }
}
/** 穗仓里显示它吗：整理过的，或在待理里超过 7 天的（待理关掉时全显示） */
export function inLibrary(it: Pick<Item, 'inbox' | 'createdAt' | 'down' | 'sealUntil'>, now = Date.now(), on = inboxEnabled()): boolean {
  // v0.40 0938 放下的穗不进默认穗仓（可搜、可拿回来）；v0.45 0924 封存中的也不进（拆开才回来）
  return !it.down && !it.sealUntil && (!it.inbox || !on || it.createdAt < now - INBOX_DAYS * 86400000);
}
/** 留下 = 整理过了，出待理（一批） */
export async function keepItems(ids: number[], d: LinganDB = db) {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return 0;
  let n = 0;
  await d.transaction('rw', d.items, async () => {
    n = await d.items
      .where(':id')
      .anyOf(list)
      .modify((it: Item) => {
        delete it.inbox;
      });
  });
  return n;
}
/** 一键全部入仓 */
export async function keepAllInbox(d: LinganDB = db): Promise<number[]> {
  const ids = (await d.items.where('inbox').equals(1).primaryKeys()) as number[];
  await keepItems(ids, d);
  return ids;
}
/** 撤销「留下」：放回待理 */
export async function reInbox(ids: number[], d: LinganDB = db) {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return;
  await d.transaction('rw', d.items, async () => {
    await d.items.where(':id').anyOf(list).modify({ inbox: 1 });
  });
}

// ——— v0.23 这穗收过了（ROADMAP v0.31）———
const NO_IMG = 'x:noimg';
/** 和它重复的旧穗（活着的、不是示例、不是它自己），最早的在前 */
export async function findDupes(id: number, d: LinganDB = db): Promise<Item[]> {
  const it = await d.items.get(id);
  if (!it?.dup?.length) return [];
  const keys = it.dup.filter((k) => k !== NO_IMG);
  if (!keys.length) return [];
  const rows = await d.items.where('dup').anyOf(keys).distinct().toArray();
  return rows.filter((x) => x.id !== id && alive(x) && !x.sample).sort((a, b) => a.createdAt - b.createdAt);
}
/** 合并：留下旧的那件（时间取更早），标签取并集、两次的为什么都留下、缺的字段补上；新的那件进回收站（可撤销） */
export async function mergeInto(keepId: number, dropId: number, d: LinganDB = db, now = Date.now()) {
  await d.transaction('rw', d.items, async () => {
    const [keep, drop] = await Promise.all([d.items.get(keepId), d.items.get(dropId)]);
    if (!keep || !drop) return;
    const p = mergedPatch(keep, drop);
    if (drop.createdAt < keep.createdAt) {
      p.createdAt = drop.createdAt;
      p.meets = [...(p.meets || []).filter((t) => t !== drop.createdAt), keep.createdAt].sort((a, b) => a - b);
    }
    await d.items.update(keepId, p);
    await d.items.update(dropId, { deletedAt: now });
  });
}
/** v0.35 0016：带链接的音乐 / 电影以前没有「作品名 + 作者」钥匙，第一次查重前补一遍（dup 是本机字段，不盖章） */
export async function ensureMediaDup(d: LinganDB = db) {
  const K = 'glean.dup35';
  if (localStorage.getItem(K)) return;
  const rows = await d.items.where('type').anyOf('music', 'film').toArray();
  for (const it of rows) {
    const dup = refreshDup(it);
    if (it.url && !sameValue(dup, it.dup)) await d.items.update(it.id!, { dup });
  }
  localStorage.setItem(K, '1');
}
/** 老原图补哈希（后台空闲时一次几张）：从 from（itemId）之后往下补，返回补了几张和下一次的起点；next = null 表示补完了 */
export async function backfillImageDup(d: LinganDB = db, batch = 6, from = 0): Promise<{ done: number; next: number | null }> {
  const ids = (await d.images.where('itemId').above(from).limit(batch * 8).primaryKeys()) as number[];
  if (!ids.length) return { done: 0, next: null };
  let done = 0;
  let last = from;
  const rows = await d.items.bulkGet(ids);
  for (let k = 0; k < rows.length; k++) {
    last = ids[k];
    const it = rows[k];
    if (!it || it.id == null || (it.dup || []).some((x) => x.startsWith('i:') || x === NO_IMG)) continue;
    const im = await d.images.get(it.id);
    const ik = im?.blob ? await blobHash(im.blob) : undefined;
    // 解不开的也记一个占位（不参与比对），免得每次都重试
    await d.items.update(it.id, { dup: [...(it.dup || []).filter((x) => !x.startsWith('i:') && x !== NO_IMG), ik || NO_IMG] });
    if (++done >= batch) break;
  }
  return { done, next: last };
}

/** v0.23 老原图都补上哈希：每次打开 App 后第一次收进一张图时跑一遍（已有哈希的直接跳过）。不在启动时跑：不和首屏、备份抢内存 */
let imgDupRun: Promise<void> | null = null;
export function ensureImageDup(d: LinganDB = db): Promise<void> {
  if (d === db && imgDupRun) return imgDupRun;
  const run = (async () => {
    let from = 0;
    for (;;) {
      const r = await backfillImageDup(d, 8, from);
      if (r.next == null) break;
      from = r.next;
      await new Promise((res) => setTimeout(res, 0));
    }
  })().catch(() => undefined);
  if (d === db) imgDupRun = run;
  return run;
}

/** 改一件穗。patch 里带了 image 键：字符串 = 换原图，空 = 删图；不带 = 不动图 */
export async function updateItem(id: number, patch: Partial<Item>, d: LinganDB = db) {
  const { image, ...rest } = patch;
  const p: Partial<Item> = { ...rest, updatedAt: Date.now(), touchedAt: Date.now() };
  if (patch.tags) p.tags = normalizeTags(patch.tags);
  delete p.thumb;
  delete p.thumbTodo;
  delete p.hasImage;
  await d.items.update(id, p);
  if ('image' in patch) {
    await setItemImage(d, id, image);
    if (image) notifyImage();
    // 换了 / 删了原图：图片钥匙跟着换
    const cur = await d.items.get(id);
    if (cur) {
      let ik: string | undefined;
      if (image && isDataUrl(image)) {
        try {
          ik = await blobHash(dataUrlToBlob(image));
        } catch {
          ik = undefined;
        }
      }
      await d.items.update(id, { dup: dupKeys(cur, ik) });
    }
  }
}

/** v0.21 活着的（不在回收站里）。所有列表、搜索、嫁接、导出都只看它们 */
export function alive<T extends { deletedAt?: number }>(x: T | null | undefined): x is T {
  return !!x && !x.deletedAt;
}
export async function liveItems(d: LinganDB = db): Promise<Item[]> {
  return (await d.items.toArray()).filter(alive);
}
export async function liveDevelopments(d: LinganDB = db): Promise<Development[]> {
  return (await d.developments.toArray()).filter(alive);
}
/** 不在回收站里的穗有几件（count 走 deletedAt 索引，不读整表） */
export async function liveCounts(d: LinganDB = db): Promise<{ items: number; devs: number; imgs: number; trash: number }> {
  const [ni, nd, gi, gd] = await Promise.all([d.items.count(), d.developments.count(), d.items.where('deletedAt').above(0).count(), d.developments.where('deletedAt').above(0).count()]);
  const trashIds = (await d.items.where('deletedAt').above(0).primaryKeys()) as number[];
  const [imgs, trashImgs] = await Promise.all([d.images.count(), trashIds.length ? d.images.where('itemId').anyOf(trashIds).count() : Promise.resolve(0)]);
  return { items: ni - gi, devs: nd - gd, imgs: imgs - trashImgs, trash: gi + gd };
}

/** v0.21 回收站保留天数 */
export const TRASH_DAYS = 30;

/** v0.21 删除 = 立墓碑（移进回收站，30 天内可恢复）。原图、嫁接次数、新枝里的来源都不动 */
export async function trashItems(ids: number[], d: LinganDB = db, now = Date.now()) {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return;
  await d.transaction('rw', d.items, async () => {
    await d.items.where(':id').anyOf(list).modify({ deletedAt: now });
  });
}
export async function untrashItems(ids: number[], d: LinganDB = db) {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return;
  await d.transaction('rw', d.items, async () => {
    await d.items
      .where(':id')
      .anyOf(list)
      .modify((it: Item) => {
        delete it.deletedAt;
      });
  });
}
export async function trashDevelopments(ids: number[], d: LinganDB = db, now = Date.now()) {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return;
  await d.transaction('rw', d.developments, async () => {
    await d.developments.where(':id').anyOf(list).modify({ deletedAt: now });
  });
}
export async function untrashDevelopments(ids: number[], d: LinganDB = db) {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return;
  await d.transaction('rw', d.developments, async () => {
    await d.developments
      .where(':id')
      .anyOf(list)
      .modify((dv: Development) => {
        delete dv.deletedAt;
      });
  });
}
/** 回收站里的东西（最近删的在前） */
export async function listTrash(d: LinganDB = db): Promise<{ items: Item[]; developments: Development[] }> {
  const [items, developments] = await Promise.all([d.items.where('deletedAt').above(0).toArray(), d.developments.where('deletedAt').above(0).toArray()]);
  items.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  developments.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  return { items, developments };
}
/** 彻底删除（只删回收站里的，活着的穗传进来也不动） */
export async function purgeTrash(sel: { items?: number[]; developments?: number[] } | 'all', d: LinganDB = db): Promise<{ items: number; developments: number }> {
  let ni = 0;
  let nd = 0;
  await d.transaction('rw', [d.items, d.images, d.developments], async () => {
    const iIds = ((await d.items.where('deletedAt').above(0).primaryKeys()) as number[]).filter((x) => sel === 'all' || (sel.items || []).includes(x));
    const dIds = ((await d.developments.where('deletedAt').above(0).primaryKeys()) as number[]).filter((x) => sel === 'all' || (sel.developments || []).includes(x));
    if (iIds.length) {
      await d.items.bulkDelete(iIds);
      await d.images.bulkDelete(iIds);
    }
    if (dIds.length) await d.developments.bulkDelete(dIds);
    ni = iIds.length;
    nd = dIds.length;
  });
  return { items: ni, developments: nd };
}
/** 回收站里超过 30 天的彻底清掉（启动后空闲时跑） */
export async function purgeExpired(d: LinganDB = db, now = Date.now(), days = TRASH_DAYS): Promise<{ items: number; developments: number }> {
  const cutoff = now - days * 86400000;
  const [iIds, dIds] = await Promise.all([d.items.where('deletedAt').between(0, cutoff, false, true).primaryKeys(), d.developments.where('deletedAt').between(0, cutoff, false, true).primaryKeys()]);
  if (!iIds.length && !dIds.length) return { items: 0, developments: 0 };
  return purgeTrash({ items: iIds as number[], developments: dIds as number[] }, d);
}

/** v0.21 有行没有 uid（直接写库、极旧备份）：补上。先用 uid 索引的条数和总数比，一样就不扫表 */
export async function ensureUids(d: LinganDB = db): Promise<number> {
  let fixed = 0;
  const dev = getDeviceId();
  for (const t of [d.items, d.developments, d.cliches] as unknown as Array<Table<Stamped, number>>) {
    const [all, withUid] = await Promise.all([t.count(), t.orderBy('uid').count()]);
    if (all === withUid) continue;
    await d.transaction('rw', t, async () => {
      await t
        .filter((x) => !isUlid(x.uid))
        .modify((x: Stamped) => {
          x.uid = ulid(typeof x.createdAt === 'number' ? x.createdAt : Date.now());
          if (!x.deviceId) x.deviceId = dev;
          if (typeof x.updatedAt !== 'number') x.updatedAt = x.createdAt || Date.now();
          fixed++;
        });
    });
  }
  return fixed;
}

/** 彻底删除一件穗（连同原图）。界面上的「删除」走 trashItems（回收站） */
export async function deleteItem(id: number, d: LinganDB = db) {
  await d.transaction('rw', d.items, d.images, async () => {
    await d.items.delete(id);
    await d.images.delete(id);
  });
}

/** v0.16 删除可撤销：删之前把行和原图拍个快照，撤销时原样放回（同一个 id，新枝的来源不断） */
export interface ItemSnapshot {
  item: Item;
  image?: StoredImage;
}
export async function snapshotItem(id: number, d: LinganDB = db): Promise<ItemSnapshot | null> {
  const item = await d.items.get(id);
  if (!item) return null;
  const image = await d.images.get(id);
  return { item, ...(image ? { image } : {}) };
}
export async function restoreItem(s: ItemSnapshot, d: LinganDB = db): Promise<number> {
  await d.transaction('rw', d.items, d.images, async () => {
    await d.items.put(s.item);
    if (s.image) await d.images.put(s.image);
  });
  return s.item.id!;
}

/** 清空所有穗、新枝、原图（连同每日一穗记录） */
export async function clearAll(d: LinganDB = db) {
  await d.transaction('rw', [d.items, d.developments, d.images, d.daily, d.ftidx, d.cliches, d.rejects, d.works], async () => {
    await d.cliches.clear();
    await d.rejects.clear();
    await d.works.clear();
    await d.items.clear();
    await d.developments.clear();
    await d.images.clear();
    await d.daily.clear();
    await d.ftidx.clear();
  });
  // v0.31：开着同步时「清空」只清本机；同步进度归零，下次同步会把云端的全拉回来（要彻底不同步先断开）
  try {
    const c = JSON.parse(localStorage.getItem('glean.sync.v1') || 'null');
    if (c?.state) {
      c.state = { seq: c.state.seq ?? null, pushed: c.state.pushed, seen: {} };
      localStorage.setItem('glean.sync.v1', JSON.stringify(c));
    }
  } catch {
    /* ignore */
  }
}

/** v0.14 碰了一下（打开详情 / 拿去嫁接）：只记 touchedAt，不算「修改」 */
export async function touchItems(ids: number[], d: LinganDB = db, now = Date.now()) {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return;
  await d.transaction('rw', d.items, async () => {
    for (const id of list) await d.items.update(id, { touchedAt: now });
  });
}

/** v0.18 这几穗刚被嫁接了一次：次数 +1、记下时间（也算「碰过」） */
export async function markGrafted(ids: number[], d: LinganDB = db, now = Date.now()) {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return;
  await d.transaction('rw', d.items, async () => {
    await d.items
      .where(':id')
      .anyOf(list)
      .modify((it: Item) => {
        it.graftCount = (it.graftCount || 0) + 1;
        it.graftedAt = now;
        it.touchedAt = now;
      });
  });
}

/** v0.14 从示例池随机抽 n 条放进穗仓（打上 sample 标记），返回新 id */
export async function addSamples(n = 10, d: LinganDB = db, rand: () => number = Math.random, now = Date.now()): Promise<number[]> {
  // v0.42 示例池是压缩包（samplepack），只在点「放几条示例」时才下载 / 解开，不进首屏
  const picks = drawSamples(n, rand, await (await import('./samplepack')).loadSamplePool());
  const times = sampleTimes(picks.length, now, rand);
  const rows: Item[] = picks.map((s, i) => ({ ...s, tags: normalizeTags(s.tags), sample: 1, graftCount: 0, createdAt: times[i], updatedAt: times[i] }));
  return (await d.items.bulkAdd(rows, { allKeys: true })) as number[];
}

/** v0.14 一键清掉示例：只删示例穗（和只由示例长出的新枝），用户自己的穗与新枝一条不动 */
export async function clearSamples(d: LinganDB = db): Promise<{ items: number; developments: number }> {
  let items = 0;
  let developments = 0;
  await d.transaction('rw', [d.items, d.developments, d.images, d.daily], async () => {
    const ids = (await d.items.where('sample').equals(1).primaryKeys()) as number[];
    if (!ids.length) return;
    const gone = new Set(ids);
    await d.items.bulkDelete(ids);
    await d.images.bulkDelete(ids);
    items = ids.length;
    const devIds = (await d.developments.toArray()).filter((dv) => dv.itemIds.length > 0 && dv.itemIds.every((x) => gone.has(x) || x < 0)).map((dv) => dv.id!);
    await d.developments.bulkDelete(devIds);
    developments = devIds.length;
    // 今天的每日一穗里有示例的话，下次打开重算
    await d.daily.clear();
  });
  return { items, developments };
}

/** v0.14 今天的每日一穗：有就读（同一天不变），没有 / 里面的穗被删了就按日期种子算一次并存下。穗不够 4 件返回 null */
export async function ensureDaily(items: Item[], d: LinganDB = db, now = Date.now()): Promise<DailyPick | null> {
  if (items.filter((i) => i.id != null).length < DAILY_COMBO) return null;
  const day = todayKey(now);
  return d.transaction('rw', [d.daily, d.developments], async () => {
    const rec = await d.daily.get(day);
    if (rec && pickStillValid(rec, items)) return rec;
    const devs = (await d.developments.toArray()).map((x) => ({ itemIds: x.itemIds, createdAt: x.createdAt }));
    const prev = await d.daily.where('day').below(day).last();
    const p = pickDaily({ items, devs, day, prev });
    if (!p) return null;
    const out: DailyPick = { ...p, createdAt: now };
    await d.daily.put(out);
    // 只留最近 60 天的记录
    const cutoff = todayKey(now - 60 * 86400000);
    await d.daily.where('day').below(cutoff).delete();
    return out;
  });
}

export interface Backup {
  app: 'lingan';
  version: 1;
  exportedAt: number;
  items: Item[];
  developments: Development[];
  /** v0.19 套路墙（旧备份没有，导入时按新枝里的套路重建） */
  cliches?: Cliche[];
}

/** 导出：原图从 images 表拼回 image（data URL），缩略图不导出（导入后重新生成）。备份格式与 v0.12 兼容 */
export async function exportAll(d: LinganDB = db): Promise<Backup> {
  const rows = await d.items.toArray();
  const items: Item[] = [];
  for (const r of rows) {
    const { thumb: _t, thumbW: _w, thumbH: _h, thumbTodo: _todo, thumbFail: _f, hasImage: _hi, ...rest } = r;
    void _t, void _w, void _h, void _todo, void _f, void _hi;
    const out: Item = { ...rest };
    if (!isDataUrl(out.image) && r.id != null) {
      const im = await d.images.get(r.id);
      if (im?.blob) out.image = await blobToDataUrl(im.blob);
      else delete out.image;
    }
    items.push(out);
  }
  const developments = await d.developments.toArray();
  const cliches = (await d.cliches.toArray()).map(({ id: _id, ...c }) => (void _id, c as Cliche));
  return { app: 'lingan', version: 1, exportedAt: Date.now(), items, developments, cliches };
}

/** 导入旧 JSON 备份对象（或 .glean 解析出来的内容），按 uid / 指纹去重合并。详见 lib/backup.ts */
export async function importAll(b: unknown, d: LinganDB = db): Promise<{ items: number; developments: number }> {
  const { importBackupObject } = await import('./backup');
  const r = await importBackupObject(b, d, 'merge');
  return { items: r.items.add + r.items.update, developments: r.developments.add + r.developments.update };
}
