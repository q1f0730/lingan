// v0.41 找得到 · 逛得开：繁简互搜 / 智能穗束 / 命令面板 / 你忘了你收过 / 没结果的下一步 / 漫步 / 穗仓的空地 + 早长按常量
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Development, Item } from '../lib/types';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
beforeAll(() => {
  vi.stubGlobal('localStorage', memStorage());
});
beforeEach(() => localStorage.clear());

const DAY = 864e5;
let nid = 1;
const mk = (o: Partial<Item> = {}): Item => ({ id: nid++, uid: 'u' + nid, type: 'idea', title: 't' + nid, tags: [], createdAt: Date.UTC(2026, 9, 15), updatedAt: 0, ...o }) as Item;

describe('0134 繁简互搜', () => {
  it('字表解码：2000+ 个简体字，常见字对得上', async () => {
    const z = await import('../lib/zhvar');
    expect(z.zhvarSize()).toBeGreaterThan(2000);
    expect(z.toSimp('花樣年華')).toBe('花样年华');
    expect(z.toTrads('花样年华')).toContain('花樣年華');
    expect(z.toSimp('重慶森林')).toBe('重庆森林');
  });
  it('变体：去掉原文自身；一简多繁有上限；纯 ASCII 没有变体', async () => {
    const z = await import('../lib/zhvar');
    expect(z.zhVariants('花样年华')).toEqual(['花樣年華']);
    expect(z.zhVariants('花樣年華')).toContain('花样年华');
    expect(z.toTrads('头发', 4).length).toBeLessThanOrEqual(4);
    expect(z.toTrads('头发', 6)).toContain('頭髮');
    expect(z.zhVariants('abc')).toEqual([]);
  });
  it('并进搜索：简体查询找到繁体原文（不改索引）', async () => {
    const z = await import('../lib/zhvar');
    const s = await import('../lib/search');
    const docs = [mk({ title: '花樣年華' }), mk({ title: '春光乍泄' })].map((i) => s.toDoc('i', i));
    expect(s.searchDocs(null, docs, s.parseQuery('花样年华'))).toHaveLength(0);
    const hits = z.zhVariants('花样年华').flatMap((v) => s.searchDocs(null, docs, s.parseQuery(v)));
    expect(hits.map((h) => (h.doc.obj as Item).title)).toEqual(['花樣年華']);
  });
});

