// v0.21 0710 Dexie 迁移回归套件：v1–v7 每个历史版本一份夹具库（fixtures/dexie/vN.json，当年的表结构 + 当年形状的数据），
// 逐个按当年的 schema 建库写入，再用最新的 LinganDB 打开（逐级升级到 v8），比对：条数、每个关键字段、原图每个字节、
// 新枝来源、嫁接次数、套路墙、每日一穗、索引表；最后把升级后的库导出 .glean 再导进空库，结果一样。
// 以后每加一个 Dexie 版本：在这里加一份 v(N).json（用上一版的 schema 与数据形状），这个套件自动覆盖它。
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { LinganDB } from '../lib/db';
import { applyImport, BlobSink, exportGlean, planImport, readBackupFile } from '../lib/backup';
import { dataUrlToBlob } from '../lib/imagestore';
import { isUlid, ulidTime } from '../lib/ulid';
import type { Development, Item } from '../lib/types';
import type { Cliche } from '../lib/wall';

interface Fixture {
  version: number;
  app: string;
  schema: Record<string, Record<string, string>>;
  data: {
    items: Array<Item & { image?: string }>;
    developments: Development[];
    images?: Array<{ itemId: number; image: string }>;
    daily?: unknown[];
    ftidx?: unknown[];
    cliches?: Cliche[];
    meta?: Array<{ k: string; v: unknown }>;
  };
}
const LATEST = 9;
// 夹具按原文读进来（vite 的 ?raw），不依赖 node:fs
const raw = import.meta.glob('./fixtures/dexie/v*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const fixtures: Fixture[] = Object.values(raw)
  .map((t) => JSON.parse(t) as Fixture)
  .sort((a, b) => a.version - b.version);

const bytesOf = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())].join(',');
const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);

/** 按当年的 schema 建库并写入夹具数据（不跑任何升级脚本——就是那一版用户磁盘上的样子） */
async function seedFixture(name: string, fx: Fixture) {
  const raw = new Dexie(name);
  for (const [v, stores] of Object.entries(fx.schema)) raw.version(Number(v)).stores(stores);
  await raw.open();
  const t = (n: string) => raw.table(n);
  await t('items').bulkAdd(fx.data.items);
  await t('developments').bulkAdd(fx.data.developments);
  if (fx.data.images) await t('images').bulkAdd(fx.data.images.map((x) => ({ itemId: x.itemId, blob: dataUrlToBlob(x.image) })));
  if (fx.data.daily) await t('daily').bulkAdd(fx.data.daily);
  if (fx.data.ftidx) await t('ftidx').bulkAdd(fx.data.ftidx);
  if (fx.data.cliches) await t('cliches').bulkAdd(fx.data.cliches);
  if (fx.data.meta) await t('meta').bulkAdd(fx.data.meta);
  expect(raw.verno).toBe(fx.version);
  raw.close();
}

/** 期望的原图：v1–v2 在行里（data URL），v3 起在 images 表 */
function expectedImages(fx: Fixture): Map<number, string> {
  const m = new Map<number, string>();
  for (const it of fx.data.items) if (it.image) m.set(it.id!, it.image);
  for (const im of fx.data.images || []) m.set(im.itemId, im.image);
  return m;
}

