import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  addItem,
  alive,
  depositCliches,
  ensureUids,
  exportAll,
  importAll,
  liveCounts,
  liveItems,
  LinganDB,
  listTrash,
  purgeExpired,
  purgeTrash,
  touchItems,
  trashDevelopments,
  trashItems,
  untrashItems,
  updateItem,
} from '../lib/db';
import { applyImport, BlobSink, exportGlean, itemFingerprint, planImport, previewImport, readBackupFile, readGlean, type GleanManifest } from '../lib/backup';
import { FtSync } from '../lib/ftsync';
import { isUlid, ulid, ulidTime } from '../lib/ulid';
import { Sha256, sha256Hex } from '../lib/sha256';
import { crc32, crc32Update, readZip } from '../lib/zip';
import { getDeviceId } from '../lib/device';
import { buildVault } from '../lib/obsidian';
import type { Development, Item } from '../lib/types';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
function jpeg(tag: string, kb = 2): string {
  return 'data:image/jpeg;base64,' + btoa('\xff\xd8' + tag.padEnd(kb * 1024, '#'));
}
const dev = (itemIds: number[], title: string, createdAt = 1_700_000_000_000): Development => ({
  itemIds,
  jump: 0.5,
  idea: { title, bridge: 'b', idea: `${title} 正文`, cliches: ['老套路'], refs: itemIds.map((_, i) => i + 1), evidence: 'ok' },
  evidence: 'ok',
  source: 'offline',
  createdAt,
});

async function seed(d: LinganDB) {
  const a = await addItem({ type: 'film', title: '重庆森林', creator: '王家卫', why: '罐头', tags: ['香港'] }, d);
  const b = await addItem({ type: 'image', title: '雨后的操场', image: jpeg('rain'), tags: [] }, d);
  const c = await addItem({ type: 'image', title: '同一张图', image: jpeg('rain'), tags: [] }, d);
  const e = await addItem({ type: 'music', title: '晴天', creator: '周杰伦', tags: ['夏天'] }, d);
  const gone = await addItem({ type: 'idea', title: '删掉的念头', tags: [] }, d);
  await d.developments.add(dev([a, b, e], '小票上的情书'));
  await d.developments.add(dev([e, c, a], '咳嗽副歌', 1_700_000_100_000));
  await depositCliches(['老套路', '霓虹'], d);
  await trashItems([gone], d);
  return { a, b, c, e, gone };
}

async function exportBlob(d: LinganDB) {
  const sink = new BlobSink();
  const stats = await exportGlean(sink, d, { now: 1_760_000_000_000, appVersion: 'test' });
  return { blob: sink.blob(), stats, sink };
}

describe('ULID', () => {
  it('26 位 Crockford Base32，按时间排序，同一毫秒内单调', () => {
    const t = 1_761_000_000_000;
    const ids = Array.from({ length: 2000 }, () => ulid(t));
    expect(ids.every(isUlid)).toBe(true);
    expect(new Set(ids).size).toBe(2000);
    expect([...ids].sort()).toEqual(ids);
    expect(ulidTime(ids[0])).toBe(t);
    expect(ulid(t + 1) > ids[ids.length - 1]).toBe(true);
    expect(ulid(5) < ulid(t)).toBe(true);
    expect(isUlid('not-a-ulid')).toBe(false);
  });
});