describe('0128 智能穗束 / 0137 命令面板 / 0133 / 0428', () => {
  it('智能穗束：新的在前、去重、上限、chip 写进查询', async () => {
    const p = await import('../lib/searchplus');
    let l = p.addSmart([], ' 雨  夜 ', 1);
    l = p.addSmart(l, 'type:电影', 2);
    l = p.addSmart(l, '雨 夜', 3);
    expect(l.map((x) => x.q)).toEqual(['雨 夜', 'type:电影']);
    for (let i = 0; i < 20; i++) l = p.addSmart(l, 'q' + i, i);
    expect(l).toHaveLength(p.SMART_MAX);
    p.saveSmart(l);
    expect(p.loadSmart()).toHaveLength(p.SMART_MAX);
    expect(p.dropSmart(l, 'q19').some((x) => x.q === 'q19')).toBe(false);
    expect(p.smartQuery('雨', 'film', '深夜 城市')).toBe('雨 type:电影 tag:"深夜 城市"');
    expect(p.smartQuery('type:音乐 雨', 'music', null)).toBe('type:音乐 雨');
    expect(p.smartQuery('', 'branch', null)).toBe('');
  });
  it('命令面板：> / ＞ 开头；前缀优先；关键词也认', async () => {
    const p = await import('../lib/searchplus');
    expect(p.isCommand('>设置')).toBe(true);
    expect(p.isCommand(' ＞ 口味')).toBe(true);
    expect(p.isCommand('a>b')).toBe(false);
    expect(p.commandText('> Settings ')).toBe('settings');
    const cmds = [
      { id: 'a', label: '去穗仓', keys: 'library' },
      { id: 'b', label: '去设置', keys: 'settings' },
      { id: 'c', label: '拾一穗', keys: 'new add' },
    ];
    expect(p.filterCmds(cmds, '').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(p.filterCmds(cmds, 'set').map((c) => c.id)).toEqual(['b']);
    expect(p.filterCmds(cmds, '去').map((c) => c.id)).toEqual(['a', 'b']);
    expect(p.filterCmds(cmds, '穗').map((c) => c.id)).toEqual(['a', 'c']);
  });
  it('你忘了你收过：取命中里最老、且够久的一穗', async () => {
    const p = await import('../lib/searchplus');
    const now = Date.UTC(2026, 10, 4);
    const a = mk({ createdAt: now - 800 * DAY });
    const b = mk({ createdAt: now - 400 * DAY });
    const c = mk({ createdAt: now - 10 * DAY });
    expect(p.forgotten([c], now)).toBeNull();
    const f = p.forgotten([c, b, a], now)!;
    expect(f.it).toBe(a);
    expect(p.agoText(f)).toBe('2 年前');
    expect(p.agoText(p.forgotten([mk({ createdAt: now - 320 * DAY })], now)!)).toBe('10 个月前');
  });
  it('没结果：列出能放宽的筛选', async () => {
    const p = await import('../lib/searchplus');
    expect(p.loosenOptions({ type: 'all', tag: null, range: 'all', filters: 0 })).toEqual([]);
    const l = p.loosenOptions({ type: 'film', typeLabel: '电影', tag: '夜', range: '7d', rangeLabel: '近 7 天', filters: 1 });
    expect(l.map((x) => x.id)).toEqual(['syntax', 'type', 'tag', 'range']);
    expect(l[1].label).toContain('电影');
  });
});

describe('0132 漫步', () => {
  it('连线 > 同一部作品 > 一起嫁接 > 相近 > 随便；走过的不再走', async () => {
    const { walkNext } = await import('../lib/relate');
    const a = mk({ type: 'film', title: '花样年华', creator: '王家卫', tags: ['旗袍'] });
    const linked = mk({ title: '远处的塔', tags: ['雾'] });
    a.links = [{ to: linked.uid!, k: 'like', at: 1 }];
    const mate = mk({ type: 'film', title: '花样年华（4K 修复）', creator: '王家卫' });
    const co = mk({ title: '无关的一穗', tags: ['猫'] });
    const near = mk({ type: 'film', title: '旗袍走廊', tags: ['旗袍'] });
    const all = [a, linked, mate, co, near];
    const devs = [{ id: 1, itemIds: [a.id!, co.id!], jump: 3, source: 'offline', idea: { title: '', bridge: '', idea: '', cliches: [] }, createdAt: 1 } as unknown as Development];
    const seen = new Set<number>([a.id!]);
    const s1 = walkNext(a, all, devs, seen)!;
    expect(s1.x).toBe(linked);
    expect(s1.why).toContain('连线');
    seen.add(linked.id!);
    expect(walkNext(a, all, devs, seen)!.x).toBe(mate);
    seen.add(mate.id!);
    expect(walkNext(a, all, devs, seen)!.why).toBe('一起被嫁接过 1 次');
    seen.add(co.id!);
    expect(walkNext(a, all, devs, seen)!.x).toBe(near);
    seen.add(near.id!);
    expect(walkNext(a, all, devs, seen)).toBeNull();
  });
  it('被连的那一头也算；放下的、删掉的不走', async () => {
    const { walkNext } = await import('../lib/relate');
    const a = mk({ title: 'A' });
    const b = mk({ title: 'B', links: [{ to: a.uid!, k: 'reply', at: 1 }] });
    const gone = mk({ title: 'C', deletedAt: 5 });
    const down = mk({ title: 'D', down: 1 } as Partial<Item>);
    expect(walkNext(a, [a, gone, down, b], [], new Set([a.id!]))!.x).toBe(b);
    expect(walkNext(a, [a, gone, down], [], new Set([a.id!]))).toBeNull();
  });
});

describe('ROADMAP v0.41 穗仓的空地', () => {
  it('少于 10 穗不提示；没有电影类时出现对应提示；只有提示和问题', async () => {
    const { findGaps } = await import('../lib/gaps');
    expect(findGaps(Array.from({ length: 9 }, () => mk()))).toEqual([]);
    const items = Array.from({ length: 12 }, (_, i) => mk({ type: (['music', 'image', 'text', 'link', 'idea'] as const)[i % 5] }));
    const g = findGaps(items);
    const film = g.find((x) => x.kind === 'type' && x.key === 'film');
    expect(film?.hint).toBe('你还没收过电影穗。');
    expect(film?.ask.endsWith('？')).toBe(true);
    for (const x of g) expect(/https?:|推荐|豆瓣|榜单/.test(x.hint + x.ask)).toBe(false);
  });
  it('年代断档与情绪空白', async () => {
    const { findGaps } = await import('../lib/gaps');
    const ys = ['1975', '1978', '1999', '2001', '2005', '2010', '2015', '2020', '2023', '1992'];
    const items = ys.map((y, i) => mk({ type: (['music', 'film', 'image', 'text', 'link', 'idea'] as const)[i % 6], year: y, why: i % 2 ? '很温暖' : '有点难过' }));
    const g = findGaps(items, 10);
    expect(g.some((x) => x.kind === 'decade' && x.key === '1980')).toBe(true);
    expect(g.some((x) => x.kind === 'mood' && x.key === 'fun')).toBe(true);
    expect(g.some((x) => x.kind === 'mood' && x.key === 'warm')).toBe(false);
    expect(findGaps(items).length).toBeLessThanOrEqual(3);
  });
});

describe('早长按代收（v0.40 遗留修复）', () => {
  it('App 与 CardMenu 共用同一组长按常量', async () => {
    const p = await import('../lib/press');
    expect(p.LONG_PRESS_MS).toBe(480);
    expect(p.MOVE_TOL).toBe(10);
  });
});
