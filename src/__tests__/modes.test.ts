import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { exportAll, importAll, LinganDB, markGrafted } from '../lib/db';
import { buildConvergePrompt, buildMapPrompt, graftOffline, TRANSFORMS } from '../lib/graft';
import { drawForMode, graftCount, graftStatsFromDevs, lowestTier, MODES, modeBrief, vibeOf, vibeOpposition, vibeWords, type GraftMode } from '../lib/modes';
import { mulberry32, similarity } from '../lib/similarity';
import type { Item, ItemType } from '../lib/types';

let nid = 0;
function mk(p: Partial<Item> & { title: string }): Item {
  nid++;
  return { id: nid, type: 'idea', tags: [], createdAt: 1_700_000_000_000 + nid * 1000, updatedAt: 0, ...p };
}

// 两簇：海边 / 城市夜里，各 6 件
const sea = ['海边的风', '海浪拍岸', '海边灯塔', '海边贝壳', '海边日出', '海边渔船'].map((t) => mk({ title: t, tags: ['海', '海边', '夏天'], type: 'image', content: t + ' 海边 夏天 阳光' }));
const city = ['地铁末班车', '地铁口霓虹', '地铁站台', '地铁广告', '地铁扶梯', '地铁隧道'].map((t) => mk({ title: t, tags: ['地铁', '城市', '夜'], type: 'music', content: t + ' 地铁 城市 夜里' }));
const LIB = [...sea, ...city];
const seaIds = new Set(sea.map((s) => s.id));

