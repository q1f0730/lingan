import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addUserCliche, clichesFromDevs, depositCliches, exportAll, importAll, LinganDB, markBlocked, strikeCliche } from '../lib/db';
import { graftOffline, graftWithAI, TRANSFORMS } from '../lib/graft';
import { buildVault } from '../lib/obsidian';
import { drawSamples } from '../lib/samples';
import { defaultSettings } from '../lib/settings';
import { mulberry32 } from '../lib/similarity';
import type { Development, Item } from '../lib/types';
import {
  BUILTIN_FORBIDDEN,
  branchHits,
  branchText,
  clicheKey,
  cleanText,
  enforcedKeys,
  findHits,
  forbiddenBlock,
  promptWall,
  scrubBranch,
  validKey,
  wallCandidates,
  type Cliche,
} from '../lib/wall';

const SAMPLES = drawSamples(10, mulberry32(1919)).map(({ sample: _s, ...rest }) => (void _s, rest));
const items: Item[] = SAMPLES.map((s, i) => ({ ...s, id: i + 1, createdAt: Date.now() - i * 86400000, updatedAt: Date.now() }));
const three = items.slice(0, 3);
const fresh = () => new LinganDB('wall-' + Math.random().toString(36).slice(2));
const row = (text: string, extra: Partial<Cliche> = {}): Cliche => ({ key: clicheKey(text), text: cleanText(text), source: 'ai', struck: 0, listed: 1, blocked: 0, createdAt: 1, lastAt: 1, ...extra });

describe('套路墙：归一化与匹配', () => {
  it('去引号、去标点、小写；太短的不上墙', () => {
    expect(cleanText(' 「雨夜霓虹」。')).toBe('雨夜霓虹');
    expect(clicheKey('“宿命 感”')).toBe('宿命感');
    expect(clicheKey('Lo-Fi')).toBe('lofi');
    expect(validKey('雨')).toBe(false);
    expect(validKey('雨夜')).toBe(true);
    expect(validKey('ai')).toBe(false);
    expect(validKey('lofi')).toBe(true);
  });
  it('字与字之间夹空白 / 标点也算命中；英文按整词', () => {
    expect(findHits('一场氛围 · 感拉满的演出', [clicheKey('氛围感')])).toEqual(['氛围感']);
    expect(findHits('A LO-FI tape', [clicheKey('lofi')])).toEqual(['lofi']);
    expect(findHits('philosophy', [clicheKey('soph')])).toEqual([]);
    expect(findHits('没有命中', [clicheKey('雨夜')])).toEqual([]);
  });
  it('enforcedKeys：内置 + 墙上没划掉的 + 本次列出的；划掉的不禁用，本次列出也不复活', () => {
    const keys = enforcedKeys([row('雨夜'), row('错过', { struck: 1 })], ['城市里的陌生人', '错过']);
    expect(keys).toContain('雨夜');
    expect(keys).toContain('城市里的陌生人');
    expect(keys).not.toContain('错过');
    for (const b of BUILTIN_FORBIDDEN) expect(keys).toContain(clicheKey(b));
  });
  it('FORBIDDEN 段写出墙上每一条；我加的排在前面', () => {
    const wall = [row('模型的套路', { listed: 5, lastAt: 9 }), row('我讨厌的梗', { source: 'user', listed: 0 }), row('划掉的', { struck: 1 })];
    const texts = promptWall(wall);
    expect(texts).toEqual(['我讨厌的梗', '模型的套路']);
    const f = forbiddenBlock(texts);
    expect(f).toContain('FORBIDDEN');
    expect(f).toContain('「我讨厌的梗」「模型的套路」');
    expect(f).toContain('共 2 条');
    expect(f).not.toContain('划掉的');
  });
  it('删字兜底：撞到的字删掉，空书名号收拾掉，删光的字段换中性话', () => {
    const b = scrubBranch({ title: '雨夜', idea: '在《雨夜》里，雨夜很长，像一段旅程。', bridge: '', cliches: ['雨夜'], experiment: '去拍雨夜' }, enforcedKeys([row('雨夜')]));
    expect(branchHits(b, enforcedKeys([row('雨夜')]))).toEqual([]);
    expect(b.idea).not.toContain('《》');
    expect(b.title).toBe('新枝');
    expect(b.cliches).toEqual(['雨夜']);
  });
  it('wallCandidates 去重去空', () => {
    expect(wallCandidates(['雨夜', '「雨夜」', '', '雨', 3, 'Lo Fi'])).toEqual([
      { key: '雨夜', text: '雨夜' },
      { key: 'lofi', text: 'Lo Fi' },
    ]);
  });
});

