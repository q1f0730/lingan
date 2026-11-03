// v0.34 分享出去 · 隐私边界：0899 逐项勾选 / 0909 个人信息扫描 / 0900 递来的 / 0901–0903 花园 / 0905 出站总开关 / 0916 溯源穗三档 / 明信片断行 / 0908 本机设置不进备份
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { branchShareText, handLink, itemShareText, maskHit, readSharePrefs, scanPersonal, writeSharePrefs, PUBLIC_NAME } from '../lib/sharekit';
import { parseLink, routeLink, type LinkCtx } from '../lib/deeplink';
import { addHanded, dropHanded, readHanded } from '../lib/handed';
import { buildGarden, gardenItems, gardenText } from '../lib/garden';
import { GATE_MSG, mayReach, outboundOff, setOutboundOff } from '../lib/gate';
import { getFetch } from '../lib/ai';
import { wrapText } from '../lib/postcard';
import { readLocalPrefs } from '../lib/localprefs';
import { db } from '../lib/db';
import { defaultSettings } from '../lib/settings';
import type { Item } from '../lib/types';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
const g = globalThis as unknown as { localStorage?: Storage; window?: unknown };
beforeEach(() => {
  g.localStorage = memStorage();
  if (!g.window) g.window = new EventTarget();
});
afterEach(() => {
  delete g.localStorage;
});

const it0 = (o: Partial<Item>): Item => ({ id: 1, type: 'text', title: '空房间', content: '下午的光照进空房间', tags: ['光', '房间'], why: '像我奶奶家', url: 'https://www.bilibili.com/video/BV1xx?spm_id_from=333&vd_source=abc&t=30', source: '微信', createdAt: Date.UTC(2026, 9, 19, 4), updatedAt: 0, uid: '01HZY3K9V7Q2W8E5R6T4Y1U0IO', ...o });

describe('0909 scanPersonal', () => {
  it('finds phone / id / email / custom words', () => {
    const t = '联系我 138-1234-5678 或 +86 13912345678，身份证 11010519491231002X，邮箱 a.b@qq.com，住在徐钢一宿舍';
    const hits = scanPersonal(t, ['徐钢一宿舍', '渠']);
    expect(hits.map((h) => h.kind)).toEqual(['手机号', '手机号', '身份证号', '邮箱', '敏感词']);
    expect(hits.find((h) => h.kind === '敏感词')?.text).toBe('徐钢一宿舍');
  });
  it('no false positives on dates, ids in links, counts, ULIDs', () => {
    for (const t of ['2024 年最好的十张专辑', 'https://music.163.com/song?id=5257138', '12345678901', '01HZY3K9V7Q2W8E5R6T4Y1U0IO', '共 1000 穗，第 13812 页', 'BV1GJ411x7h7'])
      expect(scanPersonal(t, []), t).toEqual([]);
  });
  it('masks what it shows back', () => {
    expect(maskHit({ kind: '手机号', text: '138-1234-5678' })).toBe('138****5678');
    expect(maskHit({ kind: '邮箱', text: 'qyf@qq.com' })).toBe('q***@qq.com');
    expect(maskHit({ kind: '敏感词', text: '徐钢一宿舍' })).toBe('徐****');
    expect(maskHit({ kind: '身份证号', text: '11010519491231002X' })).toBe('110****2X');
  });
});

describe('0899 / 0901 share text', () => {
  it('defaults to title + content only; public name defaults to Q1f730', () => {
    expect(readSharePrefs().name).toBe(PUBLIC_NAME);
    const t = itemShareText(it0({}), ['title', 'content']);
    expect(t).toBe('空房间\n下午的光照进空房间');
    expect(t).not.toContain('奶奶');
    expect(t).not.toContain('bilibili');
  });
  it('optional fields; links lose tracking params', () => {
    const t = itemShareText(it0({}), ['title', 'why', 'url', 'tags', 'time', 'source']);
    expect(t).toContain('为什么：像我奶奶家');
    expect(t).toContain('https://www.bilibili.com/video/BV1xx?t=30');
    expect(t).not.toMatch(/spm_id_from|vd_source/);
    expect(t).toContain('#光 #房间');
    expect(t).toContain('拾于 2026-10-19');
    expect(t).toContain('来自 微信');
  });
  it('prefs round-trip; blank name falls back', () => {
    writeSharePrefs({ name: '  ', words: [' 渠一帆 ', '', '泰州'] });
    expect(readSharePrefs()).toMatchObject({ name: PUBLIC_NAME, words: ['渠一帆', '泰州'] });
  });
});

