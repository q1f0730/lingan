// v0.45 到点递一穗 · 给未来的穗 + 瘦身（中文字符串包 / .bin 资源）
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAst } from 'rolldown/parseAst';
import { expandChunk, packChunk, packStrings } from '../../scripts/zhpack.mjs';
import { splitPack } from '../../scripts/binpack.mjs';
import { inflateRawSync, unpackStrings } from '../lib/zunpack';
import { daysBetween, dueLetters, fireAt, needWhy, parseSealDate, pingDue, pingMessage, PING_DEFAULT, PUSH_HOSTS, sctUrl, sealChoices, sealedSummary, staleWork, yearAgo } from '../lib/rhythm';
import { inLibrary } from '../lib/db';
import { lacksWhy } from '../lib/why';
import { dailyPool } from '../lib/daily';
import { SECRET_NAMES } from '../lib/vault';
import type { Item, Work } from '../lib/types';

const tables = import.meta.glob(['../lib/pinyin-table.ts', '../lib/zhvar-table.ts', '../lib/samplepack.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

async function deflateRaw(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
}

describe('瘦身：同步 inflate + 字符串包', () => {
  it('inflateRawSync 和平台 deflate-raw 逐字节对上（文字 / 随机 / 空 / 长重复）', async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
    const cases: Uint8Array[] = [
      new TextEncoder().encode('每日一穗 · 给未来的穗 · '.repeat(400)),
      Uint8Array.from({ length: 5000 }, rnd),
      new Uint8Array(0),
      new Uint8Array(70000).fill(65),
      new TextEncoder().encode('a'),
    ];
    for (const c of cases) expect([...inflateRawSync(await deflateRaw(c))]).toEqual([...c]);
  });
  it('packStrings → unpackStrings 往返（含 GBK 外的字、emoji、引号换行）', () => {
    const arr = ['拾穗 · Glean', '给未来的穗', '𠀀 生僻 😀', 'quote "x" \\ \n 换行', '繁體字花樣年華', ''];
    expect(unpackStrings(packStrings(arr))).toEqual(arr);
  });
  it('packChunk：换回去和原代码逐字相同；键名 / import / 正则 / 带标签模板不动；运行结果一样', () => {
    const code = [
      "import x from './中文路径模块.js';",
      'var a = "这是一句很长的中文提示词";',
      "var b = '短';",
      "var o = { '中文键名不能换': 1, k: '值也是中文的哦' };",
      'var re = /中文正则表达式/;',
      'var n = 3;',
      'var t = `前面一段中文${n}后面一段中文`;',
      'var tag = String.raw`带标签的中文模板`;',
      'var dup = "这是一句很长的中文提示词";',
      'class K { "类里的中文键名"() { return 1; } }',
    ].join('\n');
    const p = packChunk(code)!;
    expect(p).toBeTruthy();
    expect(expandChunk(p)).toBe(code);
    expect(p.code).toContain("'中文键名不能换'");
    expect(p.code).toContain('./中文路径模块.js');
    expect(p.code).toContain('/中文正则表达式/');
    expect(p.code).toContain('String.raw`带标签的中文模板`');
    expect(p.code).toContain('"类里的中文键名"');
    expect(p.strings).toEqual(['这是一句很长的中文提示词', '值也是中文的哦', '前面一段中文', '后面一段中文']);
    parseAst(p.code);
    // 去掉 import 后在函数里跑一遍：值和原代码一样
    (globalThis as unknown as { __glz: typeof unpackStrings }).__glz = unpackStrings;
    const body = (s: string) => s.replace(/^import .*$/m, '') + '\nreturn [a, b, o.k, t, dup];';
    expect(new Function(body(p.code))()).toEqual(new Function(body(code))());
  });
  it('没有中文的块原样不动', () => {
    expect(packChunk('var a = "hello"; var b = `x${1}`;')).toBeNull();
  });
  it('binpack 认得出三个包，base64 解得开', () => {
    expect(Object.keys(tables).length).toBe(3);
    for (const [k, src] of Object.entries(tables)) {
      const p = splitPack(src);
      expect(p, k).toBeTruthy();
      expect(atob(p!.b64).length).toBeGreaterThan(4000);
    }
  });
});

const DAY = 86400000;
const NOW = new Date(2026, 10, 4, 21, 40).getTime(); // 2026-11-04 21:40 本地
const it0 = (o: Partial<Item>): Item => ({ id: 1, type: 'text', title: 't', tags: [], createdAt: NOW - 30 * DAY, updatedAt: NOW, ...o }) as Item;

describe('0924 封存到某天', () => {
  it('现成选项：一个月 / 半年 / 一年后的同一天（月底落到月末）', () => {
    const c = sealChoices(new Date(2026, 0, 31, 10).getTime());
    expect(c.map((x) => new Date(x.at).toDateString())).toEqual([new Date(2026, 1, 28).toDateString(), new Date(2026, 6, 31).toDateString(), new Date(2027, 0, 31).toDateString()]);
  });
  it('自己挑的日期：明天起、10 年内、格式对', () => {
    expect(parseSealDate('2026-11-05', NOW)).toBe(new Date(2026, 10, 5).getTime());
    expect(parseSealDate('2026-11-04', NOW)).toBeNull();
    expect(parseSealDate('2026-02-30', NOW)).toBeNull();
    expect(parseSealDate('2040-01-01', NOW)).toBeNull();
    expect(parseSealDate('明天', NOW)).toBeNull();
  });
  it('封存中不进穗仓 / 缺为什么 / 每日一穗；到期才是来信', () => {
    const s = it0({ sealUntil: NOW + 10 * DAY, sealAt: NOW - DAY });
    expect(inLibrary(s, NOW, false)).toBe(false);
    expect(inLibrary(it0({}), NOW, false)).toBe(true);
    expect(lacksWhy(s)).toBe(false);
    const pool = [1, 2, 3, 4, 5].map((id) => it0({ id, title: 'x' + id }));
    expect(dailyPool([...pool, { ...s, id: 9 }]).map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
    const due = it0({ id: 2, sealUntil: NOW - 1, sealAt: NOW - 40 * DAY });
    expect(dueLetters([s, due, it0({ id: 3 })], NOW).map((i) => i.id)).toEqual([2]);
    expect(sealedSummary([s, due], NOW)).toEqual({ n: 1, next: s.sealUntil });
    expect(daysBetween(due.sealAt!, NOW)).toBe(40);
  });
});

describe('0942 / 0311 / 0843', () => {
  it('一年前的今天：同月同日、早于今年；上锁 / 放下 / 示例 / 封存不算', () => {
    const y = new Date(2025, 10, 4, 9).getTime();
    const a = it0({ id: 5, createdAt: y });
    expect(yearAgo([a, it0({ id: 6 })], NOW)?.id).toBe(5);
    expect(yearAgo([{ ...a, locked: 1 }], NOW)).toBeNull();
    expect(yearAgo([{ ...a, sealUntil: NOW + DAY }], NOW)).toBeNull();
    expect(yearAgo([it0({ createdAt: new Date(2026, 10, 4, 1).getTime() })], NOW)).toBeNull();
  });
  it('作品停了 7 天推一次；同一段停顿看过就不再推；完成的不推', () => {
    const w = (o: Partial<Work>): Work => ({ uid: 'w1', title: '短片', form: 'film', stage: 'doing', devUids: [], itemUids: [], draft: '', todos: [], createdAt: NOW - 30 * DAY, updatedAt: NOW - 9 * DAY, ...o }) as Work;
    expect(staleWork([w({})], {}, NOW)?.days).toBe(9);
    expect(staleWork([w({})], { w1: NOW - 9 * DAY }, NOW)).toBeNull();
    expect(staleWork([w({ updatedAt: NOW - 3 * DAY })], {}, NOW)).toBeNull();
    expect(staleWork([w({ stage: 'done' })], {}, NOW)).toBeNull();
  });
  it('补一句为什么：24 小时后还没写的，最多 3 条、最近的在前', () => {
    const xs = [1, 2, 3, 4, 5].map((i) => it0({ id: i, createdAt: NOW - (i + 1) * DAY }));
    xs.push(it0({ id: 9, createdAt: NOW - 3600000 }), it0({ id: 8, why: '写了' }), it0({ id: 7, sample: 1 } as never));
    expect(needWhy(xs, NOW).map((i) => i.id)).toEqual([1, 2, 3]);
  });
});

describe('ROADMAP v0.33 到点递一穗', () => {
  it('到点：过了点、3 小时内、今天没递过', () => {
    const c = { ...PING_DEFAULT, on: true, at: '21:30' };
    expect(fireAt('21:30', NOW)).toBe(new Date(2026, 10, 4, 21, 30).getTime());
    expect(pingDue(c, null, NOW)).toBe(true);
    expect(pingDue(c, '2026-11-04', NOW)).toBe(false);
    expect(pingDue({ ...c, on: false }, null, NOW)).toBe(false);
    expect(pingDue(c, null, new Date(2026, 10, 4, 21, 29).getTime())).toBe(false);
    expect(pingDue(c, null, new Date(2026, 10, 5, 1, 0).getTime())).toBe(false);
  });
  it('文案只到标题级；私密 / 上锁 / 设了 PIN 不说标题；来信不剧透', () => {
    const hero = { title: '花样年华', type: 'film', content: '很长的正文不该出现' } as Item;
    expect(pingMessage({ hero, untouched: 312 })).toEqual({ title: '今日一穗', body: '「花样年华」，312 天没碰了' });
    expect(pingMessage({ hero: { ...hero, private: 1 } as Item }).body).toBe('一穗');
    expect(pingMessage({ hero, hidden: true }).body).not.toContain('花样年华');
    expect(pingMessage({ hero, letters: 1 })).toEqual({ title: '一封给未来的穗到了', body: '你封存的一穗今天可以拆开了' });
    expect(pingMessage({ hero, noWhy: 4, withWhy: true }).body).toContain('还有 4 穗没写为什么');
    expect(pingMessage({ hero, noWhy: 2, withWhy: true }).body).not.toContain('没写为什么');
  });
  it('0839 Server酱：两种 SendKey 的地址都在声明的域名里；认不出的不发', async () => {
    const t = sctUrl('SCT123456abcdefg')!;
    const p3 = sctUrl('sctp12345tAbCdEf')!;
    expect(t).toBe('https://sctapi.ftqq.com/SCT123456abcdefg.send');
    expect(p3).toBe('https://12345.push.ft07.com/send/sctp12345tAbCdEf.send');
    expect(sctUrl('hello')).toBeNull();
    const P = await import('../lib/plugs');
    expect(() => P.assertPlug('push', t, PUSH_HOSTS)).not.toThrow();
    expect(() => P.assertPlug('push', p3, PUSH_HOSTS)).not.toThrow();
    expect(() => P.assertPlug('push', 'https://evil.example.com/x', PUSH_HOSTS)).toThrow('没声明');
    expect(SECRET_NAMES).toContain('push.key');
  });
});

describe('0545 一套深链', () => {
  beforeEach(() => vi.unstubAllGlobals());
  it('托盘 / 通知 / 快捷方式用的 glean://go/… 四页都解析得出', async () => {
    const { parseLink } = await import('../lib/deeplink');
    for (const v of ['daily', 'library', 'settings', 'search']) expect(parseLink(`glean://go/${v}`)).toEqual({ k: 'go', v });
  });
});
