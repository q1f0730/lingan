import { describe, expect, it } from 'vitest';
import { columnCount, estimateCardHeight, layoutList, layoutMasonry, listRange, visibleIndexes } from '../lib/virtual';

describe('virtual scrolling maths', () => {
  it('columnCount mirrors CSS columns: 3 250px / 2 150px', () => {
    expect(columnCount(1100, 3, 250, 16)).toBe(3);
    expect(columnCount(600, 3, 250, 16)).toBe(2);
    expect(columnCount(240, 3, 250, 16)).toBe(1);
    expect(columnCount(358, 2, 150, 12)).toBe(2);
    expect(columnCount(0, 2, 150, 12)).toBe(1);
  });
  it('masonry puts each card in the shortest column, deterministic, total height right', () => {
    const { cells, height } = layoutMasonry([100, 50, 30, 40, 10], 2, 150, 12, 14);
    expect(cells.map((c) => c.col)).toEqual([0, 1, 1, 1, 0]);
    expect(cells[1]).toMatchObject({ top: 0, left: 162 });
    expect(cells[2].top).toBe(64);
    expect(cells[3].top).toBe(108);
    expect(cells[4].top).toBe(114);
    expect(height).toBe(148);
    expect(layoutMasonry([], 3, 100, 10, 10).height).toBe(0);
    expect(layoutMasonry([5, 5, 5], 1, 100, 10, 10).cells.map((c) => c.top)).toEqual([0, 15, 30]);
  });
  it('only cards inside the window are mounted — 1000 cards, ~a screen worth', () => {
    const hs = Array.from({ length: 1000 }, (_, i) => 180 + (i % 5) * 40);
    const { cells, height } = layoutMasonry(hs, 2, 170, 12, 14);
    const vis = visibleIndexes(cells, 5000 - 700, 5000 + 844 + 700);
    expect(vis.length).toBeGreaterThan(10);
    expect(vis.length).toBeLessThan(40);
    expect(vis).toEqual([...vis].sort((a, b) => a - b));
    for (const i of vis) expect(cells[i].top + cells[i].height).toBeGreaterThanOrEqual(4300);
    expect(visibleIndexes(cells, height + 10, height + 900)).toEqual([]);
  });
  it('list offsets and binary-searched range', () => {
    const hs = [100, 200, 50, 300, 80];
    const { tops, height } = layoutList(hs, 18);
    expect(tops).toEqual([0, 118, 336, 404, 722]);
    expect(height).toBe(802);
    expect(listRange(tops, hs, 0, 50)).toEqual([0, 1]);
    expect(listRange(tops, hs, 330, 410)).toEqual([2, 4]);
    expect(listRange(tops, hs, 700, 2000)).toEqual([3, 5]);
    expect(listRange([], [], 0, 100)).toEqual([0, 0]);
  });
  it('height estimate follows the thumbnail ratio and text length', () => {
    const base = { type: 'image' as const, title: '图', tags: [] as string[] };
    const wide = estimateCardHeight({ ...base, thumbW: 400, thumbH: 200, hasImage: 1 }, 200);
    const tall = estimateCardHeight({ ...base, thumbW: 200, thumbH: 400, hasImage: 1 }, 200);
    expect(tall).toBeGreaterThan(wide);
    expect(tall - wide).toBeLessThanOrEqual(360);
    const short = estimateCardHeight({ type: 'text', title: 'x', content: '短', tags: [] }, 200);
    const long = estimateCardHeight({ type: 'text', title: 'x', content: '很长的一段摘抄'.repeat(20), tags: [] }, 200);
    expect(long).toBeGreaterThan(short);
  });
});
