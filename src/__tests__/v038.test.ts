// v0.38 向量与关系：端侧小模型（解析 / Unigram 分词 / 平均向量）、作品实体、穗间连线、一起被嫁接、母题聚类与星图、自写动效
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Development, Item } from '../lib/types';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
beforeAll(() => {
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {}, __gleanReady: 1 });
});

/** 造一个小模型文件：和 scripts/mini/build.py 写出来的格式一样 */
function fakeModel(words: Array<[string, number, number[]]>, dim = 4): ArrayBuffer {
  const voc = new TextEncoder().encode(words.map((w) => w[0]).join('\n'));
  const pad = (4 - (voc.length % 4)) % 4;
  const n = words.length;
  const buf = new ArrayBuffer(16 + voc.length + pad + n * 8 + n * dim);
  const u = new Uint8Array(buf);
  u.set([71, 77, 49, 0]);
  const dv = new DataView(buf);
  dv.setUint32(4, n, true);
  dv.setUint32(8, dim, true);
  dv.setUint32(12, voc.length, true);
  u.set(voc, 16);
  const o = 16 + voc.length + pad;
  words.forEach(([, s, v], i) => {
    dv.setFloat32(o + i * 4, s, true);
    const mx = Math.max(...v.map(Math.abs)) || 1;
    dv.setFloat32(o + n * 4 + i * 4, mx / 127, true);
    v.forEach((x, d) => dv.setInt8(o + n * 8 + i * dim + d, Math.round((x / mx) * 127)));
  });
  return buf;
}

