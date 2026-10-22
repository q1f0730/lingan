import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DAILY_COMBO, DAILY_OLD, dailyPool, hashSeed, lastTouchMap, pickDaily, triedTogether } from '../lib/daily';
import { LinganDB, addItem, addSamples, clearSamples, deleteItem, ensureDaily, touchItems } from '../lib/db';
import { drawSamples, SAMPLE_POOL } from '../lib/samples';
import { mulberry32 } from '../lib/similarity';
import type { Development, Item } from '../lib/types';

const DAY = 86400000;
const NOW = new Date(2026, 9, 22, 9, 0).getTime();
const dbn = () => new LinganDB('daily-' + Math.random().toString(36).slice(2));

/** 从示例池按种子抽 n 条当成「自己的穗」，拾于过去 n 天里 */
function lib(n: number, seed: number): Item[] {
  return drawSamples(n, mulberry32(seed)).map(({ sample: _s, ...s }, i) => (void _s, { ...s, id: i + 1, createdAt: NOW - (i + 1) * 3 * DAY, updatedAt: NOW - (i + 1) * 3 * DAY }));
}

describe('每日一穗 · 纯函数', () => {
  it('3 件旧穗 + 4 件组合，id 都在库里、不重复', () => {
    const items = lib(30, 7);
    const p = pickDaily({ items, devs: [], day: '2026-10-22' })!;
    expect(p.oldIds).toHaveLength(DAILY_OLD);
    expect(p.comboIds).toHaveLength(DAILY_COMBO);
    expect(new Set(p.oldIds).size).toBe(3);
    expect(new Set(p.comboIds).size).toBe(4);
    const ids = new Set(items.map((i) => i.id));
    expect([...p.oldIds, ...p.comboIds].every((x) => ids.has(x))).toBe(true);
    // 组合以一件旧穗为锚
    expect(p.comboIds.some((x) => p.oldIds.includes(x))).toBe(true);
  });
  it('同一天反复算结果一致；换一天会变，且旧穗避开昨天那三件', () => {
    const items = lib(40, 11);
    const a = pickDaily({ items, devs: [], day: '2026-10-22' });
    const b = pickDaily({ items: [...items].reverse(), devs: [], day: '2026-10-22' });
    expect(b).toEqual(a);
    const next = pickDaily({ items, devs: [], day: '2026-10-23', prev: a })!;
    expect(next.oldIds).not.toEqual(a!.oldIds);
    expect(next.oldIds.some((x) => a!.oldIds.includes(x))).toBe(false);
    expect([...next.comboIds].sort().join()).not.toBe([...a!.comboIds].sort().join());
  });
  it('旧穗来自最久没碰的那一截：刚打开过 / 刚嫁接过的不会被挑', () => {
    const devs = [{ itemIds: [21, 22, 23], createdAt: NOW - 2 * DAY }];
    let items: Item[] = [];
    for (const seed of [3, 4, 5, 6]) {
      items = lib(30, seed).map((it) => ({ ...it, touchedAt: it.id! <= 20 ? NOW - DAY : undefined }));
      const p = pickDaily({ items, devs, day: '2026-10-22' })!;
      // 21–23 前天刚嫁接过，1–20 昨天刚碰过：很久没碰的只有 24–30
      expect(p.oldIds.every((x) => x >= 24)).toBe(true);
    }
    const t = lastTouchMap(items, devs);
    expect(t.get(22)).toBe(NOW - 2 * DAY);
    expect(t.get(30)).toBe(items[29].createdAt);
  });
  it('组合是没一起嫁接过的；一起嫁接过的组合会被让开', () => {
    const items = lib(8, 5);
    const day = '2026-10-22';
    const p0 = pickDaily({ items, devs: [], day })!;
    const devs = [{ itemIds: p0.comboIds, createdAt: NOW - DAY }];
    const p1 = pickDaily({ items, devs, day })!;
    expect(triedTogether(p1.comboIds, devs)).toBe(false);
  });
  it('组合比随手抽的四件更远（平均两两相似度更低）', () => {
    const items = lib(60, 21);
    const p = pickDaily({ items, devs: [], day: '2026-10-22' })!;
    expect(new Set(p.comboIds.map((id) => items[id - 1].type)).size).toBeGreaterThanOrEqual(3);
  });
  it('自己的穗够 4 件时不拿示例；不够 4 件返回 null', () => {
    const own = lib(5, 9);
    const samples = lib(10, 99).map((s, i) => ({ ...s, id: 100 + i, sample: 1 as const }));
    expect(dailyPool([...own, ...samples]).every((x) => !x.sample)).toBe(true);
    const p = pickDaily({ items: [...own, ...samples], devs: [], day: '2026-10-22' })!;
    expect([...p.oldIds, ...p.comboIds].every((x) => x < 100)).toBe(true);
    expect(pickDaily({ items: lib(3, 1), devs: [], day: '2026-10-22' })).toBeNull();
    // 只有示例时示例也算
    expect(pickDaily({ items: samples, devs: [], day: '2026-10-22' })).not.toBeNull();
  });
  it('1000 穗时也很快（<300ms）', () => {
    const base = SAMPLE_POOL;
    const items: Item[] = Array.from({ length: 1000 }, (_, i) => ({ ...base[i % base.length], id: i + 1, tags: [...base[i % base.length].tags, 't' + (i % 37)], createdAt: NOW - i * 3600000, updatedAt: NOW }));
    const devs: Array<Pick<Development, 'itemIds' | 'createdAt'>> = Array.from({ length: 200 }, (_, i) => ({ itemIds: [i + 1, i + 2, i + 3], createdAt: NOW - i * 1000 }));
    const t = performance.now();
    const p = pickDaily({ items, devs, day: '2026-10-22' });
    expect(performance.now() - t).toBeLessThan(300);
    expect(p?.comboIds).toHaveLength(4);
  });
  it('种子按日期字符串，确定且分散', () => {
    expect(hashSeed('2026-10-22')).toBe(hashSeed('2026-10-22'));
    expect(hashSeed('2026-10-22')).not.toBe(hashSeed('2026-10-23'));
  });
});

