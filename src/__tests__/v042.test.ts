import { describe, expect, it } from 'vitest';
import { SAMPLE_POOL, drawSamples } from '../lib/samples';
import { loadSamplePool } from '../lib/samplepack';
import { drawSamples as drawFrom } from '../lib/sampledraw';
import { mulberry32 } from '../lib/similarity';

describe('v0.42 瘦身：示例池压缩包', () => {
  it('解压结果 = samples.ts 的示例池（改了示例要重跑 scripts/samples/pack.mjs）', async () => {
    const pool = await loadSamplePool();
    expect(pool.length).toBe(SAMPLE_POOL.length);
    expect(pool).toEqual(SAMPLE_POOL.map((s) => JSON.parse(JSON.stringify(s))));
  });
  it('同一随机数抽出来的和以前一样', async () => {
    const pool = await loadSamplePool();
    expect(drawFrom(10, mulberry32(7), pool)).toEqual(drawSamples(10, mulberry32(7)).map((s) => JSON.parse(JSON.stringify(s))));
  });
});

import 'fake-indexeddb/auto';
import { adopted, drawClash, drawSpan, graftScore, loadRecipes, preferTransforms, recipeName, removeRecipe, saveRecipe, stayDays } from '../lib/graftlab';
import { borrowed } from '../lib/provenance';
import { buildConvergePrompt, graftOffline, PROMPT_V } from '../lib/graft';
import { db } from '../lib/db';
import { markOut, setSurprise } from '../lib/repo';
import type { Development, Idea, Item } from '../lib/types';

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 4, 4);
const mk = (id: number, o: Partial<Item> = {}): Item => ({ id, type: 'film', title: `穗${id}`, tags: [], createdAt: NOW - id * DAY, ...o }) as Item;
const idea = (o: Partial<Idea> = {}): Idea => ({ title: '新枝', bridge: '', idea: '一段正文', cliches: [], refs: [1, 2, 3], evidence: 'ok', ...o });
let seq = 0;
const dev = (o: Partial<Development> = {}, io: Partial<Idea> = {}): Development => ({ id: ++seq, uid: `u${seq}`, itemIds: [1, 2, 3], jump: 0.8, idea: idea(io), source: 'ai', createdAt: NOW, ...o });

describe('v0.42 0238 采用信号', () => {
  it('留下 / 试过 / 做成 / 结果 / 复制分享 / 追问 / 有子枝 都算用上；放弃不算', () => {
    expect(adopted(dev())).toBe(false);
    expect(adopted(dev({ starred: true }))).toBe(true);
    expect(adopted(dev({ status: 'tried' }))).toBe(true);
    expect(adopted(dev({ status: 'done' }))).toBe(true);
    expect(adopted(dev({ resultUids: ['x'] }))).toBe(true);
    expect(adopted(dev({ out: NOW }))).toBe(true);
    expect(adopted(dev({ followups: [{ q: 'q', a: 'a', refs: [], source: 'offline', at: NOW }] }))).toBe(true);
    const p = dev();
    expect(adopted(p, new Set([p.uid!]))).toBe(true);
    expect(adopted(dev({ starred: true, status: 'dropped' }))).toBe(false);
  });
});

describe('ROADMAP v0.32 嫁接成绩 + 0239 高产穗 + 0240 变形法胜率', () => {
  it('评 10 根后四个指标都有数值；高产穗按用上的新枝计；变形法 用上 / 长出', () => {
    const devs: Development[] = [];
    for (let b = 0; b < 4; b++)
      for (let i = 0; i < 3; i++)
        devs.push(
          dev(
            { batch: { id: `b${b}`, index: i, size: 3 }, itemIds: [1, 2, 3, 4], surprise: ((b * 3 + i) % 5) + 1, starred: i === 0, ...(b === 0 && i === 1 ? { evidence: 'weak' as const } : {}) },
            { title: `第${b}批第${i}根`, idea: ['雨夜里的收音机只放一首歌', '把菜市场的报价声剪成鼓点', '用一面镜子拍完整部短片'][i], transform: ['invert', 'medium', 'eras'][i], refs: i === 0 ? [1, 2, 4] : [1, 2, 3], evidence: b === 0 && i === 1 ? 'weak' : 'ok' },
          ),
        );
    const s = graftScore(devs);
    expect(s.n).toBe(12);
    expect(s.rated).toBe(12);
    expect(s.evidence).toBeCloseTo(11 / 12);
    expect(s.diff).toBeGreaterThan(0.5);
    expect(s.diff).toBeLessThanOrEqual(1);
    expect(s.surprise).toBeCloseTo(devs.reduce((a, d) => a + d.surprise!, 0) / 12);
    expect(s.adoption).toBeCloseTo(4 / 12);
    expect(s.seeds[0]).toEqual({ id: 1, n: 4 });
    expect(s.seeds.find((x) => x.id === 4)).toEqual({ id: 4, n: 4 });
    expect(s.seeds.find((x) => x.id === 3)).toBeUndefined();
    expect(s.transforms[0]).toMatchObject({ t: 'invert', name: '反转', n: 4, won: 4 });
    // 0240：反转 4/4 远高于整体 4/12 → 偏向；其余不偏
    expect(preferTransforms(devs)).toEqual(['invert']);
    expect(preferTransforms(devs.slice(0, 9))).toEqual([]);
  });
  it('删掉的不算；空库返回 null', () => {
    const s = graftScore([dev({ deletedAt: NOW })]);
    expect(s.n).toBe(0);
    expect(s.adoption).toBeNull();
    expect(s.surprise).toBeNull();
  });
  it('偏向的变形法写进收拢提示词；没有就不写', () => {
    const items = [mk(1), mk(2), mk(3)];
    const off = graftOffline(items, { rand: () => 0.3 });
    const p = buildConvergePrompt(items, { oblique: 'ob', prefer: ['flaw'] }, off.tensions, off.seeds);
    expect(p.system).toContain('「保留瑕疵」');
    expect(buildConvergePrompt(items, { oblique: 'ob' }, off.tensions, off.seeds).system).not.toContain('我过去更常用上');
    expect(PROMPT_V).toMatch(/^p\d+$/);
  });
});