describe('v0.18 五种接法：抽样规则', () => {
  it('有五种接法，每种都写了抽样规则和给模型的要求', () => {
    expect(MODES.map((m) => m.name)).toEqual(['相近', '远距', '被冷落', '跨媒介', '反氛围']);
    for (const m of MODES) {
      expect(m.rule.length).toBeGreaterThan(10);
      expect(m.ask.length).toBeGreaterThan(10);
      expect(TRANSFORMS.some((t) => t.id === m.transform)).toBe(true);
    }
  });

  it('相近：同一簇里抽（起点在哪簇，其余就在哪簇）', () => {
    for (let s = 1; s <= 30; s++) {
      const r = drawForMode('near', LIB, 4, { rand: mulberry32(s) }).items;
      expect(r).toHaveLength(4);
      const inSea = r.map((x) => seaIds.has(x.id));
      expect(new Set(inSea).size).toBe(1);
    }
  });

  it('远距：每一穗都从「与已选平均最不相像」的前三里来，两簇都会被抽到', () => {
    for (let s = 1; s <= 30; s++) {
      const r = drawForMode('far', LIB, 3, { rand: mulberry32(s) }).items;
      expect(new Set(r.map((x) => seaIds.has(x.id))).size).toBe(2);
      // 第二穗一定在离起点最远的前三里
      const rest = LIB.filter((x) => x !== r[0]).sort((a, b) => similarity(a, r[0]) - similarity(b, r[0]));
      expect(rest.slice(0, 3).map((x) => x.id)).toContain(r[1].id);
    }
    // 平均相似度：远距明显低于相近
    const avg = (g: Item[]) => {
      let s = 0;
      let n = 0;
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) (s += similarity(g[i], g[j])), n++;
      return s / n;
    };
    const near = drawForMode('near', LIB, 4, { rand: mulberry32(7) }).items;
    const far = drawForMode('far', LIB, 4, { rand: mulberry32(7) }).items;
    expect(avg(far)).toBeLessThan(avg(near));
  });

  it('被冷落：抽到的穗嫁接次数都在全库最低档（比门槛少的全部抽到，其余不超过门槛）', () => {
    const counts = [3, 0, 2, 0, 5, 1, 1, 0, 4, 2, 1, 6];
    const lib = LIB.map((x, i) => ({ ...x, graftCount: counts[i], graftedAt: counts[i] ? 1000 + i : undefined }));
    for (const n of [3, 4, 5]) {
      const th = lowestTier(lib, n);
      for (let s = 1; s <= 20; s++) {
        const r = drawForMode('neglected', lib, n, { rand: mulberry32(s) }).items;
        expect(r).toHaveLength(n);
        expect(Math.max(...r.map(graftCount))).toBeLessThanOrEqual(th);
        const below = lib.filter((x) => graftCount(x) < th).map((x) => x.id);
        for (const id of below) expect(r.map((x) => x.id)).toContain(id);
      }
    }
    // 3 件从没接过 → n=3 时三件都是 0
    const r3 = drawForMode('neglected', lib, 3, { rand: mulberry32(1) }).items;
    expect(r3.map(graftCount)).toEqual([0, 0, 0]);
  });

  it('被冷落：同一档里先抽从没接过的，再抽最久没接的；全是 0 时每次不一样', () => {
    const lib: Item[] = LIB.map((x, i) => ({ ...x, graftCount: 1, graftedAt: 5000 + i }));
    lib[4] = { ...lib[4], graftCount: 0, graftedAt: undefined };
    lib[9] = { ...lib[9], graftedAt: 10 }; // 最久没接
    lib[2] = { ...lib[2], graftedAt: 20 };
    const r = drawForMode('neglected', lib, 3, { rand: mulberry32(3) }).items.map((x) => x.id);
    expect(r).toEqual([lib[4].id, lib[9].id, lib[2].id]);
    const zero = LIB.map((x) => ({ ...x, graftCount: 0 }));
    const seen = new Set<string>();
    for (let s = 1; s <= 10; s++) seen.add(drawForMode('neglected', zero, 3, { rand: mulberry32(s) }).items.map((x) => x.id).sort().join(','));
    expect(seen.size).toBeGreaterThan(3);
  });

  it('被冷落：换一穗（保留其余）仍只从剩下的最低档里补', () => {
    const counts = [0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2];
    const lib = LIB.map((x, i) => ({ ...x, graftCount: counts[i] }));
    const keep = [lib[0], lib[1]];
    const r = drawForMode('neglected', lib, 3, { keep, exclude: [lib[2].id!], rand: mulberry32(1) }).items;
    expect(r.slice(0, 2)).toEqual(keep);
    expect(r[2].id).toBe(lib[3].id);
  });

  it('跨媒介：库里类型够时每组至少 3 种类型；不够时给提示', () => {
    const types: ItemType[] = ['music', 'music', 'music', 'film', 'image', 'image', 'image', 'image', 'text', 'idea', 'idea', 'idea'];
    const lib = LIB.map((x, i) => ({ ...x, type: types[i] }));
    for (const n of [3, 4, 5]) {
      for (let s = 1; s <= 25; s++) {
        const r = drawForMode('cross', lib, n, { rand: mulberry32(s) });
        expect(r.items).toHaveLength(n);
        expect(new Set(r.items.map((x) => x.type)).size).toBeGreaterThanOrEqual(3);
        expect(r.note).toBeUndefined();
      }
    }
    // 只有 1 件电影也会被抽进来（类型优先）
    const film = lib.find((x) => x.type === 'film')!;
    let hits = 0;
    for (let s = 1; s <= 25; s++) if (drawForMode('cross', lib, 5, { rand: mulberry32(s) }).items.includes(film)) hits++;
    expect(hits).toBe(25);
    // 换一穗：剩下两穗类型不同，补上的是第三种
    const keep = [lib[0], lib[4]]; // 音乐 + 图片
    const r = drawForMode('cross', lib, 3, { keep, exclude: [lib[8].id!], rand: mulberry32(2) }).items;
    expect(new Set(r.map((x) => x.type)).size).toBe(3);
    // 库里只有两种类型
    const two = drawForMode('cross', LIB, 3, { rand: mulberry32(1) });
    expect(two.note).toMatch(/只有 2 种类型/);
    expect(two.libTypes).toBe(2);
    expect(new Set(two.items.map((x) => x.type)).size).toBe(2);
  });

  it('反氛围：第一穗做锚，其余按与锚的氛围相反优先', () => {
    const quiet = mk({ title: '凌晨的雾', content: '安静 雾 慢 留白', tags: ['安静'] });
    const loud = mk({ title: '夏日音乐节', content: '热闹 人群 摇滚 阳光', tags: ['派对'] });
    const mid = mk({ title: '一张表格', content: '数字 表格' });
    const lib = [quiet, loud, mid, ...sea.slice(0, 3)];
    expect(vibeWords(vibeOf(quiet))).toContain('安静');
    expect(vibeOpposition(vibeOf(quiet), vibeOf(loud))).toBeGreaterThan(0);
    const r = drawForMode('anti', lib, 3, { keep: [quiet], rand: mulberry32(1) }).items;
    expect(r[0]).toBe(quiet);
    expect(r[1]).toBe(loud);
    // 不给锚：随机抽一件读得出氛围的做锚，第二件对锚的相反程度是全库最高
    for (let s = 1; s <= 20; s++) {
      const g = drawForMode('anti', [...LIB, quiet, loud, mid], 3, { rand: mulberry32(s) }).items;
      const a = vibeOf(g[0]);
      expect(a.some(Boolean)).toBe(true);
      const best = Math.max(...[...LIB, quiet, loud, mid].filter((x) => x !== g[0]).map((x) => vibeOpposition(a, vibeOf(x))));
      expect(vibeOpposition(a, vibeOf(g[1]))).toBe(best);
    }
  });

  it('穗不够时把能抽的都给出来', () => {
    for (const m of MODES) expect(drawForMode(m.id, LIB.slice(0, 2), 3).items).toHaveLength(2);
  });
});

