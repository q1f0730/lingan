import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseJSONLoose } from '../lib/ai';
import { LinganDB, addItem, exportAll, importAll, normalizeTags } from '../lib/db';
import { buildPrompt, developOffline, normalizeIdea } from '../lib/develop';
import { drawSamples } from '../lib/samples';
import { mulberry32 as seeded } from '../lib/similarity';
// v0.14：从约 80 条示例池里按固定种子抽，不同测试文件用不同的种子，别总是那几条
const SAMPLES = drawSamples(10, seeded(1401)).map(({ sample: _s, ...rest }) => (void _s, rest));
import { cosine, mulberry32, pickItems, similarity } from '../lib/similarity';
import { computeTaste } from '../lib/taste';
import type { Item } from '../lib/types';

const items: Item[] = SAMPLES.map((s, i) => ({ ...s, id: i + 1, createdAt: Date.now() - i * 86400000, updatedAt: Date.now() }));

describe('tags', () => {
  it('normalizes', () => {
    expect(normalizeTags('#雨, 克制，雨  慢镜头')).toEqual(['雨', '克制', '慢镜头']);
    expect(normalizeTags(['', ' a ', 'a'])).toEqual(['a']);
  });
});

describe('json parse', () => {
  it('extracts json from fenced or chatty output', () => {
    expect(parseJSONLoose<{ a: number }>('好的：```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJSONLoose<{ s: string }>('x {"s":"有}括号{"} y')).toEqual({ s: '有}括号{' });
    expect(parseJSONLoose('no json')).toBeNull();
  });
  it('normalizes idea', () => {
    const i = normalizeIdea({ title: 'T', idea: 'body', cliches: ['a', 2], first_step: 'go' }, 'ob');
    expect(i?.cliches).toEqual(['a', '2']);
    expect(i?.firstStep).toBe('go');
    expect(i?.oblique).toBe('ob');
    expect(normalizeIdea({ title: 'only' }, 'x')).toBeNull();
  });
});

describe('similarity & picking', () => {
  it('cosine', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([], [])).toBe(0);
  });
  it('similarity in range and self-similar', () => {
    for (const a of items) for (const b of items) {
      const s = similarity(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(similarity(items[0], items[0])).toBeGreaterThan(similarity(items[0], items[5]));
  });
  it('picks n distinct items deterministically with seed', () => {
    const a = pickItems(items, 3, 0.9, mulberry32(7));
    const b = pickItems(items, 3, 0.9, mulberry32(7));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(new Set(a.map((x) => x.id)).size).toBe(3);
    expect(pickItems(items.slice(0, 2), 3, 0.5)).toHaveLength(2);
  });
  it('far jump yields lower avg similarity than near jump', () => {
    let far = 0, near = 0;
    for (let s = 1; s <= 40; s++) {
      const f = pickItems(items, 2, 1, mulberry32(s));
      const n = pickItems(items, 2, 0, mulberry32(s));
      far += similarity(f[0], f[1]);
      near += similarity(n[0], n[1]);
    }
    expect(far).toBeLessThan(near);
  });
});

describe('develop', () => {
  it('offline idea is complete', () => {
    const i = developOffline(items.slice(0, 3), { theme: '一首歌', rand: mulberry32(1) });
    expect(i.title).toBeTruthy();
    expect(i.idea).toContain('一首歌');
    expect(i.oblique).toBeTruthy();
  });
  it('prompt includes items and ban instruction', () => {
    const p = buildPrompt(items.slice(0, 2), { oblique: 'X' });
    expect(p.user).toContain(items[0].title);
    expect(p.system).toContain('套路');
  });
});

describe('taste', () => {
  it('computes stats', () => {
    const t = computeTaste(items);
    expect(t.total).toBe(items.length);
    expect(t.byType.music).toBe(items.filter((i) => i.type === 'music').length);
    expect(t.last7).toHaveLength(7);
    expect(t.streakDays).toBeGreaterThanOrEqual(1);
    expect(t.decades.length).toBeGreaterThan(0);
  });
  it('empty', () => {
    const t = computeTaste([]);
    expect(t.total).toBe(0);
    expect(t.streakDays).toBe(0);
  });
});

describe('db roundtrip', () => {
  it('export → import merges and remaps', async () => {
    const d1 = new LinganDB('t1');
    const a = await addItem(SAMPLES[0], d1);
    const b = await addItem(SAMPLES[1], d1);
    await d1.developments.add({ itemIds: [a, b], jump: 0.5, idea: { title: 't', bridge: '', idea: 'x', cliches: [] }, source: 'offline', createdAt: 1 });
    const bk = await exportAll(d1);
    const d2 = new LinganDB('t2');
    await addItem(SAMPLES[2], d2);
    const r = await importAll(JSON.parse(JSON.stringify(bk)), d2);
    expect(r).toEqual({ items: 2, developments: 1 });
    expect(await d2.items.count()).toBe(3);
    const dev = (await d2.developments.toArray())[0];
    const ids = (await d2.items.toArray()).map((x) => x.id);
    for (const id of dev.itemIds) expect(ids).toContain(id);
    await expect(importAll({ foo: 1 }, d2)).rejects.toThrow();
  });
});

import { extractUrl, guessType, parseHtmlMeta } from '../lib/linkmeta';
describe('linkmeta', () => {
  it('guesses type by host', () => {
    expect(guessType('https://music.163.com/song?id=1')).toBe('music');
    expect(guessType('https://movie.douban.com/subject/1/')).toBe('film');
    expect(guessType('https://a.com/x.JPG?v=2')).toBe('image');
    expect(guessType('https://example.com')).toBe('link');
    expect(guessType('not a url')).toBe('link');
  });
  it('extracts url from share text', () => {
    expect(extractUrl('分享歌曲《晴天》https://y.qq.com/n/ryqq/songDetail/abc （来自QQ音乐）')).toBe('https://y.qq.com/n/ryqq/songDetail/abc');
    expect(extractUrl('无链接')).toBeNull();
  });
  it('parses og meta', () => {
    const html = `<html><head><title>x</title><meta property="og:title" content="花样年华 (2000) (豆瓣)"><meta content="/img/p.jpg" property="og:image"><meta name="description" content="A &amp; B"></head></html>`;
    const m = parseHtmlMeta(html, 'https://movie.douban.com/subject/1291557/');
    expect(m.title).toBe('花样年华');
    expect(m.year).toBe('2000');
    expect(m.image).toBe('https://movie.douban.com/img/p.jpg');
    expect(m.description).toBe('A & B');
    expect(m.type).toBe('film');
  });
});
