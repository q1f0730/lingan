import { describe, expect, it } from 'vitest';
import { groupByDay, throwbacks } from '../lib/memory';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 10, 22, 9);

describe('记忆', () => {
  it('按天分组，新到旧', () => {
    const g = groupByDay([{ createdAt: at(2026, 10, 20, 8) }, { createdAt: at(2026, 10, 21, 8) }, { createdAt: at(2026, 10, 21, 20) }]);
    expect(g.map((x) => x.key)).toEqual(['2026-10-21', '2026-10-20']);
    expect(g[0].items[0].createdAt).toBe(at(2026, 10, 21, 20));
  });
  it('一周前 / 一年前的今天', () => {
    const t = throwbacks([{ createdAt: at(2026, 10, 15, 1) }, { createdAt: at(2025, 10, 22, 23) }, { createdAt: at(2026, 10, 18) }], NOW);
    expect(t.map((x) => x.label)).toEqual(['一周前的你', '那年今天 · 1 年前']);
  });
  it('没有则为空', () => {
    expect(throwbacks([], NOW)).toEqual([]);
  });
});
