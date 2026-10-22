// v0.13 千穗不卡：原图和缩略图分开存。
// - 原图：images 表（Blob），只有详情 / 编辑 / 看图 AI / 导出才读
// - 缩略图：items 行里的 thumb（约 20KB JPEG Blob），列表只读它
// - 旧数据（行里内联 data URL）：Dexie version 3 升级时搬进 images 表并标 thumbTodo，
//   打开 App 后在后台空闲时分批补缩略图；任何时候发现行里还有内联原图（旧备份、直接写库），同样就地搬走。
import type { Dexie, Table } from 'dexie';
import type { Item, StoredImage } from './types';

/** 缩略图目标：最长边 ≤ 400px（手机双列 2x 屏、桌面三列都够清楚），JPEG，尽量 ≤ 28KB */
export const THUMB_MAX = 400;
export const THUMB_QUALITY = 0.72;
export const THUMB_TARGET_BYTES = 28 * 1024;

export interface ThumbOut {
  blob: Blob;
  w: number;
  h: number;
}
/** 把原图做成缩略图。浏览器里用 canvas，单测里注入假的。 */
export type ThumbMaker = (original: Blob) => Promise<ThumbOut>;

/** 等比缩到最长边 ≤ max，不放大 */
export function thumbSize(w: number, h: number, max = THUMB_MAX): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: max, h: max };
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export function isDataUrl(s: unknown): s is string {
  return typeof s === 'string' && /^data:[^,]*,/.test(s);
}

/** data URL → Blob（同步，可在 IndexedDB 事务里用） */
export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) throw new Error('不是 data URL');
  const head = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const mime = head.split(';')[0] || 'application/octet-stream';
  if (/;base64/i.test(head)) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

