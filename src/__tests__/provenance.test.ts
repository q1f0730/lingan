import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LinganDB, exportAll, importAll } from '../lib/db';
import { buildConvergePrompt, buildMapPrompt, graftOffline, graftWithAI, normalizeConverge, normalizeMap, TRANSFORMS } from '../lib/graft';
import { checkRefs, evidenceClean, evidenceOf, migrateDevelopment, padRefs, sourceIds, splitMentions } from '../lib/provenance';
import { SAMPLES } from '../lib/samples';
import { defaultSettings } from '../lib/settings';
import { mulberry32 } from '../lib/similarity';
import type { Development, Item } from '../lib/types';

// 真实库里的 id 不是 1..n：用 12 / 57 / 3 / 40 来确认模型必须引用真实素材 ID
const IDS = [12, 57, 3, 40];
const items: Item[] = SAMPLES.slice(0, 4).map((s, i) => ({ ...s, id: IDS[i], createdAt: 1, updatedAt: 1 }));
const noSleep = () => Promise.resolve();

describe('checkRefs', () => {
  it('maps real ids to positions and counts made-up ones', () => {
    expect(checkRefs([57, '#3', 99, 57], IDS)).toEqual({ refs: [2, 3], invalid: 1, missing: false });
    expect(checkRefs('12、40，S57', IDS)).toEqual({ refs: [1, 4, 2], invalid: 0, missing: false });
    expect(checkRefs(undefined, IDS)).toEqual({ refs: [], invalid: 0, missing: true });
    // 位置号不是 ID：1、2 在这次素材里不存在
    expect(checkRefs([1, 2, 3], IDS)).toEqual({ refs: [3], invalid: 2, missing: false });
  });
  it('clean only with ≥k valid and no invented ids', () => {
    expect(evidenceClean(checkRefs([12, 57, 3], IDS), 3)).toBe(true);
    expect(evidenceClean(checkRefs([12, 57], IDS), 3)).toBe(false);
    expect(evidenceClean(checkRefs([12, 57, 3, 999], IDS), 3)).toBe(false);
  });
  it('padRefs fills to k without duplicates', () => {
    expect(padRefs([3], 4)).toEqual([3, 1, 2]);
    expect(padRefs([2, 9], 2)).toEqual([2, 1]);
  });
});

describe('prompts carry real material ids', () => {
  it('labels items with #id', () => {
    const p = buildMapPrompt(items.slice(0, 3), { oblique: 'o' });
    expect(p.user).toContain('[#12 |');
    expect(p.user).toContain('[#57 |');
    expect(p.system).toContain('素材 ID');
    const m = normalizeMap({ tensions: [{ text: 't', refs: [12, 57] }], seeds: TRANSFORMS.map((t) => ({ t: t.id, text: t.name, refs: [12, 57, 3] })) }, IDS.slice(0, 3));
    expect(m.tensions[0].refs).toEqual([1, 2]);
    const c = buildConvergePrompt(items.slice(0, 3), { oblique: 'o' }, m.tensions, m.seeds, '第 1 根新枝没写 refs');
    expect(c.user).toContain('#12、#57');
    expect(c.system).toContain('上一次的回答里第 1 根新枝没写 refs');
  });
});

const three = items.slice(0, 3);
const MAP = { tensions: [{ text: 'a', refs: [12, 57] }], seeds: TRANSFORMS.map((t, i) => ({ t: t.id, text: `种子${i}`, refs: [12, 57, 3] })) };
const good = (n: number) => ({ seed: n, title: `枝${n}`, idea: `用了《花样年华》和 Sigur Rós 的第 ${n} 根`, refs: [12, 57, 3] });

