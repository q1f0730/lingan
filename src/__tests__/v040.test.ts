// v0.40 忘了 PIN 冷静期 + 时间与回看（周记 / 麦捆 / 一年的麦田 / 被遗忘的好东西 / 放下 / 再看一句 / 本月在拾 + 休耕 / 口味会说话 / 田埂）
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Development, Item } from '../lib/types';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
beforeAll(() => {
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
beforeEach(() => localStorage.clear());

const H = 3600000;
const DAY = 24 * H;
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
let nid = 1;
const mk = (o: Partial<Item> = {}): Item => ({ id: nid++, type: 'idea', title: 't' + nid, tags: [], createdAt: at(2026, 10, 15), updatedAt: 0, ...o });

describe('忘了 PIN：24 小时冷静期', () => {
  it('同一次运行里把墙钟往后拨不算数（只认单调钟走过的）', async () => {
    vi.resetModules();
    const P = await import('../lib/lockpin');
    const t0 = at(2026, 11, 1, 9);
    P.startReset(t0, 1000);
    expect(P.resetLeft(t0, 1000)).toBe(P.RESET_MS);
    // 墙钟一下子跳 25 小时，单调钟只走了 1 分钟
    const left = P.resetLeft(t0 + 25 * H, 1000 + 60000)!;
    expect(left).toBeGreaterThan(P.RESET_MS - 2 * 60000);
    expect(P.finishReset(t0 + 25 * H, 1000 + 61000)).toBe(false);
    // 正常过 24 小时（两个钟一起走）才行
    expect(P.resetLeft(t0 + 49 * H, 1000 + 24 * H + 62000)).toBe(0);
  });
  it('关着 App 的那段按墙钟补；往回拨过就从头算；满了要再点一次才清掉旧 PIN', async () => {
    vi.resetModules();
    const L = await import('../lib/lock');
    let P = await import('../lib/lockpin');
    await P.setPin('2468');
    const t0 = at(2026, 11, 1, 9);
    P.startReset(t0, 500);
    // 「重启」：模块状态清空
    vi.resetModules();
    P = await import('../lib/lockpin');
    expect(P.resetLeft(t0 + 10 * H, 10)).toBe(14 * H);
    vi.resetModules();
    P = await import('../lib/lockpin');
    // 下次启动发现墙钟比见过的还早：动过时间，冷静期从头
    expect(P.resetLeft(t0 + 2 * H, 10)).toBe(P.RESET_MS);
    expect(L.lockReady()).toBe(true);
    vi.resetModules();
    P = await import('../lib/lockpin');
    expect(P.finishReset(t0 + 2 * H + 25 * H, 10)).toBe(true);
    expect(localStorage.getItem('glean.lock.v1')).toBeNull();
    expect(localStorage.getItem(P.RESET_KEY)).toBeNull();
  }, 20000);
  it('取消之后不再计时，PIN 不变', async () => {
    vi.resetModules();
    const P = await import('../lib/lockpin');
    await P.setPin('1357');
    P.startReset();
    P.cancelReset();
    expect(P.resetLeft()).toBeNull();
    expect(await P.checkPin('1357', false)).toBe(true);
  }, 20000);
  it('立即重设：上锁穗的内容清空、图删掉、进回收站，别的穗不动', async () => {
    vi.resetModules();
    const { db, addItem } = await import('../lib/db');
    const P = await import('../lib/lockpin');
    await P.setPin('2468');
    const a = await addItem({ type: 'text', title: '心事', content: '不想给人看', why: '因为', tags: ['私'], locked: 1 });
    const b = await addItem({ type: 'text', title: '普通', content: '照常', tags: [] });
    expect(await P.wipeLocked()).toBe(1);
    const ra = (await db.items.get(a))!;
    expect(ra.title).toBe('已清空的上锁穗');
    expect(ra.content).toBe('');
    expect(ra.why).toBe('');
    expect(ra.tags).toEqual([]);
    expect(ra.locked).toBeUndefined();
    expect(ra.deletedAt).toBeGreaterThan(0);
    expect((await db.items.get(b))!.content).toBe('照常');
    expect(localStorage.getItem('glean.lock.v1')).toBeNull();
  }, 20000);
});

describe('0923 本月有 n 天在拾 + 休耕', () => {
  it('断了不清零；休耕的日子单独记，可以提前结束', async () => {
    const R = await import('../lib/review');
    const now = at(2026, 11, 20);
    const items = [mk({ createdAt: at(2026, 11, 2) }), mk({ createdAt: at(2026, 11, 2, 20) }), mk({ createdAt: at(2026, 11, 9) }), mk({ createdAt: at(2026, 10, 30) })];
    expect(R.monthDays(items, now).days).toBe(2);
    let f = R.toggleFallow([], at(2026, 11, 14));
    expect(f).toEqual([['2026-11-14', '2026-11-20']]);
    expect(R.monthDays(items, now, f)).toMatchObject({ days: 2, rest: 7, resting: true });
    f = R.toggleFallow(f, at(2026, 11, 17));
    expect(f).toEqual([['2026-11-14', '2026-11-16']]);
    expect(R.monthDays(items, now, f)).toMatchObject({ rest: 3, resting: false });
    R.writeFallow(f);
    expect(R.readFallow()).toEqual(f);
  });
});

describe('0922 / 0155 周记', () => {
  it('只在周日 / 周一出；统计这 7 天', async () => {
    const R = await import('../lib/review');
    expect(R.weekKey(at(2026, 11, 4))).toBeNull(); // 周三
    expect(R.weekKey(at(2026, 11, 8))).toBe('2026-11-08'); // 周日
    expect(R.weekKey(at(2026, 11, 9))).toBe('2026-11-08'); // 周一看的还是上周日那张
    const items = [mk({ createdAt: at(2026, 11, 3), tags: ['雾'], why: '好' }), mk({ createdAt: at(2026, 11, 6), tags: ['雾'] }), mk({ createdAt: at(2026, 10, 20), tags: ['旧'] }), mk({ createdAt: at(2026, 11, 7), sample: 1 })];
    const w = R.weekNote(items, at(2026, 11, 8, 21));
    expect(w).toMatchObject({ n: 2, tag: '雾', noWhy: 1 });
  });
});

describe('ROADMAP v0.37 月度麦捆 / 一年的麦田 + 0925 被遗忘的好东西', () => {
  it('每月 1–7 号看上个月；数字和热力图同一个口径', async () => {
    const R = await import('../lib/review');
    const { buildHeatmap } = await import('../lib/heatmap');
    expect(R.sheafMonth(at(2026, 12, 3))).toEqual([2026, 10]);
    expect(R.sheafMonth(at(2027, 1, 1))).toEqual([2026, 11]);
    expect(R.sheafMonth(at(2026, 12, 8))).toBeNull();
    const items = [
      mk({ createdAt: at(2026, 11, 2, 23) }),
      mk({ createdAt: at(2026, 11, 2, 23) }),
      mk({ createdAt: at(2026, 11, 5, 9) }),
      mk({ createdAt: at(2026, 12, 1, 9) }),
      mk({ createdAt: at(2026, 11, 6), locked: 1 }),
      mk({ createdAt: at(2026, 11, 6), polarity: -1 }),
    ];
    const devs = [
      { id: 1, itemIds: [], jump: 0, source: 'offline', idea: { title: '《像》', bridge: '', idea: '', cliches: [], nearest: { sim: 0.8, method: 'text' } }, createdAt: at(2026, 11, 10) },
      { id: 2, itemIds: [], jump: 0, source: 'offline', idea: { title: '《远》', bridge: '', idea: '', cliches: [], nearest: { sim: 0.2, method: 'text' } }, createdAt: at(2026, 11, 11) },
    ] as Development[];
    const field = R.fieldItems(items);
    const s = R.sheaf(field, devs, 2026, 10);
    expect(s).toMatchObject({ n: 3, days: 2, peak: '深夜', branches: 2 });
    expect(s.odd!.idea.title).toBe('《远》');
    const h = buildHeatmap(field, at(2026, 11, 30));
    const nov = h.cells.filter((c) => c.key.startsWith('2026-11'));
    expect(nov.reduce((a, c) => a + c.count, 0)).toBe(s.n);
    expect(nov.filter((c) => c.count).length).toBe(s.days);
    expect(R.yearField(field, devs, 2026)).toMatchObject({ n: 4, branches: 2 });
  });
  it('被遗忘的：半年以上没碰、没嫁接过、没放下；同一个月看到的一样', async () => {
    const R = await import('../lib/review');
    const now = at(2026, 11, 3);
    const old = at(2026, 1, 10);
    const items = [
      mk({ uid: 'a', createdAt: old }),
      mk({ uid: 'b', createdAt: old, touchedAt: at(2026, 10, 1) }),
      mk({ uid: 'c', createdAt: old, graftCount: 1 }),
      mk({ uid: 'd', createdAt: old, down: at(2026, 3, 1) }),
      mk({ uid: 'e', createdAt: old }),
      mk({ uid: 'f', createdAt: at(2026, 10, 1) }),
    ];
    const got = R.forgotten(items, [], now).map((x) => x.uid).sort();
    expect(got).toEqual(['a', 'e']);
    expect(R.forgotten(items, [], now + 3 * DAY).map((x) => x.uid)).toEqual(R.forgotten(items, [], now).map((x) => x.uid));
  });
});

describe('0938 放下 + 0131 / 0915 再看一句', () => {
  it('放下的不进默认穗仓和每日一穗；masked 连「再看」一起挡', async () => {
    const { inLibrary } = await import('../lib/db');
    const { dailyPool } = await import('../lib/daily');
    const { masked } = await import('../lib/lock');
    expect(inLibrary({ createdAt: 1, down: 5 }, 10, false)).toBe(false);
    expect(inLibrary({ createdAt: 1 }, 10, false)).toBe(true);
    const pool = dailyPool([mk({ down: 1 }), mk(), mk(), mk(), mk()]);
    expect(pool.length).toBe(4);
    expect(pool.some((x) => x.down)).toBe(false);
    expect(masked(mk({ locked: 1, revisits: [{ text: '秘密', at: 1 }] })).revisits).toBeUndefined();
  });
  it('仓储层：再看只追加、满一年那句带 y；放下 / 拿回来', async () => {
    const { db, addItem } = await import('../lib/db');
    const repo = await import('../lib/repo');
    const R = await import('../lib/review');
    const id = await addItem({ type: 'film', title: '花样年华', why: '旗袍和走廊', tags: [] }, db, { createdAt: Date.now() - 400 * DAY });
    let it = (await db.items.get(id))!;
    expect(R.yearDue(it)).toBe(true);
    await repo.addRevisit(id, it.revisits, '现在只记得雨', true);
    it = (await db.items.get(id))!;
    await repo.addRevisit(id, it.revisits, '又看了一遍');
    it = (await db.items.get(id))!;
    expect(it.why).toBe('旗袍和走廊');
    expect(it.revisits!.map((r) => [r.text, !!r.y])).toEqual([['现在只记得雨', true], ['又看了一遍', false]]);
    expect(R.yearDue(it)).toBe(false);
    expect(R.changedMind([it])).toBe(1);
    await repo.setDown([id], true);
    expect((await db.items.get(id))!.down).toBeGreaterThan(0);
    await repo.setDown([id], false);
    expect((await db.items.get(id))!.down).toBeUndefined();
  }, 20000);
});

describe('ROADMAP v0.35 口味会说话 + 0919 一年前的我 + 0926 田埂', () => {
  it('近 30 天 vs 前 30 天：升 / 淡；一年前那年 vs 最近一年：留下 / 新来 / 不见', async () => {
    const R = await import('../lib/review');
    const now = at(2026, 11, 3);
    const items: Item[] = [];
    for (let i = 0; i < 4; i++) items.push(mk({ type: 'music', tags: ['夜路'], createdAt: now - (i + 1) * DAY }));
    for (let i = 0; i < 3; i++) items.push(mk({ tags: ['海'], createdAt: now - (40 + i) * DAY }));
    for (let i = 0; i < 6; i++) items.push(mk({ tags: ['夜路', '旧城'], createdAt: now - (400 + i) * DAY }));
    const t = R.tasteTalk(items, now);
    expect(t.up[0]).toEqual(['夜路', 4]);
    expect(t.fade).toEqual(['海']);
    expect(t.line).toBe('最近 30 天拾了 4 穗，音乐最多；夜路在升，海淡了。');
    expect(t.year).toEqual({ kept: ['夜路'], fresh: ['海'], gone: ['旧城'] });
    expect(R.tasteTalk([], now).line).toBe('最近 30 天还没拾。');
  });
  it('田埂只记第一次，按时间排；示例 / 上锁的不算', async () => {
    const R = await import('../lib/review');
    const a = mk({ type: 'music', createdAt: at(2026, 3, 1) });
    const b = mk({ type: 'image', createdAt: at(2026, 3, 2), revisits: [{ text: 'x', at: at(2026, 10, 1), y: 1 }] });
    const s = mk({ createdAt: at(2025, 1, 1), sample: 1 });
    const devs = [
      { id: 1, itemIds: [a.id!], jump: 0, source: 'offline', idea: { title: '一', bridge: '', idea: '', cliches: [] }, createdAt: at(2026, 4, 1) },
      { id: 2, itemIds: [a.id!, b.id!], jump: 0, source: 'offline', idea: { title: '二', bridge: '', idea: '', cliches: [] }, createdAt: at(2026, 5, 1), status: 'done', statusAt: at(2026, 6, 1) },
    ] as Development[];
    const f = R.firsts([a, b, s], devs, [{ title: '短片', form: 'film', stage: 'idea', devUids: [], itemUids: [], draft: '', todos: [], createdAt: at(2026, 7, 1) }]);
    expect(f.map((x) => x.k)).toEqual(['item', 'graft', 'cross', 'done', 'work', 'year']);
    expect(f[0].item).toBe(a);
  });
});
