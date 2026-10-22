import Dexie, { type Table } from 'dexie';
import { DAILY_COMBO, pickDaily, pickStillValid, todayKey } from './daily';
import { graftStatsFromDevs } from './modes';
import { migrateDevelopment } from './provenance';
import { drawSamples, sampleTimes } from './samples';
import { blobToDataUrl, detachInlineImage, isDataUrl, migrateInlineImages, setItemImage } from './imagestore';
import type { DailyPick, Development, FtRow, Item, StoredImage } from './types';

export class LinganDB extends Dexie {
  items!: Table<Item, number>;
  developments!: Table<Development, number>;
  images!: Table<StoredImage, number>;
  daily!: Table<DailyPick, string>;
  ftidx!: Table<FtRow, string>;
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
  }
}

export const db = new LinganDB();

export function normalizeTags(input: string | string[]): string[] {
  const arr = Array.isArray(input) ? input : input.split(/[,，、\s#]+/);
  const out: string[] = [];
  for (const t of arr) {
    const s = t.trim().replace(/^#/, '');
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

/** 新增一件穗：有图时原图进 images 表，行里只标「待做缩略图」 */
export async function addItem(data: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>, d: LinganDB = db): Promise<number> {
  const now = Date.now();
  const row: Item = { graftCount: 0, ...data, tags: normalizeTags(data.tags), createdAt: now, updatedAt: now };
  delete row.thumb;
  delete row.thumbW;
  delete row.thumbH;
  delete row.thumbTodo;
  delete row.thumbFail;
  delete row.hasImage;
  let id = 0;
  let had = false;
  await d.transaction('rw', d.items, d.images, async () => {
    const blob = detachInlineImage(row);
    if (!blob) delete row.image;
    id = await d.items.add(row);
    if (blob) {
      await d.images.put({ itemId: id, blob });
      had = true;
    }
  });
  if (had) notifyImage();
  return id;
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
  }
}

/** 删除一件穗（连同原图） */
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
  await d.transaction('rw', [d.items, d.developments, d.images, d.daily, d.ftidx], async () => {
    await d.items.clear();
    await d.developments.clear();
    await d.images.clear();
    await d.daily.clear();
    await d.ftidx.clear();
  });
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
  const picks = drawSamples(n, rand);
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
  return { app: 'lingan', version: 1, exportedAt: Date.now(), items, developments };
}

/** Merge import: items are re-added with new ids; developments are remapped. Returns counts. */
export async function importAll(b: unknown, d: LinganDB = db): Promise<{ items: number; developments: number }> {
  if (!b || typeof b !== 'object' || (b as Backup).app !== 'lingan' || !Array.isArray((b as Backup).items)) {
    throw new Error('不是拾穗（灵感暗房）的备份文件');
  }
  const bk = b as Backup;
  const map = new Map<number, number>();
  let n = 0;
  let m = 0;
  let imgs = 0;
  const noCount: number[] = [];
  const added: Development[] = [];
  await d.transaction('rw', [d.items, d.developments, d.images], async () => {
    for (const it of bk.items) {
      if (!it || typeof it.title !== 'string' || !it.type) continue;
      const { id, thumb: _t, thumbW: _w, thumbH: _h, thumbTodo: _todo, thumbFail: _f, hasImage: _hi, ...rest } = it;
      void _t, void _w, void _h, void _todo, void _f, void _hi;
      const row: Item = { ...rest, tags: normalizeTags(rest.tags || []), createdAt: rest.createdAt || Date.now(), updatedAt: Date.now() };
      const blob = detachInlineImage(row);
      if (!blob) delete row.image;
      const nid = await d.items.add(row);
      if (blob) {
        await d.images.put({ itemId: nid, blob });
        imgs++;
      }
      if (typeof id === 'number') map.set(id, nid);
      if (typeof rest.graftCount !== 'number') noCount.push(nid);
      n++;
    }
    for (const dv of bk.developments || []) {
      if (!dv || !dv.idea) continue;
      const { id: _id, ...rest } = dv;
      void _id;
      // 素材 id 换成新 id；找不到的保留为 -1 占位，这样 refs（位置）仍然对得上
      const nd: Development = { ...rest, itemIds: (rest.itemIds || []).map((x) => map.get(x) ?? -1) };
      migrateDevelopment(nd);
      await d.developments.add(nd);
      added.push(nd);
      m++;
    }
    // v0.18 旧备份没有嫁接次数：按一起导入的新枝回填，没有就补 0
    if (noCount.length) {
      const stats = graftStatsFromDevs(added);
      for (const nid of noCount) {
        const st = stats.get(nid);
        await d.items.update(nid, st ? { graftCount: st.count, graftedAt: st.last } : { graftCount: 0 });
      }
    }
  });
  if (imgs) notifyImage();
  return { items: n, developments: m };
}