describe('SHA-256 / CRC 分块', () => {
  it('纯 JS 实现与标准向量、WebCrypto 一致，分块与整块一致', async () => {
    expect(new Sha256().update(enc.encode('abc')).hex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(new Sha256().hex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const big = new Uint8Array(200_003).map((_, i) => (i * 31 + 7) & 255);
    const h = new Sha256();
    for (let i = 0; i < big.length; i += 777) h.update(big.subarray(i, i + 777));
    expect(h.hex()).toBe(await sha256Hex(big));
    let c = 0;
    for (let i = 0; i < big.length; i += 1000) c = crc32Update(c, big.subarray(i, i + 1000));
    expect(c).toBe(crc32(big));
  });
});

describe('v0.21 uid / updatedAt / deviceId 自动盖章', () => {
  it('新建盖 uid + deviceId；改内容更新 updatedAt，碰一下 / 缩略图不算修改', async () => {
    const d = new LinganDB(uniq('stamp'));
    const id = await addItem({ type: 'text', title: '一句话', tags: [] }, d);
    const it = (await d.items.get(id))!;
    expect(isUlid(it.uid)).toBe(true);
    expect(it.deviceId).toBe(getDeviceId());
    const t0 = it.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await touchItems([id], d);
    await d.items.update(id, { thumbTodo: 1 });
    expect((await d.items.get(id))!.updatedAt).toBe(t0);
    await d.items.update(id, { why: '因为' });
    const after = (await d.items.get(id))!;
    expect(after.updatedAt).toBeGreaterThan(t0);
    expect(after.uid).toBe(it.uid);
    const did = await d.developments.add(dev([id], '一根'));
    const dv = (await d.developments.get(did))!;
    expect(isUlid(dv.uid)).toBe(true);
    expect(dv.updatedAt).toBe(dv.createdAt);
    await depositCliches(['某个梗'], d);
    expect(isUlid((await d.cliches.toArray())[0].uid)).toBe(true);
    // uid 唯一索引
    await expect(d.items.add({ type: 'text', title: 'x', tags: [], createdAt: 1, updatedAt: 1, uid: it.uid })).rejects.toThrow();
  });

  it('直接写库没带 uid 的行：ensureUids 补上，已有的不动', async () => {
    const d = new LinganDB(uniq('ensure'));
    const id = await addItem({ type: 'text', title: 'a', tags: [] }, d);
    const u = (await d.items.get(id))!.uid;
    // 绕过钩子：模拟 e2e / 旧代码直接 put 一行没有 uid 的
    await d.items.put({ id: 99, type: 'text', title: 'raw', tags: [], createdAt: 5, updatedAt: 5 } as Item);
    await d.items.where(':id').equals(99).modify((x: Item) => {
      delete x.uid;
    });
    expect((await d.items.get(99))!.uid).toBeUndefined();
    expect(await ensureUids(d)).toBe(1);
    expect(isUlid((await d.items.get(99))!.uid)).toBe(true);
    expect((await d.items.get(id))!.uid).toBe(u);
    expect(await ensureUids(d)).toBe(0);
  });
});

describe('v0.21 墓碑 / 回收站', () => {
  it('删除只立墓碑：列表、计数、索引都看不到；恢复后原图与来源都在；30 天后彻底清', async () => {
    const d = new LinganDB(uniq('trash'));
    const ft = new FtSync(d);
    ft.attach();
    const { a, b, gone } = await seed(d);
    await ft.reconcile();
    expect((await liveItems(d)).map((x) => x.id)).not.toContain(gone);
    expect(ft.index.size).toBe(4 + 2);
    await trashItems([b], d, Date.now());
    await ft.settle();
    expect(ft.index.size).toBe(3 + 2);
    const c = await liveCounts(d);
    expect(c).toMatchObject({ items: 3, devs: 2, trash: 2 });
    expect(c.imgs).toBe(1);
    expect(await d.images.get(b)).toBeTruthy();
    const tr = await listTrash(d);
    expect(tr.items.map((x) => x.id)).toEqual([b, gone]);
    await untrashItems([b], d);
    await ft.settle();
    expect(ft.index.size).toBe(4 + 2);
    expect(alive(await d.items.get(b))).toBe(true);
    // 新枝也进回收站
    const did = (await d.developments.toArray())[0].id!;
    await trashDevelopments([did], d);
    expect((await listTrash(d)).developments.length).toBe(1);
    // 30 天：gone 被删于现在 → 31 天后清掉（连原图）
    const r = await purgeExpired(d, Date.now() + 31 * 86400000);
    expect(r).toEqual({ items: 1, developments: 1 });
    expect(await d.items.get(gone)).toBeUndefined();
    expect(await d.items.get(a)).toBeTruthy();
    // 只清回收站里的
    expect(await purgeTrash({ items: [a] }, d)).toEqual({ items: 0, developments: 0 });
    expect(await d.items.get(a)).toBeTruthy();
  });
});

describe('v0.21 .glean 流式备份', () => {
  it('ZIP 结构：manifest + data.jsonl + images/<sha256>（同图只存一份），CRC 与哈希都对；原图以 Blob 原样交给 sink', async () => {
    const d = new LinganDB(uniq('glean'));
    await seed(d);
    const { blob, stats, sink } = await exportBlob(d);
    expect(stats).toMatchObject({ items: 5, developments: 2, cliches: 2, images: 1, trashed: 1 });
    // 原图那块是库里的 Blob 本身，不是复制出来的字节
    expect(sink.parts.filter((p) => p instanceof Blob).length).toBe(1);
    const files = readZip(new Uint8Array(await blob.arrayBuffer()));
    expect(files.every((f) => f.crcOk && f.utf8Flag)).toBe(true);
    const paths = files.map((f) => f.path);
    expect(paths[0]).toMatch(/^images\/[0-9a-f]{64}\.jpg$/);
    expect(paths.slice(1)).toEqual(['data.jsonl', 'manifest.json']);
    const man = JSON.parse(new TextDecoder().decode(files.find((f) => f.path === 'manifest.json')!.data)) as GleanManifest;
    expect(man).toMatchObject({ format: 'glean', formatVersion: 1, schema: 11, deviceId: getDeviceId(), counts: { items: 5, developments: 2, cliches: 2, images: 1, trashedItems: 1 } });
    for (const f of files.filter((x) => x.path !== 'manifest.json')) expect(man.files[f.path].sha256).toBe(await sha256Hex(f.data));
    expect(paths[0]).toBe(`images/${man.files[paths[0]].sha256}.jpg`);
    const lines = new TextDecoder()
      .decode(files.find((f) => f.path === 'data.jsonl')!.data)
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.t)).toEqual(['item', 'item', 'item', 'item', 'item', 'dev', 'dev', 'cliche', 'cliche']);
    expect(lines.filter((l) => l.imageRef === paths[0]).length).toBe(2);
    for (const l of lines.filter((x) => x.t === 'item')) {
      expect(isUlid(l.uid)).toBe(true);
      expect(l.id).toBeUndefined();
      expect(l.thumb).toBeUndefined();
      expect(l.image).toBeUndefined();
    }
    expect(lines.find((l) => l.t === 'dev').itemUids.every(isUlid)).toBe(true);
  });

  it('导入到空库：条数、原图字节、新枝来源（按 uid 对回）、回收站状态都一样', async () => {
    const d1 = new LinganDB(uniq('g1'));
    const ids = await seed(d1);
    const { blob } = await exportBlob(d1);
    const d2 = new LinganDB(uniq('g2'));
    await d2.items.add({ type: 'text', title: '对面本来就有的', tags: [], createdAt: 1, updatedAt: 1 }); // 让本机 id 错开
    const inc = await readBackupFile(blob);
    expect(inc.format).toBe('glean');
    const plan = await planImport(inc, d2, 'merge');
    expect(plan.counts.items).toEqual({ add: 4, update: 0, skip: 1, trash: 0 }); // 回收站里的、本机没有的不导
    const r = await applyImport(inc, plan, d2);
    expect(r.badImages).toBe(0);
    const src = await d1.items.toArray();
    const dst = await d2.items.toArray();
    for (const s of src.filter(alive)) {
      const t = dst.find((x) => x.uid === s.uid)!;
      expect(t).toBeTruthy();
      expect([t.title, t.why, t.tags, t.createdAt, t.updatedAt, t.deviceId]).toEqual([s.title, s.why, s.tags, s.createdAt, s.updatedAt, s.deviceId]);
      const si = await d1.images.get(s.id!);
      const ti = await d2.images.get(t.id!);
      if (si) expect(hex(new Uint8Array(await ti!.blob.arrayBuffer()))).toBe(hex(new Uint8Array(await si.blob.arrayBuffer())));
      else expect(ti).toBeUndefined();
    }
    const titleOf = new Map(dst.map((x) => [x.id, x.title]));
    const d2devs = await d2.developments.orderBy('createdAt').toArray();
    expect(d2devs.map((x) => x.itemIds.map((i) => titleOf.get(i)))).toEqual([
      ['重庆森林', '雨后的操场', '晴天'],
      ['晴天', '同一张图', '重庆森林'],
    ]);
    expect((await d2.cliches.toArray()).map((c) => c.key).sort()).toEqual(['老套路', '霓虹'].sort());
    expect(ids.gone).toBeTruthy();
  });

  it('同一份导两次：按 uid 全部认出，一条不重复', async () => {
    const d1 = new LinganDB(uniq('dup1'));
    await seed(d1);
    const { blob } = await exportBlob(d1);
    const d2 = new LinganDB(uniq('dup2'));
    await applyImport(await readBackupFile(blob), await planImport(await readBackupFile(blob), d2), d2);
    const n = await d2.items.count();
    const inc = await readBackupFile(blob);
    const pv = await previewImport(inc, d2);
    expect(pv.merge.items).toEqual({ add: 0, update: 0, skip: 5, trash: 0 });
    expect(pv.missing.items.add).toBe(0);
    await applyImport(inc, await planImport(inc, d2, 'merge'), d2);
    expect(await d2.items.count()).toBe(n);
    expect(await d2.developments.count()).toBe(2);
    expect(await d2.images.count()).toBe(2);
  });

  it('合并：较新的覆盖；只补缺：已有的不动；替换：本机多出来的进回收站（可恢复）', async () => {
    const d1 = new LinganDB(uniq('m1'));
    const { a } = await seed(d1);
    const d2 = new LinganDB(uniq('m2'));
    const first = await readBackupFile((await exportBlob(d1)).blob);
    await applyImport(first, await planImport(first, d2), d2);
    const localOnly = await addItem({ type: 'text', title: '只在 d2 上', tags: [] }, d2);
    await new Promise((r) => setTimeout(r, 5));
    await updateItem(a, { why: '在 d1 上改过' }, d1);
    const inc = await readBackupFile((await exportBlob(d1)).blob);
    const pv = await previewImport(inc, d2);
    expect(pv.merge.items).toMatchObject({ add: 0, update: 1, trash: 0 });
    expect(pv.missing.items).toMatchObject({ add: 0, update: 0 });
    expect(pv.replace.items).toEqual({ add: 0, update: 4, skip: 1, trash: 1 }); // 备份回收站里那件本机没有：不导
    const uidA = (await d1.items.get(a))!.uid;
    await applyImport(inc, await planImport(inc, d2, 'missing'), d2);
    expect((await d2.items.where('uid').equals(uidA!).first())!.why).toBe('罐头');
    await applyImport(inc, await planImport(inc, d2, 'merge'), d2);
    expect((await d2.items.where('uid').equals(uidA!).first())!.why).toBe('在 d1 上改过');
    await applyImport(inc, await planImport(inc, d2, 'replace'), d2);
    expect((await d2.items.get(localOnly))!.deletedAt).toBeGreaterThan(0);
    await untrashItems([localOnly], d2);
    expect(alive(await d2.items.get(localOnly))).toBe(true);
  });

  it('坏一张图只丢那一张；坏一行只丢那一行', async () => {
    const d1 = new LinganDB(uniq('bad1'));
    await seed(d1);
    const buf = new Uint8Array(await (await exportBlob(d1)).blob.arrayBuffer());
    // 原图在包的最前面：改它的一个字节（CRC / sha256 都对不上）
    buf[30 + 'images/'.length + 64 + 4 + 10] ^= 0xff;
    // data.jsonl 第一行的一个字节改坏成无效 JSON
    const text = new TextDecoder('latin1').decode(buf);
    const at = text.indexOf('{"t":"item"');
    buf[at] = 0x21;
    const inc = await readGlean(new Blob([buf]));
    expect(inc.problems.join()).toMatch(/哈希对不上/);
    expect(inc.problems.join()).toMatch(/1 行读不出/);
    expect(inc.items.length).toBe(4);
    const d2 = new LinganDB(uniq('bad2'));
    const r = await applyImport(inc, await planImport(inc, d2), d2);
    expect(r.badImages).toBe(1);
    expect(await d2.images.count()).toBe(0);
    expect((await d2.items.toArray()).filter((x) => x.title === '同一张图' || x.title === '雨后的操场').length).toBeGreaterThan(0);
  });
});

