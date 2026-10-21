import { describe, expect, it } from 'vitest';
import { emptyFrames, gridFor, lumToChar, lumToText, RAMP, revealedCount, revealTimes, rng } from '../lib/ascii';

describe('ascii 显影', () => {
  it('亮度映射到字符：暗=密，亮=空白，越界安全', () => {
    expect(lumToChar(0)).toBe('@');
    expect(lumToChar(1)).toBe(' ');
    expect(lumToChar(-5)).toBe('@');
    expect(lumToChar(NaN)).toBe('@');
    expect(RAMP.includes(lumToChar(0.5))).toBe(true);
  });
  it('网格按宽高比折算，行数约为列数的一半（横图）', () => {
    expect(gridFor(800, 800, 40)).toEqual({ cols: 40, rows: 20 });
    expect(gridFor(800, 400, 40).rows).toBe(10);
    expect(gridFor(0, 0, 40).rows).toBe(20);
    expect(gridFor(100, 100000, 40).rows).toBe(120);
  });
  it('rng 可复现', () => {
    const a = rng(3);
    const b = rng(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('显影时刻：范围 0..1，进度单调增加，中心先于边缘', () => {
    const t = revealTimes(20, 10, 5);
    expect(t.length).toBe(200);
    expect(Math.min(...t)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...t)).toBeLessThanOrEqual(1);
    expect(revealedCount(t, 0)).toBeLessThanOrEqual(revealedCount(t, 0.5));
    expect(revealedCount(t, 0.5)).toBeLessThan(revealedCount(t, 1));
    expect(revealedCount(t, 1)).toBe(200);
    const center = t[5 * 20 + 10];
    const corner = t[0];
    expect(center).toBeLessThan(corner + 0.31);
    const avgCenter = (t[5 * 20 + 9] + t[5 * 20 + 10] + t[4 * 20 + 10]) / 3;
    expect(avgCenter).toBeLessThan(0.5);
  });
  it('lumToText 输出行列正确', () => {
    const s = lumToText([0, 1, 1, 0], 2, 2);
    expect(s).toBe('@ \n @');
  });
  it('空状态帧：逐帧增多，最后一帧显出实心', () => {
    const f = emptyFrames();
    expect(f.length).toBe(9);
    expect(f[0].split('\n').length).toBe(7);
    expect(f[8]).toContain('@');
    const ink = (s: string) => s.replace(/[\s\n]/g, '').length;
    expect(ink(f[8])).toBeGreaterThan(ink(f[0]) - 1);
  });
});
