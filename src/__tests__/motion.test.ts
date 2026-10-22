import { describe, expect, it } from 'vitest';
import { motionLevel, staggerDelay } from '../lib/motion';

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
    expect(staggerDelay(3)).toBe(120);
    expect(staggerDelay(500)).toBe(8 * 40); // 规范：错开 40ms，最多 8 项
    expect(staggerDelay(NaN)).toBe(0);
  });
});