/** Blob → data URL（导出备份、发给看图模型时用） */
export async function blobToDataUrl(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/**
 * 升级 / 自愈时处理一行：行里有内联原图就拿出来，行改成「有原图、待做缩略图」。
 * 返回要写进 images 表的 Blob（没有就 null）。纯函数（只改传入的对象）。
 */
export function detachInlineImage(row: Item): Blob | null {
  const img = row.image;
  if (!isDataUrl(img)) {
    if ('image' in row && !img) delete row.image;
    return null;
  }
  let blob: Blob;
  try {
    blob = dataUrlToBlob(img);
  } catch {
    return null; // 解不开就原样留着，不丢
  }
  delete row.image;
  row.hasImage = 1;
  row.thumbTodo = 1;
  delete row.thumb;
  delete row.thumbW;
  delete row.thumbH;
  delete row.thumbFail;
  return blob;
}

/** 有图吗（新旧格式都认） */
export function itemHasImage(it: Pick<Item, 'hasImage' | 'image' | 'thumb'>): boolean {
  return !!(it.hasImage || it.thumb || isDataUrl(it.image));
}

type ImgDB = Pick<Dexie, 'transaction'> & {
  items: Table<Item, number>;
  images: Table<StoredImage, number>;
};

/** v0.13 升级脚本主体：分块搬旧行里的原图（一次只拿 50 行，低内存机器也扛得住） */
export async function migrateInlineImages(items: Table<Item, number>, images: Table<StoredImage, number>, chunk = 50): Promise<number> {
  const keys = (await items.toCollection().primaryKeys()) as number[];
  let moved = 0;
  for (let k = 0; k < keys.length; k += chunk) {
    const rows = await items.bulkGet(keys.slice(k, k + chunk));
    const put: Item[] = [];
    const imgs: StoredImage[] = [];
    for (const r of rows) {
      if (!r || r.id == null) continue;
      if (!('image' in r)) continue;
      const blob = detachInlineImage(r);
      put.push(r);
      if (blob) {
        imgs.push({ itemId: r.id, blob });
        moved++;
      }
    }
    if (imgs.length) await images.bulkPut(imgs);
    if (put.length) await items.bulkPut(put);
  }
  return moved;
}

/** 给一件穗设 / 换 / 删原图（换了就重新排队做缩略图） */
export async function setItemImage(d: ImgDB, id: number, image: string | Blob | undefined | null): Promise<void> {
  await d.transaction('rw', d.items, d.images, async () => {
    if (!image) {
      await d.images.delete(id);
      await d.items.update(id, { image: undefined, hasImage: undefined, thumb: undefined, thumbW: undefined, thumbH: undefined, thumbTodo: undefined, thumbFail: undefined } as Partial<Item>);
      return;
    }
    const blob = typeof image === 'string' ? dataUrlToBlob(image) : image;
    await d.images.put({ itemId: id, blob });
    await d.items.update(id, { image: undefined, hasImage: 1, thumbTodo: 1, thumb: undefined, thumbW: undefined, thumbH: undefined, thumbFail: undefined } as Partial<Item>);
  });
}

export async function getOriginalBlob(d: Pick<ImgDB, 'images' | 'items'>, id: number): Promise<Blob | null> {
  const r = await d.images.get(id);
  if (r?.blob) return r.blob;
  const it = await d.items.get(id);
  if (it && isDataUrl(it.image)) return dataUrlToBlob(it.image);
  return null;
}

export async function getOriginalDataUrl(d: Pick<ImgDB, 'images' | 'items'>, id: number): Promise<string | undefined> {
  const it = await d.items.get(id);
  if (it && isDataUrl(it.image)) return it.image;
  const r = await d.images.get(id);
  return r?.blob ? blobToDataUrl(r.blob) : undefined;
}

export interface HealReport {
  detached: number;
  made: number;
  failed: number;
  left: number;
}

/**
 * 后台补缩略图：先把行里残留的内联原图搬进 images 表，再按 thumbTodo 索引分批做缩略图。
 * 每批一个事务写回（列表 liveQuery 每批只刷新一次）；批与批之间 yieldFn 让出主线程。
 */
export async function healImages(
  d: ImgDB,
  make: ThumbMaker,
  opts: { batch?: number; yieldFn?: () => Promise<void>; shouldStop?: () => boolean; onProgress?: (r: HealReport) => void } = {},
): Promise<HealReport> {
  const batch = opts.batch ?? 8;
  const rep: HealReport = { detached: 0, made: 0, failed: 0, left: 0 };
  // 1) 残留内联原图（v0.12 备份导入、旧代码直接写库……）
  const inline = (await d.items.filter((i) => isDataUrl(i.image)).primaryKeys()) as number[];
  for (let k = 0; k < inline.length; k += batch) {
    await d.transaction('rw', d.items, d.images, async () => {
      const rows = await d.items.bulkGet(inline.slice(k, k + batch));
      for (const r of rows) {
        if (!r || r.id == null) continue;
        const blob = detachInlineImage(r);
        if (!blob) continue;
        await d.images.put({ itemId: r.id, blob });
        await d.items.put(r);
        rep.detached++;
      }
    });
    if (opts.yieldFn) await opts.yieldFn();
  }
  // 2) 待做缩略图
  for (;;) {
    if (opts.shouldStop?.()) break;
    const todo = await d.items.where('thumbTodo').equals(1).limit(batch).toArray();
    if (!todo.length) break;
    const results: Array<{ id: number; out?: ThumbOut }> = [];
    for (const it of todo) {
      const id = it.id!;
      const orig = await d.images.get(id);
      if (!orig?.blob) {
        results.push({ id });
        continue;
      }
      try {
        results.push({ id, out: await make(orig.blob) });
      } catch {
        results.push({ id });
      }
    }
    await d.transaction('rw', d.items, d.images, async () => {
      for (const r of results) {
        const cur = await d.items.get(r.id);
        if (!cur || !cur.thumbTodo) continue; // 期间被删 / 换图（换图会重新排队）
        if (r.out) {
          await d.items.update(r.id, { thumb: r.out.blob, thumbW: r.out.w, thumbH: r.out.h, thumbTodo: undefined, thumbFail: undefined } as Partial<Item>);
          rep.made++;
        } else {
          const has = !!(await d.images.get(r.id));
          await d.items.update(r.id, { thumbTodo: undefined, thumbFail: 1, ...(has ? {} : { hasImage: undefined }) } as Partial<Item>);
          rep.failed++;
        }
      }
    });
    opts.onProgress?.(rep);
    if (opts.yieldFn) await opts.yieldFn();
  }
  rep.left = await d.items.where('thumbTodo').equals(1).count();
  return rep;
}

/** 浏览器里的缩略图：createImageBitmap 解码（不进 DOM），canvas 缩放，JPEG 编码；超过目标大小再压一次 */
export const browserThumbMaker: ThumbMaker = async (original) => {
  let src: CanvasImageSource & { width: number; height: number };
  let close = () => {};
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(original);
    src = bmp;
    close = () => bmp.close();
  } else {
    const url = URL.createObjectURL(original);
    try {
      src = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('decode'));
        im.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
  try {
    const { w, h } = thumbSize(src.width, src.height);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) throw new Error('no 2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    const enc = (q: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', q));
    let blob = await enc(THUMB_QUALITY);
    if (blob.size > THUMB_TARGET_BYTES) blob = await enc(0.55);
    return { blob, w, h };
  } finally {
    close();
  }
};