describe('每日一穗 · 存进 daily 表（离线、同一天不变）', () => {
  it('同一天反复打开内容一致，碰过 / 改过也不变；第二天变化', async () => {
    const d = dbn();
    for (const s of lib(24, 31)) {
      const { id: _id, ...rest } = s;
      void _id;
      await d.items.add(rest);
    }
    const items = await d.items.toArray();
    const a = await ensureDaily(items, d, NOW);
    expect(a?.day).toBe('2026-10-22');
    await touchItems(a!.oldIds, d, NOW + 1000);
    const b = await ensureDaily(await d.items.toArray(), d, NOW + 3 * 3600000);
    expect(b).toEqual(a);
    expect(await d.daily.count()).toBe(1);
    const c = await ensureDaily(await d.items.toArray(), d, NOW + DAY);
    expect(c?.day).toBe('2026-10-23');
    expect(c!.oldIds).not.toEqual(a!.oldIds);
    // 昨天看过（打开）的三件不会再出现
    expect(c!.oldIds.some((x) => a!.oldIds.includes(x))).toBe(false);
    expect(await d.daily.count()).toBe(2);
    d.close();
  });
  it('今天的穗被删了就重算一份，删掉的不会出现', async () => {
    const d = dbn();
    for (const s of lib(12, 41)) {
      const { id: _id, ...rest } = s;
      void _id;
      await addItem(rest, d);
    }
    const a = (await ensureDaily(await d.items.toArray(), d, NOW))!;
    await deleteItem(a.oldIds[0], d);
    const b = (await ensureDaily(await d.items.toArray(), d, NOW + 1000))!;
    expect([...b.oldIds, ...b.comboIds]).not.toContain(a.oldIds[0]);
    d.close();
  });
  it('穗不到 4 件不出卡', async () => {
    const d = dbn();
    for (const s of lib(3, 2)) {
      const { id: _id, ...rest } = s;
      void _id;
      await addItem(rest, d);
    }
    expect(await ensureDaily(await d.items.toArray(), d, NOW)).toBeNull();
    d.close();
  });
});

describe('Dexie v3 → v4 迁移', () => {
  it('补上每件穗最后一次被拿去嫁接的时间，穗与新枝一条不少', async () => {
    const name = 'mig4-' + Math.random().toString(36).slice(2);
    const v3 = new Dexie(name);
    v3.version(1).stores({ items: '++id, type, createdAt, updatedAt, *tags', developments: '++id, createdAt, starred' });
    v3.version(2).stores({ developments: '++id, createdAt, starred, evidence' });
    v3.version(3).stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo', images: '&itemId' });
    await v3.open();
    const rows = lib(5, 77).map(({ id: _id, ...r }) => (void _id, r));
    const ids = (await v3.table('items').bulkAdd(rows, { allKeys: true })) as number[];
    await v3.table('developments').bulkAdd([
      { itemIds: [ids[0], ids[1], ids[2]], jump: 0.5, idea: { title: 'a', bridge: '', idea: 'x', cliches: [], refs: [1, 2, 3] }, source: 'offline', evidence: 'ok', createdAt: NOW - DAY },
      { itemIds: [ids[1], ids[3], ids[4]], jump: 0.5, idea: { title: 'b', bridge: '', idea: 'y', cliches: [], refs: [1, 2, 3] }, source: 'offline', evidence: 'ok', createdAt: NOW },
    ]);
    v3.close();
    const d = new LinganDB(name);
    await d.open();
    expect(d.verno).toBe(7); // v0.19 起是 7（套路墙） // v0.18 起是 6（嫁接次数）
    expect(await d.items.count()).toBe(5);
    expect(await d.developments.count()).toBe(2);
    const got = await d.items.bulkGet(ids);
    expect(got[0]!.touchedAt).toBe(NOW - DAY);
    expect(got[1]!.touchedAt).toBe(NOW);
    expect(got[4]!.touchedAt).toBe(NOW);
    expect(await d.daily.count()).toBe(0);
    d.close();
  });
});