describe('v0.18 接法进 prompt', () => {
  const group = [sea[0], city[0], mk({ title: '一句台词', type: 'film', content: '安静 雾' })].map((x) => ({ ...x, graftCount: 1 }));
  it.each(MODES.map((m) => m.id))('%s：两次调用的 prompt 都写了接法和抽样规则', (mode) => {
    const m = MODES.find((x) => x.id === mode)!;
    const p1 = buildMapPrompt(group, { oblique: '做减法', mode });
    expect(p1.user).toContain(`这次的接法：${m.name}`);
    expect(p1.user).toContain(m.rule);
    expect(p1.user).toContain(m.ask);
    expect(p1.system).toContain(`「${m.name}」`);
    const p2 = buildConvergePrompt(group, { oblique: '做减法', mode }, [], []);
    expect(p2.user).toContain(m.rule);
    expect(p2.system).toContain(`「${m.name}」`);
  });
  it('各接法的具体情况：被冷落写次数，跨媒介写几种媒介，反氛围写锚的氛围', () => {
    expect(modeBrief('neglected', group)).toMatch(new RegExp(`#${group[0].id} 1 次`));
    expect(modeBrief('cross', group)).toContain('（3 种）');
    expect(modeBrief('anti', [group[2], group[0]])).toMatch(/锚是 #\d+，它的氛围读起来是「安静/);
    expect(buildMapPrompt(group, { oblique: 'x' }).user).not.toContain('这次的接法');
  });
});

describe('v0.18 离线五种接法', () => {
  const group = [mk({ title: '凌晨的雾', content: '安静 雾', type: 'image' }), mk({ title: '夏日音乐节', content: '热闹 人群', type: 'music' }), mk({ title: '外婆的收音机', type: 'idea', content: '旧 收音机' }), mk({ title: '一一', type: 'film' })];
  it.each(MODES.map((m) => m.id))('%s：离线照样四步三枝，带接法、溯源 ≥3 穗', (mode) => {
    const r = graftOffline(group, { mode: mode as GraftMode, rand: mulberry32(5) });
    const m = MODES.find((x) => x.id === mode)!;
    expect(r.mode).toBe(mode);
    expect(r.branches).toHaveLength(3);
    expect(r.tensions).toHaveLength(4);
    expect(new Set(r.branches.map((b) => b.transform)).size).toBe(3);
    expect(r.branches[0].transform).toBe(m.transform);
    for (const b of r.branches) {
      expect(b.refs!.length).toBeGreaterThanOrEqual(3);
      expect(b.evidence).toBe('ok');
      expect(b.idea).toContain(`接法「${m.name}」`);
    }
  });
  it('反氛围的离线张力点出锚的氛围与反面；跨媒介写出几种媒介', () => {
    expect(graftOffline(group, { mode: 'anti', rand: mulberry32(1) }).tensions[0].text).toMatch(/「安静」的，把它的反面「热闹」接上去/);
    expect(graftOffline(group, { mode: 'cross', rand: mulberry32(1) }).tensions[0].text).toMatch(/^4 种媒介/);
    expect(graftOffline(group, { mode: 'neglected', rand: mulberry32(1) }).tensions[0].text).toContain('0 次');
  });
  it('不带接法时与之前一样', () => {
    const r = graftOffline(group, { rand: mulberry32(5) });
    expect(r.mode).toBeUndefined();
    expect(r.branches.every((b) => !b.idea.includes('接法「'))).toBe(true);
  });
});

describe('v0.18 嫁接次数', () => {
  it('同一批三根算一次，旧的单根新枝每根算一次', () => {
    const st = graftStatsFromDevs([
      { id: 1, itemIds: [1, 2], createdAt: 100 },
      { id: 2, itemIds: [1, 2, 3], createdAt: 200, batch: { id: 'g1' } },
      { id: 3, itemIds: [1, 2, 3], createdAt: 201, batch: { id: 'g1' } },
      { id: 4, itemIds: [1, 2, 3], createdAt: 202, batch: { id: 'g1' } },
      { id: 5, itemIds: [3, -1, 4], createdAt: 300, batch: { id: 'g2' } },
    ]);
    expect(st.get(1)).toEqual({ count: 2, last: 202 });
    expect(st.get(3)).toEqual({ count: 2, last: 300 });
    expect(st.get(4)).toEqual({ count: 1, last: 300 });
    expect(st.has(-1)).toBe(false);
  });

  it('Dexie version 6 迁移：旧穗补 0，旧新枝的来源回填次数和最后时间', async () => {
    const name = 'mode-mig-' + Math.random().toString(36).slice(2);
    const v5 = new Dexie(name);
    v5.version(1).stores({ items: '++id, type, createdAt, updatedAt, *tags', developments: '++id, createdAt, starred' });
    v5.version(2).stores({ developments: '++id, createdAt, starred, evidence' });
    v5.version(3).stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo', images: '&itemId' });
    v5.version(4).stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt', daily: '&day' });
    v5.version(5).stores({ ftidx: '&key, kind' });
    await v5.open();
    for (let i = 1; i <= 4; i++) await v5.table('items').add({ id: i, type: 'idea', title: '旧' + i, tags: [], createdAt: i, updatedAt: i });
    await v5.table('developments').add({ itemIds: [1, 2], jump: 0.5, idea: { title: 'a', bridge: '', idea: 'a', cliches: [] }, source: 'ai', createdAt: 100 });
    for (let k = 0; k < 3; k++) await v5.table('developments').add({ itemIds: [1, 2, 3], jump: 0.5, idea: { title: 'b' + k, bridge: '', idea: 'b', cliches: [] }, source: 'offline', createdAt: 200 + k, batch: { id: 'gx', index: k, size: 3 } });
    v5.close();
    const d = new LinganDB(name);
    const rows = await d.items.orderBy('id').toArray();
    expect(rows.map((r) => r.graftCount)).toEqual([2, 2, 1, 0]);
    expect(rows.map((r) => r.graftedAt)).toEqual([202, 202, 202, undefined]);
    expect(d.verno).toBe(7); // v0.19 起是 7（套路墙）
    expect(await d.items.where('graftCount').equals(0).count()).toBe(1);
    // 再嫁接一次：次数 +1、记下时间
    await markGrafted([3, 4, 4], d, 9999);
    const after = await d.items.orderBy('id').toArray();
    expect(after.map((r) => r.graftCount)).toEqual([2, 2, 2, 1]);
    expect(after[3].graftedAt).toBe(9999);
    expect(after[3].touchedAt).toBe(9999);
    expect(after.map((r) => r.title)).toEqual(['旧1', '旧2', '旧3', '旧4']);
    d.close();
  });

  it('导入旧备份（没有次数）时按一起导入的新枝回填；新备份原样保留', async () => {
    const d = new LinganDB('mode-imp-' + Math.random().toString(36).slice(2));
    const res = await importAll(
      {
        app: 'lingan',
        version: 1,
        exportedAt: 1,
        items: [1, 2, 3, 4].map((i) => ({ id: 50 + i, type: 'idea', title: 't' + i, tags: [], createdAt: i, updatedAt: i })),
        developments: [{ itemIds: [51, 52, 53], jump: 0.5, idea: { title: 'x', bridge: '', idea: 'x', cliches: [] }, source: 'offline', createdAt: 77, batch: { id: 'b', index: 0, size: 1 } }],
      },
      d,
    );
    expect(res.items).toBe(4);
    const rows = await d.items.orderBy('id').toArray();
    expect(rows.map((r) => r.graftCount)).toEqual([1, 1, 1, 0]);
    expect(rows[0].graftedAt).toBe(77);
    const bk = await exportAll(d);
    expect(bk.items[0].graftCount).toBe(1);
    const d2 = new LinganDB('mode-imp2-' + Math.random().toString(36).slice(2));
    await importAll({ ...bk, items: bk.items.map((x) => ({ ...x, graftCount: 9 })), developments: [] }, d2);
    expect((await d2.items.toArray()).every((r) => r.graftCount === 9)).toBe(true);
    d.close();
    d2.close();
  });
});
