// v0.42 瘦身：示例的抽法单独一份（不带示例数据）。数据在 samples.ts（单测 / 生成用）与 samplepack.ts（App 用，压缩包）
import type { Item, ItemType } from './types';
export type Sample = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;

/** 随机抽 n 条：先每种类型至少 1 条（库里有的话），再随机补满，最后打乱。不重复 */
export function drawSamples(n: number, rand: () => number, pool: Sample[]): Sample[] {
  const left = pool.map((_, i) => i);
  const take = (idx: number) => left.splice(idx, 1)[0];
  const out: number[] = [];
  const types: ItemType[] = ['film', 'music', 'image', 'text', 'idea', 'link'];
  for (const t of types) {
    if (out.length >= n) break;
    const cand = left.map((i, k) => [i, k] as const).filter(([i]) => pool[i].type === t);
    if (cand.length) out.push(take(cand[Math.floor(rand() * cand.length)][1]));
  }
  while (out.length < n && left.length) out.push(take(Math.floor(rand() * left.length)));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.map((i) => ({ ...pool[i], tags: [...pool[i].tags], sample: 1 as const }));
}

/** 示例的「拾于」时间：铺在过去 3–90 天里，好让时间线 / 每日一穗一打开就有东西 */
export function sampleTimes(n: number, now = Date.now(), rand: () => number = Math.random): number[] {
  const DAY = 86400000;
  return Array.from({ length: n }, () => now - Math.round((3 + rand() * 87) * DAY + rand() * DAY * 0.5)).sort((a, b) => b - a);
}
