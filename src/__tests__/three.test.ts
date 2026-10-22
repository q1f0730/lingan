import { describe, expect, it } from 'vitest';
import { groupBranches } from '../lib/branches';
import { GROW_ROWS, growFrame, stageProgress } from '../lib/growing';
import type { Development } from '../lib/types';

describe('growing wheat (v0.11)', () => {
  it('progress rises within a stage, never completes before done', () => {
    expect(stageProgress('map', 0)).toBeLessThan(stageProgress('map', 5000));
    expect(stageProgress('map', 1e9)).toBeLessThanOrEqual(0.55 + 1e-9);
    expect(stageProgress('defix', 0)).toBeGreaterThanOrEqual(stageProgress('map', 1e9) - 1e-9);
    expect(stageProgress('defix', 1e9)).toBeLessThan(1);
    expect(stageProgress('done', 0)).toBe(1);
  });
  it('frame has fixed size and grows taller with progress', () => {
    const lines = (p: number) => growFrame(p, 0, true).split('\n');
    const ink = (p: number) => lines(p).slice(1, -1).join('').replace(/\s/g, '').length;
    expect(lines(0).length).toBe(GROW_ROWS + 2);
    expect(lines(1).length).toBe(GROW_ROWS + 2);
    expect(new Set(lines(0.5).map((l) => l.length)).size).toBe(1);
    expect(ink(0)).toBe(0);
    expect(ink(0.5)).toBeGreaterThan(0);
    expect(ink(1)).toBeGreaterThan(ink(0.5));
  });
  it('still frame does not depend on tick (reduced motion)', () => {
    expect(growFrame(0.6, 1, true)).toBe(growFrame(0.6, 7, true));
    expect(growFrame(0.6, 1, false)).not.toBe(growFrame(0.6, 2, false));
  });
});

describe('groupBranches', () => {
  const idea = { title: 't', bridge: '', idea: 'x', cliches: [] };
  const d = (id: number, batch?: Development['batch']): Development => ({ id, itemIds: [1, 2], jump: 0.5, idea, source: 'offline', createdAt: id, batch });
  it('groups a batch of three, keeps legacy singles, orders by index', () => {
    const list = [
      d(9, { id: 'b2', index: 2, size: 3 }),
      d(8, { id: 'b2', index: 1, size: 3 }),
      d(7, { id: 'b2', index: 0, size: 3, seeds: [], tensions: [{ text: 'a', refs: [1] }] }),
      d(5),
      d(4, { id: 'b1', index: 0, size: 3, tensions: [] }),
    ];
    const g = groupBranches(list);
    expect(g.map((x) => x.key)).toEqual(['b2', 'd5', 'b1']);
    expect(g[0].devs.map((x) => x.id)).toEqual([7, 8, 9]);
    expect(g[0].batch?.tensions?.[0].text).toBe('a');
    expect(g[1].batch).toBeUndefined();
  });
});
