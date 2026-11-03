// v0.37 工程底座（0702 首屏只查最新 60 条 / 0709 仓储层 / 0713 三档图 / 0727 性能回归门）
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Item } from '../lib/types';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
beforeAll(() => {
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {}, __gleanReady: 1 });
});
const mk = (n: number, extra: Partial<Item> = {}): Omit<Item, 'id'> => ({ uid: 'U' + String(n).padStart(25, '0'), type: 'text', title: 't' + n, why: '', tags: [], createdAt: 1_000_000 + n, updatedAt: 1_000_000 + n, ...extra });

describe('0709 仓储层：视图 / 组件不直接写库', () => {
  const src = {
    ...import.meta.glob('../views/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob('../components/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob('../App.tsx', { query: '?raw', import: 'default', eager: true }),
  } as Record<string, string>;
  it('扫到的文件够多（glob 没写错）', () => {
    expect(Object.keys(src).length).toBeGreaterThan(40);
  });
  it('没有 db.<表>.add / put / update / delete / clear / modify', () => {
    const bad: string[] = [];
    const re = /\bdb\.[a-zA-Z]+\.(?:add|bulkAdd|put|bulkPut|update|bulkUpdate|delete|bulkDelete|clear)\(|\bdb\.[a-zA-Z]+\.(?:where|filter|toCollection|orderBy)\([^;]*?\.(?:modify|delete)\(/g;
    for (const [f, s] of Object.entries(src)) for (const m of s.matchAll(re)) bad.push(`${f}: ${m[0].slice(0, 60)}`);
    expect(bad).toEqual([]);
  });
});

describe('0709 仓储层的连带', () => {
  afterEach(async () => {
    const { db } = await import('../lib/db');
    await db.items.clear();
    await db.developments.clear();
  });
  it('补为什么：updatedAt 变、旧向量作废；后台补全不改 updatedAt；星标批量', async () => {
    const { db } = await import('../lib/db');
    const repo = await import('../lib/repo');
    const id = (await db.items.add({ ...mk(1), embedding: [1, 2], embedModel: 'x' } as Item)) as number;
    await repo.amendItem(id, { why: '因为', tags: ['a'] });
    const a = (await db.items.get(id))!;
    expect(a.why).toBe('因为');
    expect(a.embedding).toBeUndefined();
    expect(a.updatedAt).toBeGreaterThan(1_000_001);
    await repo.fillItem(id, { creator: '某人' });
    const f = (await db.items.get(id))!;
    expect(f.creator).toBe('某人');
    expect(f.touchedAt).toBeUndefined();
    await repo.setGarden([id], true);
    expect((await db.items.get(id))!.garden).toBe(1);
    await repo.setGarden([id], false);
    expect((await db.items.get(id))!.garden).toBeUndefined();
    const devs = await repo.addDevelopments([1, 2].map((k) => ({ itemIds: [id], idea: { title: 'b' + k }, createdAt: k }) as never));
    await repo.setStar(devs, true);
    expect((await db.developments.bulkGet(devs)).every((d) => d!.starred)).toBe(true);
    await repo.attachResult(devs[0], 'R1');
    const d0 = (await db.developments.get(devs[0]))!;
    expect(d0.resultUids).toEqual(['R1']);
    expect(d0.status).toBe('done');
    await db.items.clear();
    await db.developments.clear();
  });
});

describe('0702 首屏只查最新 60 条', () => {
  it('库大时先给最新 60 条 + 真实计数，全表等空闲（或要用时）再读', async () => {
    const { db } = await import('../lib/db');
    const rows = Array.from({ length: 150 }, (_, i) => mk(i + 1, i % 50 === 0 ? { deletedAt: 9 } : i % 30 === 1 ? { sample: 1 } : {}));
    await db.items.bulkAdd(rows as Item[]);
    const li = await import('../lib/libitems');
    li.primeLibraryItems(10000);
    await li.firstLibraryItems(3000);
    const s = li._libState();
    expect(s.partial).toBe(true);
    expect(s.n).toBe(li.HEAD);
    const m = await li.headMeta();
    expect(m.live).toBe(147);
    expect(m.samples).toBe(5);
    const head = await li.headQuery();
    expect(head[0].title).toBe('t150');
    expect(head.every((x) => !x.deletedAt)).toBe(true);
    li.loadFullNow();
    for (let k = 0; k < 50 && li._libState().partial; k++) await new Promise((r) => setTimeout(r, 20));
    expect(li._libState()).toMatchObject({ partial: false, full: true, n: 147 });
    await db.items.clear();
  });
});

describe('0713 三档图', () => {
  it('详情档只给大图做：长边 > 1600 或 > 400KB', async () => {
    const { midSize, needsMid, MID_MAX } = await import('../lib/imagestore');
    expect(needsMid(4000, 3000, 2_000_000)).toBe(true);
    expect(needsMid(1200, 900, 300_000)).toBe(false);
    expect(needsMid(1200, 900, 900_000)).toBe(true);
    expect(midSize(4000, 3000)).toEqual({ w: MID_MAX, h: Math.round((MID_MAX * 3) / 4) });
  });
  it('后台补缩略图时一并写详情档；详情读详情档，导出 / OCR 仍读原图', async () => {
    const { db } = await import('../lib/db');
    const ims = await import('../lib/imagestore');
    const id = (await db.items.add({ ...mk(7), type: 'image', hasImage: 1, thumbTodo: 1 } as Item)) as number;
    const orig = new Blob([new Uint8Array(10)], { type: 'image/png' });
    await db.images.put({ itemId: id, blob: orig });
    const mid = new Blob([new Uint8Array(3)], { type: 'image/jpeg' });
    const rep = await ims.healImages(db, async () => ({ blob: new Blob([new Uint8Array(2)]), w: 4, h: 3, mid }));
    expect(rep.made).toBe(1);
    expect((await db.images.get(id))!.mid?.size).toBe(3);
    expect((await ims.getViewBlob(db, id))!.size).toBe(3);
    expect((await ims.getOriginalBlob(db, id))!.size).toBe(10);
    // 备份只带原图
    const { exportAll } = await import('../lib/db');
    const b = await exportAll(db);
    expect(JSON.stringify(b)).not.toContain('"mid"');
    await db.items.clear();
    await db.images.clear();
  });
});

describe('0727 性能回归门', () => {
  it('同会话交替测：新版中位数慢超 10% 且显著才拦', async () => {
    const { gate, mannWhitneyU } = await import('../../scripts/perf-gate.mjs');
    const old = [190, 192, 188, 195, 191, 189, 193, 190, 194];
    expect(gate(old, old.map((x) => x + 1)).pass).toBe(true);
    expect(gate(old, old.map((x) => x * 1.3)).pass).toBe(false);
    expect(gate(old, [190, 260, 188, 195, 191, 189, 193, 190, 194]).pass).toBe(true); // 一次离群不算
    expect(mannWhitneyU([1, 2, 3], [4, 5, 6]).u).toBe(0);
  });
});