describe('离线嫁接遵守套路墙', () => {
  it('墙上有离线句式必出的词（「做成」）和穗名：三根都不含，仍是三根、变形法两两不同、溯源 ≥3', () => {
    const t = three[0].title.replace(/^《|》$/g, '').slice(0, 4);
    const wall = [row('做成', { source: 'user' }), row(t, { source: 'user' })];
    for (let s = 1; s <= 10; s++) {
      const r = graftOffline(three, { rand: mulberry32(s), wall });
      expect(r.branches).toHaveLength(3);
      expect(new Set(r.branches.map((b) => b.transform)).size).toBe(3);
      for (const b of r.branches) {
        const text = branchText(b);
        expect(text).not.toContain('做成');
        if (validKey(clicheKey(t))) expect(findHits(text, [clicheKey(t)])).toEqual([]);
        expect((b.refs || []).length).toBeGreaterThanOrEqual(3);
      }
      expect(r.wall!.hit).toBeGreaterThan(0);
    }
  });
  it('墙是空的：和以前一样，不报撞墙', () => {
    const r = graftOffline(three, { rand: mulberry32(3) });
    expect(r.wall!.hit).toBe(0);
  });
});

// ——— 验收：墙上套路后，连续 10 次嫁接（模型故意返回含套路的文本）新枝都不含 ———
describe('graftWithAI × 套路墙（mock 模型故意撞墙）', () => {
  const WALL_WORDS = ['小票', '雨夜霓虹'];
  let comply = false; // 重写时是否听话
  let systems: string[] = [];
  let run = 0;
  const reply = (obj: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(obj) + '\n```' } }] }), { status: 200 });
  const bad = (i: number) => `用${WALL_WORDS[i % 2]}做一个装置，雨夜霓虹下的小票`;
  beforeAll(() => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const sys = String(body.messages[0].content);
      systems.push(sys);
      const user = String(body.messages[1].content);
      const ids = [...new Set([...user.matchAll(/\[#(\d+) \|/g)].map((m) => Number(m[1])))];
      if (sys.includes('PHASE A')) {
        return reply({
          tensions: [{ text: '小票和雨夜霓虹', refs: ids.slice(0, 2) }],
          seeds: TRANSFORMS.map((t, i) => ({ t: t.id, text: i % 2 ? `种子${i}：${bad(i)}` : `种子${i}：一句干净的话`, refs: ids.slice(0, 3) })),
        });
      }
      const retry = sys.includes('上一版新枝里');
      const clean = comply && retry;
      return reply({
        pattern: 'p',
        replaced: [],
        branches: [1, 3, 5].map((seed, k) => ({
          seed,
          title: clean ? `干净的${k}` : `小票之${k}`,
          idea: clean ? `一根干净的新枝正文 ${k}` : `${bad(k)}，再来一点雨夜霓虹。第 ${k} 根。`,
          form: clean ? '海报' : '小票海报',
          refs: ids.slice(0, 3),
          unlike: '不同',
          experiment: clean ? '写三行' : '收集三张小票',
        })),
        // 每次都列出一个新套路（会沉淀上墙），外加一个墙上已有的
        cliches: [`新套路${run}号`, '小票'],
      });
    });
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    systems = [];
  });
  const s = () => {
    const x = defaultSettings();
    x.chat.apiKey = 'k';
    x.chat.baseUrl = 'http://x/v1';
    return x;
  };

  it('连续 10 次：每次 prompt 都带 FORBIDDEN 套路墙，新枝里一条墙上套路都没有', async () => {
    comply = false;
    const d = fresh();
    for (const w of WALL_WORDS) await addUserCliche(w, d);
    for (run = 0; run < 10; run++) {
      const wall = await d.cliches.toArray();
      systems = [];
      const r = await graftWithAI(s(), three, { wall, rand: mulberry32(run + 1), sleep: () => Promise.resolve() });
      // 1) FORBIDDEN 段写进了每一次调用
      for (const sys of systems) {
        expect(sys).toContain('FORBIDDEN — 我的套路墙');
        for (const w of wall.filter((c) => !c.struck)) expect(sys).toContain(`「${w.text}」`);
      }
      // 2) 撞墙后重写过一次（3 次调用），仍撞就本地换掉 / 删字
      expect(r.wall!.hit).toBeGreaterThan(0);
      expect(r.wall!.retried).toBe(true);
      expect(r.calls).toBe(3);
      expect(r.branches).toHaveLength(3);
      expect(new Set(r.branches.map((b) => b.transform)).size).toBe(3);
      // 3) 新枝里不含墙上任何一条（以及这次模型自己列出的）
      const keys = enforcedKeys(wall, r.cliches);
      for (const b of r.branches) {
        expect(branchHits(b, keys)).toEqual([]);
        for (const w of WALL_WORDS) expect(branchText(b)).not.toContain(w);
        for (const c of wall) if (!c.struck) expect(findHits(branchText(b), [c.key])).toEqual([]);
      }
      await depositCliches(r.cliches, d);
      await markBlocked(r.wall!.keys, d);
    }
    // 模型每次列出的新套路都沉淀上墙：2 个我加的 + 10 个新套路
    const wall = await d.cliches.toArray();
    expect(wall.filter((c) => !c.struck)).toHaveLength(12);
    const xp = wall.find((c) => c.key === '小票')!;
    expect(xp.source).toBe('user');
    expect(xp.listed).toBe(10);
    expect(xp.blocked).toBeGreaterThanOrEqual(10);
    // 第 10 次的 prompt 里已经有前 9 次沉淀的套路
    expect(systems.some((x) => x.includes('「新套路8号」'))).toBe(true);
  });

  it('模型重写时听话：只多一次调用，三根原样保留（不本地替换）', async () => {
    comply = true;
    run = 99;
    const wall = WALL_WORDS.map((w) => row(w, { source: 'user' }));
    const r = await graftWithAI(s(), three, { wall, rand: mulberry32(5), sleep: () => Promise.resolve() });
    expect(r.calls).toBe(3);
    expect(r.wall).toMatchObject({ retried: true, replaced: 0, scrubbed: 0 });
    expect(r.branches.map((b) => b.title)).toEqual(['干净的0', '干净的1', '干净的2']);
    expect(systems[2]).toContain('第 1 根用了套路墙上的');
  });

  it('划掉的词不再禁用：模型用了它也原样保留', async () => {
    comply = false;
    run = 100;
    const d = fresh();
    for (const w of WALL_WORDS) await addUserCliche(w, d);
    const all = await d.cliches.toArray();
    for (const c of all) await strikeCliche(c.id!, true, d);
    const wall = await d.cliches.toArray();
    const r = await graftWithAI(s(), three, { wall, rand: mulberry32(9), sleep: () => Promise.resolve() });
    expect(r.calls).toBe(2);
    expect(r.wall!.hit).toBe(0);
    expect(branchText(r.branches[0])).toContain('雨夜霓虹');
    for (const sys of systems) expect(sys).not.toContain('FORBIDDEN — 我的套路墙');
  });
});