describe('示例池', () => {
  it('约 80 条，六种类型都有，覆盖不同国家与年代', () => {
    expect(SAMPLE_POOL.length).toBeGreaterThanOrEqual(75);
    const by = (t: string) => SAMPLE_POOL.filter((s) => s.type === t).length;
    for (const t of ['film', 'music', 'image', 'text', 'idea', 'link']) expect(by(t)).toBeGreaterThanOrEqual(8);
    const years = SAMPLE_POOL.map((s) => Number(s.year)).filter(Boolean);
    expect(Math.min(...years)).toBeLessThan(1900);
    expect(Math.max(...years)).toBeGreaterThanOrEqual(2015);
    // 不只是文艺片和民谣：动作 / 恐怖 / 动画 / 嘻哈 / 金属 / 电子 / K-pop 都在
    const tags = new Set(SAMPLE_POOL.flatMap((s) => s.tags));
    for (const t of ['动作', '恐怖', '动画', '嘻哈', '金属', '电子', 'K-pop', '纪录片']) expect(tags.has(t)).toBe(true);
    const titles = SAMPLE_POOL.map((s) => s.type + s.title + (s.content || ''));
    expect(new Set(titles).size).toBe(titles.length);
    for (const s of SAMPLE_POOL.filter((x) => x.type === 'link')) expect(() => new URL(s.url!)).not.toThrow();
  });
  it('随机抽 10 条：不重复、六种类型各至少一条、都标着示例，每次不一样', () => {
    const a = drawSamples(10, mulberry32(1));
    const b = drawSamples(10, mulberry32(2));
    expect(a).toHaveLength(10);
    expect(new Set(a.map((s) => s.title + s.content)).size).toBe(10);
    expect(new Set(a.map((s) => s.type)).size).toBe(6);
    expect(a.every((s) => s.sample === 1)).toBe(true);
    expect(a.map((s) => s.title + s.content).join()).not.toBe(b.map((s) => s.title + s.content).join());
    // 抽 200 次，池子里大部分条目都会出现，不是总那几条
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) for (const s of drawSamples(10, mulberry32(1000 + i))) seen.add(s.type + s.title + s.content);
    expect(seen.size).toBeGreaterThan(SAMPLE_POOL.length * 0.9);
  });
  it('一键清掉示例：只删示例和只由示例长出的新枝，自己的穗与新枝都留着', async () => {
    const d = dbn();
    const mine = await addItem({ type: 'idea', title: '我自己的想法', tags: [] }, d);
    const mine2 = await addItem({ type: 'film', title: '我自己的电影', tags: [] }, d);
    const sids = await addSamples(10, d, mulberry32(5), NOW);
    expect(await d.items.where('sample').equals(1).count()).toBe(10);
    const s = await d.items.bulkGet(sids);
    expect(s.every((x) => x!.createdAt < NOW && x!.createdAt > NOW - 91 * DAY)).toBe(true);
    await d.developments.bulkAdd([
      { itemIds: sids.slice(0, 3), jump: 0, idea: { title: '示例长的', bridge: '', idea: '', cliches: [] }, source: 'offline', createdAt: 1 },
      { itemIds: [mine, sids[3], sids[4]], jump: 0, idea: { title: '混着长的', bridge: '', idea: '', cliches: [] }, source: 'offline', createdAt: 2 },
      { itemIds: [mine, mine2], jump: 0, idea: { title: '我自己的', bridge: '', idea: '', cliches: [] }, source: 'offline', createdAt: 3 },
    ]);
    await ensureDaily(await d.items.toArray(), d, NOW);
    const r = await clearSamples(d);
    expect(r).toEqual({ items: 10, developments: 1 });
    expect((await d.items.toArray()).map((x) => x.title).sort()).toEqual(['我自己的想法', '我自己的电影'].sort());
    expect((await d.developments.toArray()).map((x) => x.idea.title)).toEqual(['混着长的', '我自己的']);
    expect(await d.daily.count()).toBe(0);
    expect(await clearSamples(d)).toEqual({ items: 0, developments: 0 });
    d.close();
  });
});
