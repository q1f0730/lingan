import { describe, expect, it } from 'vitest';
import { buildHeatmap, dayKey, heatLevel, itemsOnDay, weekRow } from '../lib/heatmap';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 10, 21, 20); // 周三

describe('热力图', () => {
  it('365 格、最后一格是今天、行号按周一起算', () => {
    const h = buildHeatmap([], NOW);
    expect(h.cells.length).toBe(365);
    expect(h.cells[364].key).toBe('2026-10-21');
    expect(h.cells[364].row).toBe(weekRow(NOW));
    expect(weekRow(NOW)).toBe(2);
    expect(weekRow(at(2026, 10, 25))).toBe(6); // 周日
    expect(h.weeks).toBe(h.cells[364].col + 1);
    expect(h.weeks).toBeGreaterThanOrEqual(53);
    expect(h.weeks).toBeLessThanOrEqual(54);
  });
  it('按天计数、统计与窗口外素材被忽略', () => {
    const items = [
      { createdAt: at(2026, 10, 21, 8) },
      { createdAt: at(2026, 10, 21, 23) },
      { createdAt: at(2026, 10, 20) },
      { createdAt: at(2024, 1, 1) }, // 窗口外
      { createdAt: at(2026, 10, 22) }, // 未来
      { createdAt: NaN },
    ];
    const h = buildHeatmap(items, NOW);
    expect(h.total).toBe(3);
    expect(h.activeDays).toBe(2);
    expect(h.max).toBe(2);
    expect(h.cells[364].count).toBe(2);
    expect(h.cells[364].level).toBe(4);
    expect(h.cells[363].level).toBe(2);
  });
  it('连续天数：今天没收不算断；中间断了就重算', () => {
    const d = (n: number) => ({ createdAt: at(2026, 10, 21 - n) });
    expect(buildHeatmap([d(1), d(2), d(3)], NOW).current).toBe(3);
    expect(buildHeatmap([d(0), d(1), d(3)], NOW).current).toBe(2);
    expect(buildHeatmap([d(2)], NOW).current).toBe(0);
    const h = buildHeatmap([d(0), d(1), d(2), d(10), d(11)], NOW);
    expect(h.longest).toBe(3);
  });
  it('层级随最大值缩放，0 永远是 0', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 1)).toBe(4);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(5, 0)).toBe(0);
  });
  it('月份标签递增且不重复；某天素材按时间倒序', () => {
    const h = buildHeatmap([], NOW);
    expect(h.months.length).toBeGreaterThanOrEqual(12);
    const cols = h.months.map((m) => m.col);
    expect([...cols].sort((a, b) => a - b)).toEqual(cols);
    const list = itemsOnDay([{ createdAt: at(2026, 10, 21, 9) }, { createdAt: at(2026, 10, 21, 18) }, { createdAt: at(2026, 10, 20) }], '2026-10-21');
    expect(list.map((x) => new Date(x.createdAt).getHours())).toEqual([18, 9]);
    expect(dayKey(at(2026, 1, 5))).toBe('2026-01-05');
  });
});
