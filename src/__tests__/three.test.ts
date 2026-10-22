import { describe, expect, it } from 'vitest';
import { groupBranches } from '../lib/branches';
import type { Development } from '../lib/types';

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