describe('端侧向量（ROADMAP v0.21）：本机小模型', () => {
  const W: Array<[string, number, number[]]> = [
    ['▁', -3, [0, 0, 0, 1]],
    ['孤独', -6, [1, 0, 0, 0]],
    ['孤', -9, [0.5, 0.5, 0, 0]],
    ['独', -9, [0.5, -0.5, 0, 0]],
    ['一个人', -7, [0.9, 0.1, 0, 0]],
    ['一', -8, [0, 0, 1, 0]],
    ['个', -8, [0, 0, 1, 0]],
    ['人', -8, [0, 0, 1, 0]],
    ['热闹', -6, [-1, 0, 0, 0]],
  ];
  it('解析文件头、词表、分数、缩放', async () => {
    const { parseMini } = await import('../lib/mini');
    const m = parseMini(fakeModel(W));
    expect(m.dim).toBe(4);
    expect(m.voc.size).toBe(W.length);
    expect(m.max).toBe(3);
    expect(m.score[1]).toBeCloseTo(-6);
    expect(() => parseMini(new ArrayBuffer(16))).toThrow();
  });
  it('Unigram 取总分最高的切法（整词胜过拆字），认不出的字丢掉', async () => {
    const { parseMini, tokenize } = await import('../lib/mini');
    const m = parseMini(fakeModel(W));
    const w = (s: string) => tokenize(m, s).map((k) => W[k][0]);
    expect(w('孤独')).toEqual(['▁', '孤独']);
    expect(w('一个人')).toEqual(['▁', '一个人']);
    expect(w('孤独X热闹')).toEqual(['▁', '孤独', '热闹']);
    expect(w('  ')).toEqual(['▁']);
  });
  it('向量 = 词元平均后归一化；意思近的余弦更高', async () => {
    const { parseMini, embedOne } = await import('../lib/mini');
    const { cosine } = await import('../lib/similarity');
    const m = parseMini(fakeModel(W));
    const a = embedOne(m, '孤独'),
      b = embedOne(m, '一个人'),
      c = embedOne(m, '热闹');
    expect(Math.hypot(...a)).toBeCloseTo(1, 4);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
  it('没配向量模型、但下了本机小模型时 embedConfig 用它；私密穗也算（不出设备）', async () => {
    const { embedConfig, defaultSettings } = await import('../lib/settings');
    const { MINI, MINI_KEY, allowPrivate, aiVisible } = await import('../lib/privacy');
    const s = defaultSettings();
    s.embed = { ...s.embed, model: '', baseUrl: '' };
    expect(embedConfig(s)).toBeNull();
    localStorage.setItem(MINI_KEY, 'glean-mini-zh-v1');
    expect(embedConfig(s)).toEqual({ baseUrl: MINI, apiKey: '', model: 'glean-mini-zh-v1' });
    expect(allowPrivate(s, MINI)).toBe(true);
    expect(aiVisible({ private: 1 }, s, 'https://api.siliconflow.cn/v1')).toBe(false);
    // 配了别的向量模型时优先用那个
    s.embed = { ...s.embed, model: 'bge-m3', baseUrl: 'http://127.0.0.1:1234/v1', sameAsChat: false };
    s.preset = 'local';
    expect(embedConfig(s)?.model).toBe('bge-m3');
    localStorage.removeItem(MINI_KEY);
  });
  it('下载地址固定到发版 tag、核对 SHA-256', async () => {
    const m = await import('../lib/mini');
    expect(m.MINI_URLS.every((u) => u.includes('v0.38.0') && u.endsWith('mini-zh-v1.bin'))).toBe(true);
    expect(m.MINI_SHA).toMatch(/^[0-9a-f]{64}$/);
  });
});

const it0 = (n: number, x: Partial<Item>): Item => ({ id: n, uid: 'U' + n, type: 'film', title: 't' + n, tags: [], createdAt: n, updatedAt: n, ...x });

describe('0104 作品实体 / 0153 同曲不同平台', () => {
  it('作品名规范化：版本括号、Live、标点、大小写、全角都不算', async () => {
    const { normWork } = await import('../lib/relate');
    expect(normWork('晴天 (Live)')).toBe(normWork('晴天'));
    expect(normWork('晴天 - 2019 Remastered')).toBe('晴天');
    expect(normWork('In the Mood for Love')).toBe(normWork('in the mood for love'));
    expect(normWork('《花样年华》【4K修复】')).toBe('花样年华');
    expect(normWork('ＡＢＣ')).toBe('abc');
  });
  it('作品名：《》优先；电影 / 音乐 / 摘抄看标题；手动归属与拆出', async () => {
    const { workName } = await import('../lib/relate');
    expect(workName({ type: 'image', title: '《花样年华》剧照' })).toBe('花样年华');
    expect(workName({ type: 'image', title: '雨夜' })).toBe('');
    expect(workName({ type: 'music', title: '晴天' })).toBe('晴天');
    expect(workName({ type: 'film', title: '花样年华', work: '' })).toBe('');
    expect(workName({ type: 'idea', title: '随便', work: '重庆森林' })).toBe('重庆森林');
  });
  it('同作品：名字一样、作者不冲突（一边没写也算）', async () => {
    const { sameWork } = await import('../lib/relate');
    const a = it0(1, { title: '花样年华', creator: '王家卫' });
    const all = [a, it0(2, { type: 'image', title: '《花样年华》剧照' }), it0(3, { type: 'text', title: '花样年华', creator: '王家卫' }), it0(4, { title: '花样年华', creator: '别人' }), it0(5, { type: 'music', title: '晴天 (Live)' }), it0(6, { title: '花样年华', deletedAt: 9 })];
    expect(sameWork(a, all).map((x) => x.id)).toEqual([2, 3]);
    expect(sameWork(it0(7, { type: 'music', title: '晴天' }), all).map((x) => x.id)).toEqual([5]);
    expect(sameWork(it0(8, { title: '花样年华', work: '' }), all)).toEqual([]);
  });
});

describe('0105 穗间连线 / 0151 一起被嫁接', () => {
  it('连线两头各存一条，换种类覆盖、拆掉两头都没了（存在库里，按 uid）', async () => {
    const { db } = await import('../lib/db');
    const { linkItems } = await import('../lib/relate');
    await db.open();
    const a = (await db.items.get(await db.items.add({ type: 'film', title: 'A', tags: [], createdAt: 1, updatedAt: 1 } as Item)))!;
    const b = (await db.items.get(await db.items.add({ type: 'music', title: 'B', tags: [], createdAt: 2, updatedAt: 2 } as Item)))!;
    expect(a.uid && b.uid).toBeTruthy();
    await linkItems(a, b, 'lead');
    let [x, y] = await db.items.bulkGet([a.id!, b.id!]);
    expect(x!.links).toEqual([expect.objectContaining({ to: b.uid, k: 'lead' })]);
    expect(y!.links).toEqual([expect.objectContaining({ to: a.uid, k: 'lead', r: 1 })]);
    await linkItems(a, b, 'like');
    [x, y] = await db.items.bulkGet([a.id!, b.id!]);
    expect(x!.links!.length).toBe(1);
    expect(y!.links![0].k).toBe('like');
    await linkItems(a, b, null);
    [x, y] = await db.items.bulkGet([a.id!, b.id!]);
    expect(x!.links).toBeUndefined();
    expect(y!.links).toBeUndefined();
    // 自己连自己不算
    await linkItems(a, a, 'like');
    expect((await db.items.get(a.id!))!.links).toBeUndefined();
  });
  it('一起被嫁接：按次数排、去掉回收站里的新枝', async () => {
    const { coGrafted } = await import('../lib/relate');
    const d = (ids: number[], del?: number) => ({ itemIds: ids, deletedAt: del }) as Development;
    expect(coGrafted([d([1, 2, 3]), d([1, 2]), d([1, 4]), d([1, 4], 5), d([2, 3])], 1)).toEqual([
      [2, 2],
      [3, 1],
      [4, 1],
    ]);
  });
});

describe('0106 母题聚类 / 0123 消长 / 0124 跨媒介 / 星图', () => {
  const DAY = 86400000;
  const now = 400 * DAY;
  const grp = (tag: string, why: string, types: Item['type'][], n: number, start: number, age: number) =>
    Array.from({ length: n }, (_, i) => it0(start + i, { type: types[i % types.length], title: `${tag}${i}`, tags: [tag], why, createdAt: now - age * DAY - i }));
  const items = [...grp('夜车', '末班车窗外的灯', ['film', 'music', 'image'], 8, 100, 10), ...grp('海边', '夏天的海风和汽水', ['image'], 8, 200, 90), ...grp('雨', '湿漉漉的街道下雨', ['film'], 8, 300, 200)];
  it('k-means 把三团明显分开的向量分成三簇，结果稳定', async () => {
    const { kmeans } = await import('../lib/motifs');
    const v = (a: number[]) => Float32Array.from(a);
    const vs = [v([1, 0, 0]), v([0.9, 0.1, 0]), v([0, 1, 0]), v([0.1, 0.9, 0]), v([0, 0, 1]), v([0, 0.1, 0.9])];
    const a = kmeans(vs, 3);
    expect(a[0]).toBe(a[1]);
    expect(a[2]).toBe(a[3]);
    expect(a[4]).toBe(a[5]);
    expect(new Set(a).size).toBe(3);
    expect(kmeans(vs, 3)).toEqual(a);
  });
  it('没向量时按标签 + 为什么聚，簇名取最有区分度的词；跨媒介、升起 / 冷下来', async () => {
    const { motifMap, stars } = await import('../lib/motifs');
    const mm = motifMap(items, now)!;
    expect(mm.how).toBe('text');
    const names = mm.motifs.map((m) => m.name);
    for (const t of ['夜车', '海边', '雨']) expect(names).toContain(t);
    const night = mm.motifs.find((m) => m.name === '夜车')!;
    expect(night.cross).toBe(true);
    expect(night.recent).toBe(8);
    expect(mm.motifs.find((m) => m.name === '海边')!.trend).toBe(-8);
    expect(mm.motifs.find((m) => m.name === '雨')!.cross).toBe(false);
    const pts = stars(mm);
    expect(pts.length).toBe(items.length);
    expect(pts.every((p) => Math.abs(p.x) <= 1.0001 && Math.abs(p.y) <= 1.0001)).toBe(true);
    // 同一母题的星挨着：簇内平均距离 < 簇间
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    let inn = 0, ni = 0, out = 0, no = 0;
    for (const a of pts)
      for (const b of pts) {
        if (a === b) continue;
        if (a.c === b.c) {
          inn += d(a, b);
          ni++;
        } else {
          out += d(a, b);
          no++;
        }
      }
    expect(inn / ni).toBeLessThan(out / no);
  });
  it('有向量（≥80% 同一模型）就用向量；少于 12 穗不聚', async () => {
    const { motifMap, vectorize } = await import('../lib/motifs');
    const withV = items.map((x, i) => ({ ...x, embedModel: 'm', embedding: [i % 3 === 0 ? 1 : 0, i % 3 === 1 ? 1 : 0, i % 3 === 2 ? 1 : 0] }));
    expect(vectorize(withV).how).toBe('vector');
    expect(motifMap(withV, now)!.how).toBe('vector');
    expect(motifMap(items.slice(0, 11), now)).toBeNull();
  });
});

describe('v0.38 体积：Framer Motion 换成自写 lite', () => {
  const src = {
    ...import.meta.glob('../components/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob('../views/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob('../App.tsx', { query: '?raw', import: 'default', eager: true }),
  } as Record<string, string>;
  it('源码里不再 import framer-motion', () => {
    expect(Object.entries(src).filter(([, s]) => s.includes("'framer-motion'")).map(([f]) => f)).toEqual([]);
  });
});
