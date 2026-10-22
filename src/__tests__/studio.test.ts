import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LinganDB, addItem, deleteItem, restoreItem, snapshotItem } from '../lib/db';
import { activeMonths, bookTitle, branchesFrom, displayTitle, groupByWeek, matchBranch, monthGrid, quoteSource, shortDate, splitHits, tagCounts } from '../lib/studio';
import { resolveTheme, themeFromLegacy } from '../lib/theme';
import type { Development, Item } from '../lib/types';

const it0 = (p: Partial<Item>): Item => ({ type: 'idea', title: 't', tags: [], createdAt: 0, updatedAt: 0, ...p });

describe('v0.16 Studio 文字', () => {
  it('书名号：电影加《》，已有的不重复加；《一一》不会被读成破折号', () => {
    expect(bookTitle('一一')).toBe('《一一》');
    expect(bookTitle('《完美的日子》')).toBe('《完美的日子》');
    expect(bookTitle('  ')).toBe('');
    expect(displayTitle(it0({ type: 'film', title: '一一' }))).toBe('《一一》');
    expect(displayTitle(it0({ type: 'music', title: 'Re: Stacks' }))).toBe('Re: Stacks');
  });
  it('摘抄：显示原文（统一成弯引号），出处是 作者《书名》', () => {
    const q = it0({ type: 'text', title: '看不见的城市', content: '「记忆中的形象一旦被词语固定住，就给抹掉了。」', creator: '卡尔维诺' });
    expect(displayTitle(q)).toBe('“记忆中的形象一旦被词语固定住，就给抹掉了。”');
    expect(quoteSource(q)).toBe('卡尔维诺 《看不见的城市》');
  });
  it('短日期：今年 MM/DD，往年带年份', () => {
    const now = new Date(2026, 9, 22).getTime();
    expect(shortDate(new Date(2026, 9, 5, 8).getTime(), now)).toBe('10/05');
    expect(shortDate(new Date(2025, 0, 2).getTime(), now)).toBe('2025/01/02');
  });
  it('命中高亮：大小写不敏感、多处命中、空关键词原样', () => {
    expect(splitHits('雾里的雾', '雾')).toEqual([
      { t: '雾', hit: true },
      { t: '里的', hit: false },
      { t: '雾', hit: true },
    ]);
    expect(splitHits('Re: Stacks', 'stack').map((x) => x.hit)).toEqual([false, true, false]);
    expect(splitHits('abc', '')).toEqual([{ t: 'abc', hit: false }]);
  });
  it('标签真实计数：多→少，同数按字排', () => {
    expect(tagCounts([{ tags: ['城市', '夜里'] }, { tags: ['城市'] }, { tags: ['书'] }])).toEqual([
      ['城市', 2],
      ['书', 1],
      ['夜里', 1],
    ]);
  });
});

describe('时间线按周 / 月历', () => {
  it('按周（周一起）分组，新→旧，标签是 MM/DD — MM/DD', () => {
    const t = (d: number, h = 9) => new Date(2026, 9, d, h).getTime(); // 2026-10-19 是周一
    const g = groupByWeek([it0({ createdAt: t(19) }), it0({ createdAt: t(25, 23) }), it0({ createdAt: t(26) }), it0({ createdAt: t(18) })]);
    expect(g.map((x) => x.items.length)).toEqual([1, 2, 1]);
    expect(g[1].label).toBe('10/19 — 10/25');
    expect(g[0].items[0].createdAt).toBe(t(26));
  });
  it('2026 年 10 月：10/1 是周四（前面 3 个空格），有穗的日子 count>0，总数只算本月', () => {
    const items = [new Date(2026, 9, 1, 10), new Date(2026, 9, 1, 22), new Date(2026, 9, 14), new Date(2026, 8, 30)].map((d) => ({ createdAt: d.getTime() }));
    const g = monthGrid(items, 2026, 9);
    expect(g.label).toBe('十月');
    expect(g.total).toBe(3);
    expect(g.cells.slice(0, 3).every((c) => c.day === 0)).toBe(true);
    expect(g.cells[3]).toMatchObject({ day: 1, count: 2 });
    expect(g.cells.filter((c) => c.day > 0)).toHaveLength(31);
    expect(g.cells.filter((c) => c.count > 0)).toHaveLength(2);
    expect(activeMonths(items)).toEqual([
      [2026, 9],
      [2026, 8],
    ]);
  });
});

describe('溯源反查与搜新枝', () => {
  const dev = (id: number, itemIds: number[], title = '楼道电台'): Development =>
    ({ id, itemIds, idea: { title, bridge: '', idea: '给每一盏声控灯配一个频道', cliches: [] }, source: 'offline', createdAt: id } as unknown as Development);
  it('这一穗长进了哪些新枝', () => {
    const ds = [dev(1, [3, 4, 5]), dev(2, [6, 7, 8]), dev(3, [3, 9, 10])];
    expect(branchesFrom(ds, 3).map((d) => d.id)).toEqual([1, 3]);
    expect(branchesFrom(ds, 99)).toEqual([]);
  });
  it('搜新枝：标题与正文', () => {
    expect(matchBranch(dev(1, []), '声控灯')).toBe(true);
    expect(matchBranch(dev(1, []), '电台')).toBe(true);
    expect(matchBranch(dev(1, []), '雾')).toBe(false);
    expect(matchBranch(dev(1, []), ' ')).toBe(false);
  });
});

describe('主题', () => {
  it('跟随系统 / 固定白 / 固定黑', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('旧设置迁移：固定「夜晚」→ 黑，固定白天类 → 白，跟随时间 → 跟随系统', () => {
    expect(themeFromLegacy({ phase: 'night' })).toBe('dark');
    expect(themeFromLegacy({ phase: 'dusk' })).toBe('light');
    expect(themeFromLegacy({ phase: 'auto' })).toBe('auto');
    expect(themeFromLegacy({})).toBe('auto');
    expect(themeFromLegacy({ theme: 'dark', phase: 'day' })).toBe('dark');
  });
});

describe('删除可撤销', () => {
  it('删掉再撤销：同一个 id、原图一起回来', async () => {
    const d = new LinganDB('undo-' + Math.random());
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const id = await addItem({ type: 'image', title: '轮渡上的雾', tags: ['雾'], image: png }, d);
    const snap = await snapshotItem(id, d);
    expect(snap?.image).toBeTruthy();
    await deleteItem(id, d);
    expect(await d.items.get(id)).toBeUndefined();
    expect(await d.images.get(id)).toBeUndefined();
    expect(await restoreItem(snap!, d)).toBe(id);
    expect((await d.items.get(id))?.title).toBe('轮渡上的雾');
    expect(await d.images.get(id)).toBeTruthy();
    expect(await snapshotItem(12345, d)).toBeNull();
  });
});
