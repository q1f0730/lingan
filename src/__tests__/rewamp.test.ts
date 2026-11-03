import { describe, expect, it } from 'vitest';
import { NAV } from '../components/rw/NavBar';
import { splitPhrases } from '../components/rw/WordReveal';

describe('v0.20 Rewamp 外壳', () => {
  it('主导航仍是五页、顺序不变，每页一个图标和一个互不相同的快捷键', () => {
    expect(NAV.map((n) => n.v)).toEqual(['library', 'develop', 'branches', 'taste', 'settings']);
    expect(NAV.map((n) => n.label)).toEqual(['穗仓', '嫁接', '新枝', '口味', '设置']);
    expect(new Set(NAV.map((n) => n.key)).size).toBe(5);
    expect(NAV.every((n) => typeof n.Icon === 'function')).toBe(true);
  });
  it('逐词淡入只在标点 / 空格处切，拼回去一字不差，一句短中文不拆字', () => {
    expect(splitPhrases('穗仓还是空的')).toEqual(['穗仓还是空的']);
    const s = '看到喜欢的，就顺手拾一穗：一首歌、一部电影。';
    const parts = splitPhrases(s);
    expect(parts.join('')).toBe(s);
    expect(parts).toEqual(['看到喜欢的，', '就顺手拾一穗：', '一首歌、', '一部电影。']);
    expect(splitPhrases('Every pixel matters').join('')).toBe('Every pixel matters');
  });
});
