import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AIError } from '../lib/ai';
import {
  applyDefix,
  backoffMs,
  buildConvergePrompt,
  buildMapPrompt,
  graftOffline,
  graftWithAI,
  normalizeConverge,
  normalizeMap,
  resolveTransform,
  TRANSFORMS,
  transformsDistinct,
  withRetry,
} from '../lib/graft';
import { drawSamples } from '../lib/samples';
import { mulberry32 as seeded } from '../lib/similarity';
// v0.14：从约 80 条示例池里按固定种子抽，不同测试文件用不同的种子，别总是那几条
const SAMPLES = drawSamples(10, seeded(2718)).map(({ sample: _s, ...rest }) => (void _s, rest));
import { defaultSettings } from '../lib/settings';
import { mulberry32 } from '../lib/similarity';
import type { GraftSeed, Item } from '../lib/types';

const items: Item[] = SAMPLES.map((s, i) => ({ ...s, id: i + 1, createdAt: Date.now() - i * 86400000, updatedAt: Date.now() }));
const three = items.slice(0, 3);
const noSleep = () => Promise.resolve();

const MAP = {
  tensions: [
    { text: '慢和快', refs: [1, 2] },
    { text: '过期之前', refs: [2, 3] },
    { text: '颜色和没有画面', refs: [1, 3] },
    { text: '重复变成情绪', refs: [1, 2, 3] },
  ],
  seeds: TRANSFORMS.map((t, i) => ({ t: i === 1 ? t.name : t.id, text: `种子${i + 1}：${t.name}的一句话`, refs: [1, 2, 3] })),
};
const CONV = {
  pattern: '都在小房间',
  replaced: [
    { n: 2, text: '换上来的新种子甲', refs: [1, 3] },
    { n: 4, text: '换上来的新种子乙', refs: [2, 3] },
    { n: 6, text: '换上来的新种子丙', refs: [1, 2] },
  ],
  branches: [
    { seed: 1, title: '一', idea: '第一根的正文', form: '海报', refs: [1, 2, 3], unlike: '甲', experiment: '实验一' },
    { seed: 5, title: '二', idea: '第二根的正文', form: '歌', refs: [2, 3, 1], unlike: '乙', experiment: '实验二' },
    { seed: 8, title: '三', idea: '第三根的正文', form: '短片', refs: ['#1', '#3', '#2'], unlike: '丙', experiment: '实验三' },
  ],
  cliches: ['雨夜', '错过'],
};

describe('graftOffline', () => {
  it('grows 3 branches with pairwise distinct transforms through all four steps', () => {
    const r = graftOffline(three, { rand: mulberry32(7) });
    expect(r.source).toBe('offline');
    expect(r.branches).toHaveLength(3);
    expect(transformsDistinct(r.branches)).toBe(true);
    expect(r.tensions).toHaveLength(4);
    expect(r.seeds).toHaveLength(8);
    expect(new Set(r.seeds.map((s) => s.transform))).toEqual(new Set(TRANSFORMS.map((t) => t.id)));
    expect(r.seeds.filter((s) => s.replaced)).toHaveLength(3);
    expect(r.seeds.filter((s) => s.chosen)).toHaveLength(3);
    for (const b of r.branches) {
      expect(b.idea.length).toBeGreaterThan(10);
      expect(b.experiment).toBeTruthy();
      expect(b.unlike).toBeTruthy();
      expect(b.refs!.every((x) => x >= 1 && x <= 3)).toBe(true);
    }
  });
  it('works with only 2 items, and is deterministic for a seed', () => {
    const r = graftOffline(items.slice(0, 2), { rand: mulberry32(1) });
    expect(r.branches).toHaveLength(3);
    expect(transformsDistinct(r.branches)).toBe(true);
    expect(r.branches.flatMap((b) => b.refs!).every((x) => x === 1 || x === 2)).toBe(true);
    const a = graftOffline(three, { rand: mulberry32(42) });
    const b = graftOffline(three, { rand: mulberry32(42) });
    expect(a.branches.map((x) => x.title)).toEqual(b.branches.map((x) => x.title));
  });
  it('stays distinct over many random runs', () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 40; i++) {
      const pick = items.slice(i % 5, (i % 5) + 2 + (i % 3));
      expect(transformsDistinct(graftOffline(pick, { rand }).branches)).toBe(true);
    }
  });
});