describe('0710 Dexie 迁移回归：v1–v8 夹具库逐个升级到最新', () => {
  it('夹具齐全：v1 到 v8 每版一份', () => {
    expect(fixtures.map((f) => f.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new LinganDB(uniq('probe')).verno).toBe(LATEST);
  });

  for (const fx of fixtures) {
    it(`v${fx.version}（${fx.app}）→ v${LATEST}：一条不丢、字段不变、原图逐字节相同`, async () => {
      const name = uniq(`mig-v${fx.version}`);
      await seedFixture(name, fx);
      const d = new LinganDB(name);
      await d.open();
      expect(d.verno).toBe(LATEST);

      // 穗：条数、关键字段
      const items = await d.items.orderBy(':id').toArray();
      expect(items.length).toBe(fx.data.items.length);
      for (const src of fx.data.items) {
        const it = items.find((x) => x.id === src.id)!;
        expect(it, `item ${src.id}`).toBeTruthy();
        for (const k of ['type', 'title', 'creator', 'year', 'content', 'url', 'why', 'createdAt', 'updatedAt', 'sample'] as const) expect(it[k], `item ${src.id}.${k}`).toEqual(src[k]);
        // v0.14 迁移：v4 之前没有 touchedAt，按旧新枝回填最后一次被拿去嫁接的时间
        const lastGraft = Math.max(0, ...fx.data.developments.filter((dv) => dv.itemIds.includes(src.id!)).map((dv) => dv.createdAt));
        expect(it.touchedAt, `item ${src.id}.touchedAt`).toEqual(fx.version >= 4 ? src.touchedAt : lastGraft || undefined);
        expect(it.tags).toEqual(src.tags);
        // v0.21：uid（ULID，时间 = 记录时间）、deviceId，没有墓碑
        expect(isUlid(it.uid)).toBe(true);
        expect(ulidTime(it.uid!)).toBe(src.createdAt);
        expect(it.deviceId).toMatch(/^[0-9A-Z]{26}$/);
        expect(it.deletedAt).toBeUndefined();
        // v0.18：嫁接次数（v6 起照原样；更早的按旧新枝回填）
        expect(typeof it.graftCount).toBe('number');
        if (fx.version >= 6) expect(it.graftCount).toBe(src.graftCount);
        // v0.13：行里不再有内联原图
        expect(it.image).toBeUndefined();
        // v0.23：老穗不进待理（升级不把整个穗仓塞进收件箱）；有链接 / 文字的补上重复钥匙
        expect(it.inbox).toBeUndefined();
        expect(Array.isArray(it.dup)).toBe(true);
        if (src.url) expect(it.dup!.some((k) => k.startsWith('u:'))).toBe(true);
      }
      expect(new Set(items.map((x) => x.uid)).size).toBe(items.length);
      if (fx.version < 6) expect(items.filter((x) => x.id! <= 3).map((x) => x.graftCount)).toEqual([2, 2, 1]);

      // 原图：每个字节都在
      const want = expectedImages(fx);
      expect(await d.images.count()).toBe(want.size);
      for (const [id, url] of want) {
        const im = await d.images.get(id);
        expect(await bytesOf(im!.blob)).toBe(await bytesOf(dataUrlToBlob(url)));
        expect(items.find((x) => x.id === id)!.hasImage).toBe(1);
      }

      // 新枝：条数、来源、正文；v0.12 起补的溯源标记；v0.21 uid / updatedAt
      const devs = await d.developments.orderBy(':id').toArray();
      expect(devs.length).toBe(fx.data.developments.length);
      for (const src of fx.data.developments) {
        const dv = devs.find((x) => x.id === src.id)!;
        expect(dv.itemIds).toEqual(src.itemIds);
        expect(dv.idea.title).toBe(src.idea.title);
        expect(dv.idea.idea).toBe(src.idea.idea);
        expect(dv.evidence).toBe('legacy');
        expect(!!dv.starred).toBe(!!src.starred);
        expect(dv.mode).toBe(src.mode);
        expect(isUlid(dv.uid)).toBe(true);
        expect(dv.updatedAt).toBe(src.createdAt);
      }

      // 套路墙：v7 原样（含我加的、划掉的）；更早的从旧新枝里沉淀
      const wall = await d.cliches.orderBy('key').toArray();
      if (fx.data.cliches) {
        expect(wall.map((c) => [c.key, c.source, c.struck, c.blocked])).toEqual(
          [...fx.data.cliches].sort((a, b) => (a.key < b.key ? -1 : 1)).map((c) => [c.key, c.source, c.struck, c.blocked]),
        );
      } else expect(wall.map((c) => c.key).sort()).toEqual(['旧套路乙', '旧套路甲'].sort());
      expect(wall.every((c) => isUlid(c.uid))).toBe(true);

      // 每日一穗、索引表原样保留；meta 记了设备 id
      expect(await d.daily.count()).toBe(fx.data.daily?.length || 0);
      expect(await d.ftidx.count()).toBe(fx.data.ftidx?.length || 0);
      expect((await d.meta.get('deviceId'))?.v).toBe(items[0].deviceId);

      // 升级后的库导出 .glean → 导进空库：一样
      const sink = new BlobSink();
      await exportGlean(sink, d, { now: Date.now() });
      const inc = await readBackupFile(sink.blob());
      const d2 = new LinganDB(uniq(`mig-v${fx.version}-copy`));
      await applyImport(inc, await planImport(inc, d2, 'merge'), d2);
      const copy = await d2.items.toArray();
      expect(copy.map((x) => x.uid).sort()).toEqual(items.map((x) => x.uid).sort());
      expect(await d2.developments.count()).toBe(devs.length);
      expect(await d2.images.count()).toBe(want.size);
      d.close();
    });
  }

  it('再打开一次（已是最新）不重复迁移：uid 不变', async () => {
    const fx = fixtures[fixtures.length - 1];
    const name = uniq('mig-reopen');
    await seedFixture(name, fx);
    const a = new LinganDB(name);
    const u1 = (await a.items.toArray()).map((x) => x.uid);
    a.close();
    const b = new LinganDB(name);
    expect((await b.items.toArray()).map((x) => x.uid)).toEqual(u1);
  });
});
