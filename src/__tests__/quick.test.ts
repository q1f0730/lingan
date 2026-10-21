import { describe, expect, it } from 'vitest';
import { formatWhen, fromLocalInput, hashText, parseQuick, shouldOffer, toLocalInput } from '../lib/quick';

describe('parseQuick', () => {
  it('idea with tags', () => {
    const d = parseQuick('雨夜里的霓虹倒影 #雨 #霓虹')!;
    expect(d.type).toBe('idea');
    expect(d.title).toBe('雨夜里的霓虹倒影');
    expect(d.tags).toEqual(['雨', '霓虹']);
  });
  it('link detection keeps text as title', () => {
    const d = parseQuick('这首好听 https://music.163.com/song?id=1 #夜')!;
    expect(d.type).toBe('music');
    expect(d.url).toBe('https://music.163.com/song?id=1');
    expect(d.title).toBe('这首好听');
    expect(d.tags).toEqual(['夜']);
  });
  it('bare url → title is url', () => {
    const d = parseQuick('https://example.com/a')!;
    expect(d.type).toBe('link');
    expect(d.title).toBe('https://example.com/a');
  });
  it('quote → 文案', () => {
    const d = parseQuick('「我们最接近的时候，我跟她之间的距离只有0.01公分」')!;
    expect(d.type).toBe('text');
    expect(d.content?.startsWith('我们最接近')).toBe(true);
  });
  it('empty', () => {
    expect(parseQuick('   ')).toBeNull();
    expect(parseQuick('#只有标签')).toBeNull();
  });
});

describe('time', () => {
  const now = new Date(2026, 9, 21, 22, 30).getTime();
  it('formats relative', () => {
    expect(formatWhen(new Date(2026, 9, 21, 22, 18).getTime(), now)).toBe('今天 22:18');
    expect(formatWhen(new Date(2026, 9, 20, 9, 1).getTime(), now)).toBe('昨天 09:01');
    expect(formatWhen(new Date(2026, 9, 19, 9, 1).getTime(), now)).toBe('10/19');
    expect(formatWhen(new Date(2025, 9, 19, 9, 1).getTime(), now)).toBe('2025/10/19');
  });
  it('local input roundtrip', () => {
    const t = new Date(2026, 0, 5, 7, 8).getTime();
    expect(toLocalInput(t)).toBe('2026-01-05T07:08');
    expect(fromLocalInput(toLocalInput(t))).toBe(t);
    expect(fromLocalInput('bad')).toBeNull();
  });
});

describe('clipboard offer', () => {
  it('filters', () => {
    expect(shouldOffer('', null, [])).toBe(false);
    expect(shouldOffer('新句子', null, [])).toBe(true);
    expect(shouldOffer('新句子', hashText('新句子'), [])).toBe(false);
    expect(shouldOffer('看 https://a.com/x', null, [{ title: 't', url: 'https://a.com/x' }])).toBe(false);
    expect(shouldOffer('重庆森林', null, [{ title: '重庆森林' }])).toBe(false);
  });
});