describe('0900 hand link → 递来的', () => {
  it('carries only chosen fields, never why / uid, and parses back with from', () => {
    const link = handLink(it0({}), ['title', 'content'], 'Q1f730');
    expect(link).not.toMatch(/why|01HZY|bilibili/);
    const l = parseLink(link);
    expect(l).toMatchObject({ k: 'capture', title: '空房间', text: '下午的光照进空房间', url: '', from: 'Q1f730' });
    const l2 = parseLink(handLink(it0({}), ['title', 'url'], '小明'));
    expect(l2).toMatchObject({ url: 'https://www.bilibili.com/video/BV1xx?t=30', from: '小明' });
  });
  it('routeLink with from goes to the handed inbox, not the library', async () => {
    const log: string[] = [];
    const c: LinkCtx = { settings: defaultSettings(), openItem: () => void 0, developFrom: () => void 0, toast: (m) => void log.push(m), goTo: () => void 0, quick: () => void 0 };
    const before = await db.items.count();
    await routeLink(handLink(it0({}), ['title', 'content'], '小明'), c);
    await routeLink(handLink(it0({}), ['title', 'content'], '小明'), c);
    expect(await db.items.count()).toBe(before);
    const h = readHanded();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ from: '小明', title: '空房间', text: '下午的光照进空房间' });
    expect(log[0]).toContain('小明 递来一穗');
    dropHanded(h[0].id);
    expect(readHanded()).toEqual([]);
    addHanded({ from: 'a', title: 't', text: '', url: 'https://x.com', tags: [] });
    expect(readHanded()).toHaveLength(1);
  });
});

describe('0916 branch share', () => {
  const b = { title: '《末班车上的空房间》', idea: '把一间空房间装进末班车', form: '短片' };
  const src = [it0({ type: 'film', title: '花样年华', creator: '王家卫' }), it0({ id: 2, title: '日记', private: 1 })];
  it('show / plain / none; private sprigs never named', () => {
    const show = branchShareText(b, src, 'show', 'Q1f730');
    expect(show).toContain('电影 · 花样年华 · 王家卫');
    expect(show).toContain('一穗私密的');
    expect(show).not.toContain('日记');
    expect(show).toContain('—— Q1f730 · 拾穗 Glean');
    const plain = branchShareText(b, src, 'plain', 'Q1f730');
    expect(plain).toContain('电影 · 花样年华');
    expect(plain).not.toContain('王家卫');
    expect(branchShareText(b, src, 'none', 'Q1f730')).not.toContain('因为这几穗');
  });
});

describe('0902 / 0903 garden', () => {
  const rows = [
    it0({ id: 1, garden: 1, title: '<script>alert(1)</script>' }),
    it0({ id: 2, garden: 1, private: 1, title: '私密的' }),
    it0({ id: 3, title: '没标花园' }),
    it0({ id: 4, garden: 1, deletedAt: 1, title: '删掉的' }),
    it0({ id: 5, garden: 1, sample: 1, title: '示例' }),
  ];
  it('only garden-marked, non-private, alive, non-sample items', () => {
    expect(gardenItems(rows).map((x) => x.id)).toEqual([1]);
  });
  it('html: name, escaped, clean links, no why / uid / source / exact day unless asked', async () => {
    let asked = 0;
    const html = await buildGarden(gardenItems(rows), { name: 'Q1f730', withWhy: false, image: async () => (asked++, null), now: Date.UTC(2026, 10, 4) });
    expect(asked).toBe(1);
    expect(html).toContain('Q1f730 的花园');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/spm_id_from|vd_source|奶奶|01HZY3K9|微信|2026-10-19/);
    expect(html).toContain('2026.10');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    const withWhy = await buildGarden(gardenItems(rows), { name: 'x', withWhy: true, image: async () => null });
    expect(withWhy).toContain('像我奶奶家');
    expect(gardenText(rows[0], false)).not.toContain('奶奶');
  });
});

describe('0905 outbound gate', () => {
  it('blocks remote, allows local, default open', async () => {
    expect(outboundOff()).toBe(false);
    expect(mayReach('https://api.example.com')).toBe(true);
    setOutboundOff(true);
    expect(mayReach('https://api.example.com/v1')).toBe(false);
    expect(mayReach('http://127.0.0.1:1234/v1')).toBe(true);
    expect(mayReach('http://192.168.1.8:47322/x')).toBe(true);
    const f = await getFetch();
    await expect(f('https://api.example.com/v1/chat/completions')).rejects.toThrow(GATE_MSG);
    setOutboundOff(false);
    expect(outboundOff()).toBe(false);
  });
});

describe('postcard wrapText', () => {
  const m = (s: string) => [...s].length * 10;
  it('wraps CJK by char, keeps latin words, no punctuation at line start', () => {
    const lines = wrapText('把一间空房间装进末班车，让它在夜里慢慢开走。', 100, m);
    expect(lines.every((l) => !/^[，。]/.test(l))).toBe(true);
    expect(lines.join('')).toBe('把一间空房间装进末班车，让它在夜里慢慢开走。');
    expect(wrapText('hello world foo', 60, m)).toEqual(['hello', 'world', 'foo']);
  });
  it('ellipsis past max lines', () => {
    const lines = wrapText('一二三四五六七八九十'.repeat(5), 100, m, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(m(lines[1])).toBeLessThanOrEqual(100);
  });
});

describe('0908 本机隐私设置不进备份', () => {
  it('share prefs (敏感词) and handed inbox are not part of .glean local prefs', () => {
    writeSharePrefs({ name: 'Q1f730', words: ['渠一帆'] });
    addHanded({ from: '小明', title: '一穗', text: '', url: 'https://x.com', tags: [] });
    const lp = JSON.stringify(readLocalPrefs());
    expect(lp).not.toContain('渠一帆');
    expect(lp).not.toContain('小明');
  });
});
