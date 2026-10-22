import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { addItem, deleteItem, exportAll, importAll, LinganDB, updateItem } from '../lib/db';
import {
  blobToDataUrl,
  dataUrlToBlob,
  detachInlineImage,
  getOriginalBlob,
  getOriginalDataUrl,
  healImages,
  isDataUrl,
  itemHasImage,
  thumbSize,
  type ThumbMaker,
} from '../lib/imagestore';
import type { Item } from '../lib/types';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
// 假图片：内容是可辨认的字节，方便核对「原图一字节没丢」
function fakeJpeg(tag: string, kb = 3): string {
  const body = tag.padEnd(kb * 1024, '#');
  return 'data:image/jpeg;base64,' + btoa(body);
}
// 假缩略图机：读原图前 8 个字节当「像素」，输出一个小 Blob，宽高按 thumbSize 算（原图假定 1600×1200）
const fakeMaker: ThumbMaker = async (b) => {
  const head = new TextDecoder().decode(new Uint8Array(await b.arrayBuffer()).slice(0, 8));
  if (head.startsWith('BROKEN')) throw new Error('decode');
  const { w, h } = thumbSize(1600, 1200);
  return { blob: new Blob(['thumb:' + head], { type: 'image/jpeg' }), w, h };
};

describe('thumbnail maths and data URL helpers', () => {
  it('thumbSize keeps aspect ratio, never upscales, caps the long side at 400', () => {
    expect(thumbSize(1600, 1200)).toEqual({ w: 400, h: 300 });
    expect(thumbSize(900, 3000)).toEqual({ w: 120, h: 400 });
    expect(thumbSize(320, 200)).toEqual({ w: 320, h: 200 });
    expect(thumbSize(0, 0)).toEqual({ w: 400, h: 400 });
    expect(thumbSize(4000, 1, 400)).toEqual({ w: 400, h: 1 });
  });
  it('round-trips data URL ↔ Blob byte for byte', async () => {
    const u = fakeJpeg('roundtrip');
    const b = dataUrlToBlob(u);
    expect(b.type).toBe('image/jpeg');
    expect(b.size).toBe(3 * 1024);
    expect(await blobToDataUrl(b)).toBe(u);
    expect(isDataUrl(u)).toBe(true);
    expect(isDataUrl('https://x/y.jpg')).toBe(false);
    expect(() => dataUrlToBlob('nope')).toThrow();
    // 很大的图（> 一次 fromCharCode 的分块）也不能出错
    const big = fakeJpeg('big', 300);
    expect(await blobToDataUrl(dataUrlToBlob(big))).toBe(big);
  });
  it('detachInlineImage moves the original out of the row and queues a thumbnail', () => {
    const row: Item = { id: 3, type: 'image', title: 't', tags: [], image: fakeJpeg('a'), createdAt: 1, updatedAt: 1 };
    const blob = detachInlineImage(row);
    expect(blob?.size).toBe(3 * 1024);
    expect(row.image).toBeUndefined();
    expect(row.hasImage).toBe(1);
    expect(row.thumbTodo).toBe(1);
    expect(itemHasImage(row)).toBe(true);
    const plain: Item = { id: 4, type: 'text', title: 't', tags: [], createdAt: 1, updatedAt: 1 };
    expect(detachInlineImage(plain)).toBeNull();
    expect(plain.hasImage).toBeUndefined();
    expect(itemHasImage(plain)).toBe(false);
    // 解不开的 data URL：原样留着，不丢
    const bad: Item = { id: 5, type: 'image', title: 't', tags: [], image: 'data:image/jpeg;base64,@@@', createdAt: 1, updatedAt: 1 };
    expect(detachInlineImage(bad)).toBeNull();
    expect(bad.image).toBe('data:image/jpeg;base64,@@@');
  });
});

