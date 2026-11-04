// v0.43 0935 隐私承诺写成可测试的条款：docs/PRIVACY.md 每一条都指向真实存在的测试（单独一个文件：import.meta.glob 不会把自己算进去）
import { describe, expect, it } from 'vitest';

const raw = import.meta.glob(['../../docs/PRIVACY.md', '../../e2e/run.mjs'], { query: '?raw', eager: true, import: 'default' }) as Record<string, string>;
const file = (end: string) => Object.entries(raw).find(([k]) => k.endsWith(end))![1];
const tests = import.meta.glob('./*.test.ts', { query: '?raw', eager: true, import: 'default' }) as Record<string, string>;

describe('0935 隐私承诺写成可测试的条款', () => {
  it('docs/PRIVACY.md 每条承诺都指向一个真实存在的测试', () => {
    const md = file('PRIVACY.md');
    const refs = [...md.matchAll(/^- \*\*(P\d+)\*\*.*?测试：`([^`]+)`(?:\s*\/\s*`([^`]+)`)?/gm)];
    expect(refs.length).toBeGreaterThanOrEqual(8);
    const e2e = file('run.mjs');
    const all = Object.values(tests).join('\n');
    for (const r of refs) for (const t of [r[2], r[3]].filter(Boolean)) expect(e2e.includes(t) || all.includes(t), `${r[1]} → ${t}`).toBe(true);
  });
});

