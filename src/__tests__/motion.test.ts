import { describe, expect, it } from 'vitest';
import { decodeFrame, magnetOffset, motionLevel, revealCount, staggerDelay, typeDuration } from '../lib/motion';

describe('动效逻辑', () => {
  it('减少动效 → off；低端机/省流量 → lite；其余 full', () => {
    expect(motionLevel({ reduced: true, cores: 16 })).toBe('off');
    expect(motionLevel({ cores: 4 })).toBe('lite');
    expect(motionLevel({ memory: 2 })).toBe('lite');
    expect(motionLevel({ saveData: true })).toBe('lite');
    expect(motionLevel({ cores: 8, memory: 8 })).toBe('full');
    expect(motionLevel({})).toBe('full');
  });
  it('入场延迟：递增并封顶', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(-3)).toBe(0);
    expect(staggerDelay(3)).toBe(135);
    expect(staggerDelay(500)).toBe(12 * 45);
    expect(staggerDelay(NaN)).toBe(0);
  });
  it('解码：长度不变、空白标点保留、progress=1 还原原文', () => {
    const t = '《暗房 里的 光》，好';
    for (const p of [0, 0.3, 0.9]) {
      const f = decodeFrame(t, p, 5);
      expect(Array.from(f).length).toBe(Array.from(t).length);
      expect(f[0]).toBe('《');
      expect(f.includes(' ')).toBe(true);
      expect(f.includes('，')).toBe(true);
    }
    expect(decodeFrame(t, 1)).toBe(t);
    expect(decodeFrame(t, 7)).toBe(t);
    expect(decodeFrame(t, 0.5, 2)).toBe(decodeFrame(t, 0.5, 2));
    expect(decodeFrame('', 0.5)).toBe('');
  });
  it('解码：已解出的前缀保持原文', () => {
    const t = '光影与噪点';
    expect(decodeFrame(t, 0.6, 3).slice(0, 3)).toBe('光影与');
  });
  it('逐字浮现：单调、不越界、时长夹紧', () => {
    expect(revealCount(100, 0)).toBe(0);
    expect(revealCount(100, 0.5)).toBe(50);
    expect(revealCount(100, 2)).toBe(100);
    expect(revealCount(0, 0.5)).toBe(0);
    expect(revealCount(10, NaN)).toBe(0);
    expect(typeDuration(1)).toBe(600);
    expect(typeDuration(140)).toBe(2000);
    expect(typeDuration(99999)).toBe(3500);
  });
  it('磁吸：靠近才吸、位移有上限、方向朝向指针', () => {
    expect(magnetOffset(0, 0)).toEqual({ x: 0, y: 0 });
    expect(magnetOffset(500, 0)).toEqual({ x: 0, y: 0 });
    const o = magnetOffset(35, 0, 70, 6);
    expect(o.x).toBeGreaterThan(0);
    expect(o.x).toBeLessThanOrEqual(6);
    expect(o.y).toBe(0);
    expect(magnetOffset(0, -1, 70, 6).y).toBeLessThan(0);
  });
});