describe('Dexie v2 → v3 migration: originals move to their own table, nothing lost', () => {
  async function makeV2(name: string, n: number, everyNthImage: number) {
    const v2 = new Dexie(name);
    v2.version(1).stores({ items: '++id, type, createdAt, updatedAt, *tags', developments: '++id, createdAt, starred' });
    v2.version(2).stores({ developments: '++id, createdAt, starred, evidence' });
    await v2.open();
    const rows = Array.from({ length: n }, (_, i) => ({
      type: i % everyNthImage === 0 ? 'image' : 'text',
      title: `穗 ${i}`,
      content: `第 ${i} 句`,
      tags: [`t${i % 7}`],
      ...(i % everyNthImage === 0 ? { image: fakeJpeg(`img-${i}`, 2) } : {}),
      createdAt: 1000 + i,
      updatedAt: 1000 + i,
    }));
    await v2.table('items').bulkAdd(rows);
    await v2.table('developments').add({ itemIds: [1, 2, 3], jump: 0.5, idea: { title: '旧枝', bridge: '', idea: 'x', cliches: [], refs: [1, 2, 3] }, source: 'ai', evidence: 'ok', createdAt: 5 });
    v2.close();
    return rows;
  }

  it('upgrades 120 items (40 images) in place and keeps every byte of every original', async () => {
    const name = uniq('v3mig');
    const rows = await makeV2(name, 120, 3);
    const d = new LinganDB(name);
    await d.open();
    expect(d.verno).toBe(5); // v0.17 起是 5（秒搜索引表），v3 的迁移仍会跑
    expect(await d.items.count()).toBe(120);
    expect(await d.images.count()).toBe(40);
    expect(await d.developments.count()).toBe(1);
    const all = await d.items.orderBy('createdAt').toArray();
    // 列表行里不再有内联原图
    expect(all.some((x) => 'image' in x)).toBe(false);
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      expect(it.title).toBe(rows[i].title);
      expect(it.tags).toEqual(rows[i].tags);
      if (rows[i].image) {
        expect(it.hasImage).toBe(1);
        expect(it.thumbTodo).toBe(1);
        expect(await getOriginalDataUrl(d, it.id!)).toBe(rows[i].image);
      } else {
        expect(it.hasImage).toBeUndefined();
        expect(await d.images.get(it.id!)).toBeUndefined();
      }
    }
    expect(await d.items.where('thumbTodo').equals(1).count()).toBe(40);
    d.close();
  });

  it('background heal makes every thumbnail in batches, then nothing is left to do', async () => {
    const name = uniq('v3heal');
    await makeV2(name, 30, 2);
    const d = new LinganDB(name);
    let yields = 0;
    const rep = await healImages(d, fakeMaker, { batch: 4, yieldFn: async () => void yields++ });
    expect(rep).toMatchObject({ made: 15, failed: 0, left: 0 });
    expect(yields).toBeGreaterThanOrEqual(4); // 15 张 / 每批 4 = 4 批
    const imgs = await d.items.filter((x) => !!x.hasImage).toArray();
    expect(imgs).toHaveLength(15);
    for (const it of imgs) {
      expect(it.thumb).toBeInstanceOf(Blob);
      expect(it.thumbW).toBe(400);
      expect(it.thumbH).toBe(300);
      expect(it.thumbTodo).toBeUndefined();
      const t = await it.thumb!.text();
      expect(t.startsWith('thumb:img-')).toBe(true);
      // 原图仍在
      expect((await getOriginalBlob(d, it.id!))!.size).toBe(2 * 1024);
    }
    // 再跑一次什么也不做
    expect(await healImages(d, fakeMaker)).toMatchObject({ made: 0, failed: 0, detached: 0, left: 0 });
    d.close();
  });

  it('a broken original is marked failed (no endless retry) and keeps its bytes', async () => {
    const d = new LinganDB(uniq('broken'));
    const id = await addItem({ type: 'image', title: '坏图', tags: [], image: fakeJpeg('BROKEN!!') }, d);
    const rep = await healImages(d, fakeMaker);
    expect(rep).toMatchObject({ made: 0, failed: 1, left: 0 });
    const it = (await d.items.get(id))!;
    expect(it.thumbFail).toBe(1);
    expect(it.thumbTodo).toBeUndefined();
    expect(it.hasImage).toBe(1);
    expect(await getOriginalDataUrl(d, id)).toBe(fakeJpeg('BROKEN!!'));
    d.close();
  });

  it('heals inline originals written straight into a v3 row (old code paths / old backups)', async () => {
    const d = new LinganDB(uniq('inline'));
    const id = await d.items.add({ type: 'image', title: '直接写库', tags: [], image: fakeJpeg('inline'), createdAt: 1, updatedAt: 1 });
    const rep = await healImages(d, fakeMaker);
    expect(rep).toMatchObject({ detached: 1, made: 1, left: 0 });
    const it = (await d.items.get(id))!;
    expect(it.image).toBeUndefined();
    expect(it.thumb).toBeInstanceOf(Blob);
    expect(await getOriginalDataUrl(d, id)).toBe(fakeJpeg('inline'));
    d.close();
  });
});