describe('prompts', () => {
  it('map prompt names the 8 transforms and asks for 4 tensions + 8 seeds', () => {
    const p = buildMapPrompt(three, { oblique: 'ob' });
    expect(p.system).toContain('PHASE A');
    expect(p.system).toContain('PHASE B');
    expect(p.system).not.toContain('PHASE C');
    for (const t of TRANSFORMS) expect(p.system).toContain(t.name);
    expect(p.user).toContain('[#1 |');
    expect(p.user).toContain('ob');
  });
  it('converge prompt carries seeds and tensions', () => {
    const m = normalizeMap(MAP, 3);
    const p = buildConvergePrompt(three, { oblique: 'ob', theme: '一首歌' }, m.tensions, m.seeds);
    expect(p.system).toContain('PHASE C');
    expect(p.system).toContain('PHASE D');
    expect(p.user).toContain('种子1');
    expect(p.user).toContain('慢和快');
    expect(p.user).toContain('一首歌');
  });
});

describe('normalizeMap / applyDefix / normalizeConverge', () => {
  it('resolves names', () => {
    expect(resolveTransform('反转')).toBe('invert');
    expect(resolveTransform('SCALE')).toBe('scale');
    expect(resolveTransform('从配角的视角')).toBe('viewpoint');
    expect(resolveTransform('???')).toBeNull();
  });
  it('dedupes repeated transforms, fills free ones, filters refs', () => {
    const m = normalizeMap(
      {
        tensions: [{ text: 'a', refs: [1, 9] }, 'b'],
        seeds: [
          { t: 'invert', text: 's1', refs: [1, 2, 99] },
          { t: '反转', text: 's2', refs: ['S2', 'S3'] },
          { t: 'nonsense', text: 's3' },
          { t: 'flaw', text: 's4', refs: [0] },
        ],
      },
      3,
    );
    expect(m.tensions[0].refs).toEqual([1]);
    expect(m.tensions[1].text).toBe('b');
    expect(m.seeds).toHaveLength(4);
    expect(new Set(m.seeds.map((s) => s.transform)).size).toBe(4);
    expect(m.seeds[0].refs).toEqual([1, 2]);
    expect(m.seeds.find((s) => s.text === 's2')!.refs).toEqual([2, 3]);
    expect(m.seeds.find((s) => s.text === 's4')!.refs).toEqual([]); // v0.12：说不出依据就留空，不再替模型编
  });
  it('throws on too few seeds or garbage', () => {
    expect(() => normalizeMap({ seeds: [{ t: 'invert', text: 'x' }] }, 3)).toThrow();
    expect(() => normalizeMap(null, 3)).toThrow();
  });
  it('defix replaces at most 3 and keeps transform', () => {
    const seeds: GraftSeed[] = TRANSFORMS.map((t) => ({ text: t.name, transform: t.id, refs: [1, 2] }));
    const out = applyDefix(seeds, [{ n: 1, text: 'A' }, { n: 1, text: 'dup' }, { n: 3, text: 'B' }, { n: 4, text: 'C' }, { n: 5, text: 'D' }, { n: 99, text: 'E' }], 3);
    expect(out.filter((s) => s.replaced)).toHaveLength(3);
    expect(out[0]).toMatchObject({ text: 'A', transform: 'invert', replaced: true });
    expect(out[4].replaced).toBeUndefined();
    expect(seeds[0].text).toBe('反转'); // 不改原数组
  });
  it('converge keeps the model branches when good', () => {
    const m = normalizeMap(MAP, 3);
    const c = normalizeConverge(CONV, m.seeds, three, 'ob');
    expect(c.filled).toBe(0);
    expect(c.branches.map((b) => b.title)).toEqual(['一', '二', '三']);
    expect(c.branches.map((b) => b.transform)).toEqual(['invert', 'scale', 'flaw']);
    expect(c.pattern).toBe('都在小房间');
    expect(c.seeds.filter((s) => s.replaced)).toHaveLength(3);
    expect(c.seeds.filter((s) => s.chosen)).toHaveLength(3);
    expect(c.branches[0].cliches).toEqual(['雨夜', '错过']);
  });
  it('converge repairs duplicate transforms and missing fields', () => {
    const m = normalizeMap(MAP, 3);
    const c = normalizeConverge(
      { branches: [{ seed: 1, title: 'x', idea: 'one' }, { seed: 1, title: 'dup', idea: 'same transform' }, { transform: '反转', idea: 'also invert' }] },
      m.seeds,
      three,
      'ob',
    );
    expect(c.branches).toHaveLength(3);
    expect(transformsDistinct(c.branches)).toBe(true);
    expect(c.filled).toBe(2);
    expect(c.branches.some((b) => b.title === 'dup')).toBe(false);
    for (const b of c.branches) {
      expect(b.unlike).toBeTruthy();
      expect(b.experiment).toBeTruthy();
    }
  });
});