describe('v0.21 旧 .json 备份', () => {
  it('照样能导入；没有 uid 的按 记录时间 + 标题 + 内容哈希 认重复', async () => {
    const d1 = new LinganDB(uniq('old1'));
    await seed(d1);
    const bk = JSON.parse(JSON.stringify(await exportAll(d1)));
    for (const it of bk.items) {
      delete it.uid;
      delete it.deviceId;
      delete it.deletedAt;
    }
    for (const dv of bk.developments) delete dv.uid;
    const d2 = new LinganDB(uniq('old2'));
    expect(await importAll(bk, d2)).toEqual({ items: 5, developments: 2 });
    expect((await d2.items.toArray()).every((x) => isUlid(x.uid))).toBe(true);
    expect(await d2.images.count()).toBe(2);
    // 再导一次：全部按指纹认出
    expect(await importAll(bk, d2)).toEqual({ items: 0, developments: 0 });
    expect(await d2.items.count()).toBe(5);
    // 从 .glean 导过的库再导旧 json：同样认出
    const d3 = new LinganDB(uniq('old3'));
    const inc = await readBackupFile((await exportBlob(d1)).blob);
    await applyImport(inc, await planImport(inc, d3), d3);
    expect(await importAll(bk, d3)).toEqual({ items: 1, developments: 0 }); // 只有回收站里那件（.glean 没导它）
    expect(itemFingerprint(bk.items[0])).toBe(itemFingerprint((await d1.items.toArray())[0]));
    await expect(importAll({ foo: 1 }, d3)).rejects.toThrow();
  });
});

describe('v0.21 Obsidian 适配', () => {
  it('回收站里的不导出；glean_id 写 uid，glean_n 写本机编号', () => {
    const items: Item[] = [
      { id: 1, uid: ulid(1), type: 'film', title: '活着的', tags: [], createdAt: 1, updatedAt: 1 },
      { id: 2, uid: ulid(2), type: 'film', title: '删掉的', tags: [], createdAt: 2, updatedAt: 2, deletedAt: 3 },
    ];
    const devs: Development[] = [{ ...dev([1, 2], '活新枝'), id: 1, uid: ulid(3) }, { ...dev([1], '死新枝'), id: 2, deletedAt: 5 }];
    const v = buildVault({ items, developments: devs, images: new Map(), now: 10 });
    const paths = v.files.map((f) => f.path);
    expect(paths.some((p) => p.includes('删掉的'))).toBe(false);
    expect(paths.some((p) => p.includes('死新枝'))).toBe(false);
    const note = v.files.find((f) => f.path.includes('活着的'))!.data as string;
    expect(note).toContain(`glean_id: "${items[0].uid}"`);
    expect(note).toMatch(/^glean_n: 1$/m);
    expect(v.stats.items).toBe(1);
  });
});