describe('normalizeConverge evidence', () => {
  it('marks branches that cite ≥3 real ids ok, others weak with a reason', () => {
    const m = normalizeMap(MAP, IDS.slice(0, 3));
    const c = normalizeConverge(
      { branches: [good(1), { seed: 5, title: '没ID', idea: '没有引用任何素材' }, { seed: 8, title: '编ID', idea: '引用了不存在的', refs: [12, 57, 999] }] },
      m.seeds,
      three,
      'o',
    );
    expect(c.branches.map((b) => b.evidence)).toEqual(['ok', 'weak', 'weak']);
    expect(c.faults).toBe(2);
    expect(c.branches[0].refs).toEqual([1, 2, 3]);
    expect(c.branches[1].refs).toEqual([]); // 不替它编来源
    expect(c.branches[1].evidenceNote).toContain('没说');
    expect(c.branches[2].evidenceNote).toContain('不存在');
  });
  it('locally filled branches always point back to ≥3 ears', () => {
    const m = normalizeMap(MAP, IDS.slice(0, 3));
    const c = normalizeConverge({}, m.seeds, three, 'o');
    expect(c.filled).toBe(3);
    for (const b of c.branches) {
      expect(b.evidence).toBe('ok');
      expect(new Set(b.refs).size).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('graftOffline provenance', () => {
  it('every offline branch cites ≥3 distinct ears and names them in the body', () => {
    for (let s = 1; s < 30; s++) {
      const pick = items.slice(0, 3 + (s % 2));
      const r = graftOffline(pick, { rand: mulberry32(s) });
      for (const b of r.branches) {
        expect(b.evidence).toBe('ok');
        expect(new Set(b.refs).size).toBeGreaterThanOrEqual(3);
        expect(b.refs!.every((x) => x >= 1 && x <= pick.length)).toBe(true);
        const named = b.refs!.filter((x) => b.idea.includes(pick[x - 1].title.slice(0, 6)));
        expect(named.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('graftWithAI evidence retry (mocked fetch)', () => {
  let script: unknown[] = [];
  let systems: string[] = [];
  const reply = (obj: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(obj) + '\n```' } }] }), { status: 200 });
  beforeAll(() => {
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      const sys = String(JSON.parse(String(init.body)).messages[0].content);
      systems.push(sys);
      if (sys.includes('PHASE A')) return reply(MAP);
      return reply(script.shift());
    });
  });
  afterEach(() => {
    systems = [];
  });
  const s = () => {
    const x = defaultSettings();
    x.chat.apiKey = 'k';
    x.chat.baseUrl = 'http://x/v1';
    return x;
  };
  const noIds = { branches: [{ seed: 1, title: 'a', idea: 'x' }, { seed: 5, title: 'b', idea: 'y' }, { seed: 8, title: 'c', idea: 'z' }] };

  it('all good → no recheck', async () => {
    script = [{ branches: [good(1), good(5), good(8)] }];
    const r = await graftWithAI(s(), three, { sleep: noSleep });
    expect(r.calls).toBe(2);
    expect(r.recheck).toBe(false);
    expect(r.weak).toBe(0);
  });
  it('missing ids → retries once with a note, and recovers', async () => {
    script = [noIds, { branches: [good(1), good(5), good(8)] }];
    const prog: boolean[] = [];
    const r = await graftWithAI(s(), three, { sleep: noSleep, onProgress: (p) => p.recheck && prog.push(true) });
    expect(r.calls).toBe(3);
    expect(r.recheck).toBe(true);
    expect(prog).toEqual([true]);
    expect(systems[2]).toContain('上一次的回答里');
    expect(r.branches.every((b) => b.evidence === 'ok')).toBe(true);
  });
  it('still bad after retry → 证据不足, not pretending', async () => {
    script = [noIds, { branches: [good(1), { seed: 5, title: 'b', idea: 'y', refs: [12, 999] }, { seed: 8, title: 'c', idea: 'z' }] }];
    const r = await graftWithAI(s(), three, { sleep: noSleep });
    expect(r.calls).toBe(3); // 只重来一次
    expect(r.weak).toBe(2);
    expect(r.branches.map((b) => b.evidence)).toEqual(['ok', 'weak', 'weak']);
    expect(r.branches[2].refs).toEqual([]);
  });
});

describe('sourceIds / evidenceOf / splitMentions', () => {
  const dev = { itemIds: [12, 57, 3, 40], evidence: undefined } as Pick<Development, 'itemIds' | 'evidence'>;
  it('maps refs to item ids, caps at 5, legacy falls back to all', () => {
    expect(sourceIds(dev, { refs: [2, 3, 1] })).toEqual([57, 3, 12]);
    expect(sourceIds(dev, {})).toEqual([12, 57, 3, 40]);
    expect(sourceIds({ itemIds: [1, 2, 3, 4, 5, 6, 7] }, {})).toHaveLength(5);
    expect(sourceIds({ itemIds: [5, -1, 6] }, { refs: [1, 2, 3] })).toEqual([5, 6]);
    expect(evidenceOf(dev, {})).toBe('legacy');
    expect(evidenceOf(dev, { evidence: 'weak' })).toBe('weak');
  });
  it('splits body text on item titles and creators, longest first', () => {
    const segs = splitMentions('把《花样年华》的走廊交给 Sigur Rós，再加一点花样。', [
      { id: 1, title: '花样年华', creator: '王家卫' },
      { id: 2, title: 'Svefn-g-englar', creator: 'Sigur Rós' },
      { id: 3, title: '花样', creator: '' },
    ]);
    expect(segs.filter((x) => x.id).map((x) => [x.text, x.id])).toEqual([
      ['《花样年华》', 1],
      ['Sigur Rós', 2],
      ['花样', 3],
    ]);
    expect(segs.map((x) => x.text).join('')).toBe('把《花样年华》的走廊交给 Sigur Rós，再加一点花样。');
    expect(splitMentions('什么都没提到', [{ id: 1, title: '花样年华' }])).toEqual([{ text: '什么都没提到' }]);
  });
});

describe('Dexie v1 → v2 migration keeps old branches', () => {
  it('upgrades a v1 database in place: refs filled, marked legacy, nothing lost', async () => {
    const name = 'mig-' + Math.random().toString(36).slice(2);
    const v1 = new Dexie(name);
    v1.version(1).stores({ items: '++id, type, createdAt, updatedAt, *tags', developments: '++id, createdAt, starred' });
    await v1.open();
    const a = await v1.table('items').add({ ...SAMPLES[0], createdAt: 1, updatedAt: 1 });
    const b = await v1.table('items').add({ ...SAMPLES[1], createdAt: 1, updatedAt: 1 });
    await v1.table('developments').bulkAdd([
      { itemIds: [a, b], jump: 0.5, idea: { title: 'v0.10 单根', bridge: 'x', idea: '旧正文', cliches: [] }, source: 'ai', createdAt: 1 },
      { itemIds: [a, b], jump: 0.5, idea: { title: 'v0.11', bridge: '', idea: '三枝之一', cliches: [], refs: [2, 7], transform: 'invert' }, source: 'offline', createdAt: 2, batch: { id: 'g1', index: 0, size: 3 } },
    ]);
    v1.close();
    const d = new LinganDB(name);
    const devs = await d.developments.orderBy('createdAt').toArray();
    expect(d.verno).toBeGreaterThanOrEqual(2); // v0.13 起是 3
    expect(devs).toHaveLength(2);
    expect(devs[0].idea.idea).toBe('旧正文');
    expect(devs[0].idea.refs).toEqual([1, 2]);
    expect(devs[1].idea.refs).toEqual([2]);
    expect(devs[1].batch?.id).toBe('g1');
    expect(devs.every((x) => x.evidence === 'legacy')).toBe(true);
    expect(await d.developments.where('evidence').equals('legacy').count()).toBe(2);
    d.close();
  });
  it('migrateDevelopment keeps an existing mark and is idempotent', () => {
    const x: Development = { itemIds: [1, 2, 3], jump: 0, idea: { title: 't', bridge: '', idea: 'i', cliches: [], refs: [1, 2, 3], evidence: 'weak' }, source: 'ai', createdAt: 1 };
    expect(migrateDevelopment(x)).toBe(true);
    expect(x.evidence).toBe('weak');
    expect(migrateDevelopment(x)).toBe(false);
  });
  it('import of an old backup keeps refs aligned even if an item is missing', async () => {
    const d1 = new LinganDB('imp1-' + Math.random());
    const ids = await d1.items.bulkAdd(SAMPLES.slice(0, 3).map((s) => ({ ...s, createdAt: 1, updatedAt: 1 })), { allKeys: true });
    await d1.developments.add({ itemIds: [...ids, 999], jump: 0, idea: { title: 't', bridge: '', idea: 'i', cliches: [], refs: [3, 4] }, source: 'ai', createdAt: 1 });
    const bk = JSON.parse(JSON.stringify(await exportAll(d1)));
    const d2 = new LinganDB('imp2-' + Math.random());
    await importAll(bk, d2);
    const dev = (await d2.developments.toArray())[0];
    const titles = (await d2.items.bulkGet(sourceIds(dev, dev.idea))).map((x) => x?.title);
    expect(titles).toEqual([SAMPLES[2].title]);
    expect(dev.evidence).toBe('legacy');
  });
});