describe('retry / backoff', () => {
  it('retries 429 and network errors, not 401', async () => {
    let n = 0;
    const waits: number[] = [];
    const r = await withRetry(
      async () => {
        n++;
        if (n === 1) throw new AIError('limited', 429);
        if (n === 2) throw new AIError('net', 0);
        return 'ok';
      },
      { sleep: async (ms) => void waits.push(ms), rand: () => 0.5 },
    );
    expect(r).toBe('ok');
    expect(n).toBe(3);
    expect(waits).toHaveLength(2);
    let m = 0;
    await expect(
      withRetry(
        async () => {
          m++;
          throw new AIError('bad key', 401);
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow('bad key');
    expect(m).toBe(1);
  });
  it('gives up after tries', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new AIError('x', 500); }, { tries: 3, sleep: noSleep })).rejects.toThrow();
    expect(n).toBe(3);
  });
  it('backoff grows and honors Retry-After', () => {
    expect(backoffMs(1, new AIError('x', 429, 4000))).toBe(4000);
    expect(backoffMs(2, new AIError('x', 429), () => 0.5)).toBeGreaterThan(backoffMs(1, new AIError('x', 429), () => 0.5));
    expect(backoffMs(9, new AIError('x', 500), () => 1)).toBeLessThanOrEqual(18000);
  });
});

describe('graftWithAI (mocked fetch)', () => {
  type Mode = 'ok' | '429-first' | 'second-500';
  let mode: Mode = 'ok';
  let seen: string[] = [];
  let count = 0;
  const reply = (obj: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: '好的：\n```json\n' + JSON.stringify(obj) + '\n```' } }] }), { status: 200 });
  beforeAll(() => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      count++;
      const body = JSON.parse(String(init.body));
      const sys = String(body.messages[0].content);
      const phase = sys.includes('PHASE A') ? 'A' : 'C';
      seen.push(phase);
      if (mode === '429-first' && count === 1) return new Response(JSON.stringify({ error: { message: 'limit' } }), { status: 429 });
      if (mode === 'second-500' && phase === 'C') return new Response('oops', { status: 500 });
      return reply(phase === 'A' ? MAP : CONV);
    });
  });
  afterEach(() => {
    seen = [];
    count = 0;
  });
  const s = () => {
    const x = defaultSettings();
    x.chat.apiKey = 'k';
    x.chat.baseUrl = 'http://x/v1';
    return x;
  };

  it('two calls: A+B then C+D, three distinct branches', async () => {
    mode = 'ok';
    const stages: string[] = [];
    const r = await graftWithAI(s(), three, { sleep: noSleep, onProgress: (p) => stages.push(p.stage) });
    expect(seen).toEqual(['A', 'C']);
    expect(r.calls).toBe(2);
    expect(r.source).toBe('ai');
    expect(r.partial).toBeUndefined();
    expect(r.branches).toHaveLength(3);
    expect(transformsDistinct(r.branches)).toBe(true);
    expect(r.tensions).toHaveLength(4);
    expect(stages).toEqual(['map', 'defix', 'done']);
  });
  it('backs off on 429 and still finishes', async () => {
    mode = '429-first';
    const retries: number[] = [];
    const r = await graftWithAI(s(), three, { sleep: noSleep, onProgress: (p) => p.retry && retries.push(p.retry.attempt) });
    expect(r.calls).toBe(3);
    expect(retries).toEqual([1]);
    expect(r.branches).toHaveLength(3);
  });
  it('second call failing → partial, converged locally from seeds', async () => {
    mode = 'second-500';
    const r = await graftWithAI(s(), three, { sleep: noSleep });
    expect(r.partial).toBe(true);
    expect(r.calls).toBe(4); // 1 + 3 次重试
    expect(r.branches).toHaveLength(3);
    expect(transformsDistinct(r.branches)).toBe(true);
  });
});