describe('套路墙存储', () => {
  it('沉淀：已有的 +1 次，划掉的保持划掉；我加的：重复不加、划掉的恢复、太短拒绝', async () => {
    const d = fresh();
    expect(await depositCliches(['雨夜', '错过', '雨夜'], d, 10)).toBe(2);
    const cuo = (await d.cliches.where('key').equals('错过').first())!;
    await strikeCliche(cuo.id!, true, d);
    expect(await depositCliches(['错过', '新的'], d, 20)).toBe(1);
    const again = (await d.cliches.where('key').equals('错过').first())!;
    expect(again.struck).toBe(1);
    expect(again.listed).toBe(2);
    expect((await addUserCliche('「雨夜」', d)).status).toBe('exists');
    expect((await addUserCliche('错过', d)).status).toBe('restored');
    expect((await d.cliches.where('key').equals('错过').first())!.struck).toBe(0);
    expect((await addUserCliche('雨', d)).status).toBe('invalid');
    expect((await addUserCliche('宿命感', d)).status).toBe('added');
    expect(await d.cliches.count()).toBe(4);
  });

  it('Dexie version 7 迁移：旧新枝里的套路上墙（同一批只算一次），新枝一条不动', async () => {
    const name = 'wall-mig-' + Math.random().toString(36).slice(2);
    const v6 = new Dexie(name);
    v6.version(1).stores({ items: '++id, type, createdAt, updatedAt, *tags', developments: '++id, createdAt, starred' });
    v6.version(2).stores({ developments: '++id, createdAt, starred, evidence' });
    v6.version(3).stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo', images: '&itemId' });
    v6.version(4).stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt', daily: '&day' });
    v6.version(5).stores({ ftidx: '&key, kind' });
    v6.version(6).stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt, graftCount' });
    await v6.open();
    await v6.table('items').bulkAdd([1, 2, 3].map((i) => ({ id: i, type: 'idea', title: '旧' + i, tags: [], createdAt: i, updatedAt: i, graftCount: 1 })));
    await v6.table('developments').add({ itemIds: [1, 2], jump: 0.5, idea: { title: 'a', bridge: '', idea: 'a', cliches: ['雨夜', '错过'] }, source: 'ai', createdAt: 100 });
    for (let k = 0; k < 3; k++) await v6.table('developments').add({ itemIds: [1, 2, 3], jump: 0.5, idea: { title: 'b' + k, bridge: '', idea: 'b', cliches: ['「雨夜」', '城市里的陌生人'] }, source: 'ai', createdAt: 200 + k, batch: { id: 'gx', index: k, size: 3 } });
    v6.close();
    const d = new LinganDB(name);
    const wall = await d.cliches.orderBy('key').toArray();
    expect(d.verno).toBe(7);
    expect(wall.map((c) => [c.key, c.listed])).toEqual(
      [
        ['城市里的陌生人', 1],
        ['错过', 1],
        ['雨夜', 2],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(wall.every((c) => c.source === 'ai' && c.struck === 0)).toBe(true);
    expect(await d.developments.count()).toBe(4);
    expect(await d.items.count()).toBe(3);
  });

  it('备份带上套路墙；导入按 key 合并（我加的 / 划掉的带过来）；旧备份从新枝重建', async () => {
    const a = fresh();
    await addUserCliche('宿命感', a);
    await depositCliches(['雨夜', '错过'], a);
    const cuo = (await a.cliches.where('key').equals('错过').first())!;
    await strikeCliche(cuo.id!, true, a);
    const bk = await exportAll(a);
    expect(bk.cliches).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(bk)).cliches.every((c: Cliche) => c.id === undefined)).toBe(true);
    const b = fresh();
    await depositCliches(['雨夜'], b);
    await importAll(JSON.parse(JSON.stringify(bk)), b);
    const got = await b.cliches.toArray();
    expect(got).toHaveLength(3);
    expect(got.find((c) => c.key === '宿命感')!.source).toBe('user');
    expect(got.find((c) => c.key === '错过')!.struck).toBe(1);
    // v0.18 及以前的备份：没有 cliches 字段
    const old = { app: 'lingan', version: 1, exportedAt: 1, items: [{ id: 7, type: 'idea', title: 'x', tags: [], createdAt: 1, updatedAt: 1 }], developments: [{ itemIds: [7], jump: 0.5, idea: { title: 't', bridge: '', idea: 'i', cliches: ['旧梗甲', '旧梗乙'] }, source: 'ai', createdAt: 5 }] };
    const c = fresh();
    await importAll(old, c);
    expect((await c.cliches.toArray()).map((x) => x.key).sort()).toEqual(['旧梗乙', '旧梗甲'].sort());
  });

  it('clichesFromDevs：没有 batch 的旧单根每根算一次', () => {
    const devs = [
      { id: 1, idea: { cliches: ['甲甲'] }, createdAt: 1 },
      { id: 2, idea: { cliches: ['甲甲'] }, createdAt: 2 },
    ] as unknown as Development[];
    expect(clichesFromDevs(devs)[0].listed).toBe(2);
  });
});

describe('搬去 Obsidian：套路墙.md', () => {
  it('有墙时导出 套路墙.md（在墙上 / 划掉的），索引页链过去；统计带条数', () => {
    const its = three.map((x) => ({ ...x }));
    const v = buildVault({ items: its, developments: [], images: new Map(), now: Date.UTC(2026, 9, 22), cliches: [row('雨夜', { listed: 3, blocked: 2 }), row('宿命感', { source: 'user' }), row('错过', { struck: 1 })] });
    const f = v.files.find((x) => x.path === '套路墙.md');
    expect(f).toBeTruthy();
    const md = String(f!.data);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('类型: "套路墙"');
    expect(md).toContain('## 在墙上（2）');
    expect(md).toContain('- 雨夜 · 模型列过 3 次 · 拦下 2 次');
    expect(md).toContain('- 宿命感 · 我加的');
    expect(md).toContain('~~错过~~');
    const idx = String(v.files.find((x) => x.path === '拾穗索引.md')!.data);
    expect(idx).toContain('[[套路墙|套路墙]]');
    expect(v.stats.cliches).toBe(2);
    const none = buildVault({ items: its, developments: [], images: new Map() });
    expect(none.files.some((x) => x.path === '套路墙.md')).toBe(false);
  });
});
