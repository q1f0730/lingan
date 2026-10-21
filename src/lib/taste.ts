import type { Item, ItemType } from './types';

export interface TasteStats {
  total: number;
  byType: Record<ItemType, number>;
  topTags: Array<[string, number]>;
  topCreators: Array<[string, number]>;
  whyWords: Array<[string, number]>;
  decades: Array<[string, number]>;
  streakDays: number;
  last7: number[];
}

const STOP = new Set(['一个', '这个', '那个', '我们', '你们', '他们', '自己', '没有', '就是', '因为', '所以', '但是', '然后', '还是', '觉得', '感觉', '的时', '时候', '什么', '可以', '一种', '这种', '那种', '一样', '很多', '非常', '真的', '已经']);

function count<T extends string>(arr: T[]): Array<[T, number]> {
  const m = new Map<T, number>();
  for (const a of arr) m.set(a, (m.get(a) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function computeTaste(items: Item[], now = Date.now()): TasteStats {
  const byType = { music: 0, film: 0, image: 0, text: 0, link: 0, idea: 0 } as Record<ItemType, number>;
  for (const it of items) byType[it.type] = (byType[it.type] || 0) + 1;
  const topTags = count(items.flatMap((i) => i.tags)).slice(0, 16);
  const topCreators = count(items.map((i) => (i.creator || '').trim()).filter(Boolean)).slice(0, 8);
  const bigrams: string[] = [];
  for (const it of items) {
    const han = (it.why || '').replace(/[^\u4e00-\u9fff]/g, ' ');
    for (const seg of han.split(/\s+/)) for (let i = 0; i < seg.length - 1; i++) {
      const b = seg.slice(i, i + 2);
      if (!STOP.has(b)) bigrams.push(b);
    }
  }
  const whyWords = count(bigrams).filter(([, n]) => n > 1).slice(0, 12);
  const decades = count(
    items
      .map((i) => parseInt((i.year || '').slice(0, 4), 10))
      .filter((y) => y > 1800 && y < 2200)
      .map((y) => `${Math.floor(y / 10) * 10}s`),
  ).sort((a, b) => a[0].localeCompare(b[0]));
  const day = 86400000;
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const t0 = startToday.getTime();
  const last7 = Array.from({ length: 7 }, (_, k) => {
    const from = t0 - (6 - k) * day;
    return items.filter((i) => i.createdAt >= from && i.createdAt < from + day).length;
  });
  let streak = 0;
  for (let k = 0; k < 3650; k++) {
    const from = t0 - k * day;
    const has = items.some((i) => i.createdAt >= from && i.createdAt < from + day);
    if (has) streak++;
    else if (k === 0) continue;
    else break;
  }
  return { total: items.length, byType, topTags, topCreators, whyWords, decades, streakDays: streak, last7 };
}

export function tastePrompt(items: Item[]): string {
  const sample = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  return sample
    .map((i) => `- [${i.type}] ${i.title}${i.creator ? ' / ' + i.creator : ''}${i.why ? ' ——' + i.why : ''}${i.tags.length ? ' #' + i.tags.join(' #') : ''}`)
    .join('\n');
}
