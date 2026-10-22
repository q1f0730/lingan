import Dexie, { type Table } from 'dexie';
import { migrateDevelopment } from './provenance';
import { blobToDataUrl, detachInlineImage, isDataUrl, migrateInlineImages, setItemImage } from './imagestore';
import type { Development, Item, StoredImage } from './types';

export class LinganDB extends Dexie {
  items!: Table<Item, number>;
  developments!: Table<Development, number>;
  images!: Table<StoredImage, number>;
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
  const row: Item = { ...data, tags: normalizeTags(data.tags), createdAt: now, updatedAt: now };
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
  const p: Partial<Item> = { ...rest, updatedAt: Date.now() };
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

/** 清空所有穗、新枝、原图 */
export async function clearAll(d: LinganDB = db) {
  await d.transaction('rw', [d.items, d.developments, d.images], async () => {
    await d.items.clear();
    await d.developments.clear();
    await d.images.clear();
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
      m++;
    }
  });
  if (imgs) notifyImage();
  return { items: n, developments: m };
}