describe('item writes keep the original and the thumbnail apart', () => {
  it('addItem stores the original in images and queues a thumb; replace / remove / delete work', async () => {
    const d = new LinganDB(uniq('crud'));
    const id = await addItem({ type: 'image', title: '新图', tags: ['a'], image: fakeJpeg('one') }, d);
    let it = (await d.items.get(id))!;
    expect(it.image).toBeUndefined();
    expect(it.hasImage).toBe(1);
    expect(it.thumbTodo).toBe(1);
    expect(await getOriginalDataUrl(d, id)).toBe(fakeJpeg('one'));
    await healImages(d, fakeMaker);
    it = (await d.items.get(id))!;
    expect(await it.thumb!.text()).toBe('thumb:one#####');

    // 不带 image 键的编辑：不碰图
    await updateItem(id, { title: '改名' }, d);
    it = (await d.items.get(id))!;
    expect(it.title).toBe('改名');
    expect(it.thumb).toBeInstanceOf(Blob);
    expect(await getOriginalDataUrl(d, id)).toBe(fakeJpeg('one'));

    // 换图：原图换掉、旧缩略图作废、重新排队
    await updateItem(id, { image: fakeJpeg('two') }, d);
    it = (await d.items.get(id))!;
    expect(it.thumb).toBeUndefined();
    expect(it.thumbTodo).toBe(1);
    expect(await getOriginalDataUrl(d, id)).toBe(fakeJpeg('two'));
    await healImages(d, fakeMaker);
    expect(await (await d.items.get(id))!.thumb!.text()).toBe('thumb:two#####');

    // 删图
    await updateItem(id, { image: undefined }, d);
    it = (await d.items.get(id))!;
    expect(itemHasImage(it)).toBe(false);
    expect(await d.images.count()).toBe(0);

    // 删穗连原图一起删
    const id2 = await addItem({ type: 'image', title: '再来', tags: [], image: fakeJpeg('three') }, d);
    expect(await d.images.count()).toBe(1);
    await deleteItem(id2, d);
    expect(await d.images.count()).toBe(0);
    expect(await d.items.get(id2)).toBeUndefined();
    d.close();
  });

  it('export puts originals back as data URLs (v0.12-compatible backup) and import splits them again', async () => {
    const d1 = new LinganDB(uniq('exp'));
    await addItem({ type: 'image', title: '甲', tags: [], image: fakeJpeg('jia') }, d1);
    await addItem({ type: 'text', title: '乙', content: '一句话', tags: [] }, d1);
    await healImages(d1, fakeMaker);
    const bk = JSON.parse(JSON.stringify(await exportAll(d1)));
    expect(bk.version).toBe(1);
    const jia = bk.items.find((x: Item) => x.title === '甲');
    expect(jia.image).toBe(fakeJpeg('jia'));
    expect(jia.thumb).toBeUndefined();
    expect(jia.hasImage).toBeUndefined();
    expect(bk.items.find((x: Item) => x.title === '乙').image).toBeUndefined();

    const d2 = new LinganDB(uniq('imp'));
    expect(await importAll(bk, d2)).toEqual({ items: 2, developments: 0 });
    const rows = await d2.items.toArray();
    expect(rows.some((x) => 'image' in x)).toBe(false);
    const j2 = rows.find((x) => x.title === '甲')!;
    expect(j2.thumbTodo).toBe(1);
    expect(await getOriginalDataUrl(d2, j2.id!)).toBe(fakeJpeg('jia'));
    expect((await healImages(d2, fakeMaker)).made).toBe(1);
    d1.close();
    d2.close();
  });
});