describe('0214 时间差 / 0217 标签对撞', () => {
  const lib = [mk(1, { createdAt: NOW - 2 * DAY, tags: ['雨', '夜'] }), mk(2, { createdAt: NOW - 400 * DAY, tags: ['海'] }), mk(3, { createdAt: NOW - 800 * DAY, tags: ['雨'] }), mk(4, { createdAt: NOW - 30 * DAY, tags: ['海', '夏'] }), mk(5, { createdAt: NOW - 60 * DAY, tags: ['夜'] })];
  it('时间差：一穗 ≥1 年前 + 一穗最近 7 天，补满 n 穗', () => {
    for (let k = 0; k < 20; k++) {
      const r = drawSpan(lib, 4, mulberry32(k), NOW);
      expect(r.ok).toBe(true);
      expect(r.items).toHaveLength(4);
      expect(new Set(r.items.map((x) => x.id)).size).toBe(4);
      expect(r.items.some((x) => x.createdAt <= NOW - 365 * DAY)).toBe(true);
      expect(r.items.some((x) => x.createdAt >= NOW - 7 * DAY)).toBe(true);
    }
    expect(drawSpan(lib.filter((x) => x.id !== 1), 3, mulberry32(1), NOW)).toMatchObject({ ok: false, items: [] });
    expect(drawSpan(lib.slice(0, 1), 3, mulberry32(1), NOW).note).toContain('满一年');
  });
  it('标签对撞：抽到的两个标签从没同时出现在一穗上，各有一穗', () => {
    for (let k = 0; k < 20; k++) {
      const r = drawClash(lib, 3, mulberry32(k));
      expect(r.ok).toBe(true);
      const [, a, b] = r.note.match(/#(\S+) × #(\S+?)（/)!;
      expect(lib.some((x) => x.tags.includes(a) && x.tags.includes(b))).toBe(false);
      expect(r.items.some((x) => x.tags.includes(a))).toBe(true);
      expect(r.items.some((x) => x.tags.includes(b))).toBe(true);
      expect(r.items).toHaveLength(3);
    }
    expect(drawClash([mk(1, { tags: ['a', 'b'] }), mk(2, { tags: ['a', 'b'] })], 3).ok).toBe(false);
  });
});

describe('0213 嫁接配方', () => {
  it('存 / 同名覆盖 / 最多 8 个 / 删', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const base = { mode: 'far' as const, count: 3 as const };
    expect(recipeName({ ...base, theme: '一首歌的 MV', wild: true }, '远距')).toBe('远距 · 3 穗 · 一首歌的 MV · 野');
    expect(recipeName({ ...base, rule: 'clash' }, '远距')).toBe('标签对撞 · 3 穗');
    saveRecipe({ name: 'A', ...base });
    saveRecipe({ name: 'B', ...base, count: 5 });
    saveRecipe({ name: 'A', ...base, count: 4 });
    expect(loadRecipes().map((r) => [r.name, r.count])).toEqual([['A', 4], ['B', 5]]);
    for (let i = 0; i < 10; i++) saveRecipe({ name: `R${i}`, ...base });
    expect(loadRecipes()).toHaveLength(8);
    removeRecipe('R9');
    expect(loadRecipes().map((r) => r.name)).not.toContain('R9');
    store.set('glean.recipes', '{坏的');
    expect(loadRecipes()).toEqual([]);
  });
});

describe('0221 停留天数 / 0243 借了哪句话', () => {
  it('从推进那天算；没推进过从长出来那天算', () => {
    expect(stayDays({ createdAt: NOW - 5 * DAY }, NOW)).toBe(5);
    expect(stayDays({ createdAt: NOW - 5 * DAY, statusAt: NOW - DAY }, NOW)).toBe(1);
  });
  it('最长共同片段：不算标题 / 作者，汉字至少 3 个', () => {
    const it = { title: '花样年华', creator: '王家卫', why: '走廊里擦肩而过的慢镜头，旗袍一件一件地换', tags: ['慢镜头'] };
    expect(borrowed('《花样年华》里擦肩而过的慢镜头被拿来拍地铁换乘', it)).toBe('里擦肩而过的慢镜头');
    expect(borrowed('《花样年华》《花样年华》王家卫', it)).toBe('');
    expect(borrowed('雨夜', { title: 'x', why: '雨夜', tags: [] })).toBe('');
    expect(borrowed('the quiet radio hour', { title: 'x', why: 'a quiet radio', tags: [] })).toBe('quiet');
  });
});

describe('v0.42 意外程度 / 复制分享记下来（repo，不加索引）', () => {
  it('setSurprise 1–5，再点取消；markOut 记时间', async () => {
    const id = await db.developments.add(dev({ id: undefined }));
    await setSurprise(id, 4);
    expect((await db.developments.get(id))!.surprise).toBe(4);
    await setSurprise(id, 9);
    expect((await db.developments.get(id))!.surprise).toBeUndefined();
    await markOut(id);
    expect((await db.developments.get(id))!.out).toBeGreaterThan(0);
    expect(db.verno).toBe(12);
  });
});
