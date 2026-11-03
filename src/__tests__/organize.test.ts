// v0.23 待理与补为什么：待理（0101）、缺为什么（0102）、标签别名合并（0103）、AI 标签只从词汇里选（0110）、搜索语法（0111）、
// 三秒整理计数（0115）、合并保留两次为什么（0126）、提示问题（0146）、标签体检（0147）、共现推荐（0148）、整理度（0160）、
// 这穗收过了（ROADMAP v0.31）、一次整理一把（ROADMAP v0.40）。
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LinganDB, addItem, backfillImageDup, ensureImageDup, findDupes, inLibrary, inboxEnabled, keepAllInbox, keepItems, mergeInto, normalizeTags, reInbox, setInboxEnabled, trashItems } from '../lib/db';
import { canonicalUrl, dupKeys, dupReason, mergedPatch, textKey } from '../lib/dupe';
import { cooccur, editDistance, organizeStats, rewriteTags, splitSuggested, tagHealth, whyPrompts, whyQueue, bumpSorted, sortedToday, WHY_PROMPTS } from '../lib/organize';
import { completeSyntax, dateSpan, matchFilters, parseSyntax, typeOf } from '../lib/qsyntax';
import { _resetAliasCache, addAliases, loadAliases, resolveTag, saveAliases } from '../lib/tagalias';
import { acceptSugg, addTagsTo, dropSugg, mergeTags, removeTagFrom, restoreTypes, setTypeOf, setWhy } from '../lib/batch';
import type { Item } from '../lib/types';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
const DAY = 86400000;
const NOW = new Date(2026, 10, 3, 12).getTime();
// 1×1 的两张不同小图
const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = memStorage();
  _resetAliasCache();
});
afterEach(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  _resetAliasCache();
});

const base = (o: Partial<Item>) => ({ type: 'idea' as const, title: '', tags: [] as string[], ...o });

describe('0101 待理', () => {
  it('带 inbox 收进来的进待理；不带的（展开速记填好再存）直接进穗仓', async () => {
    const d = new LinganDB(uniq('inbox'));
    const a = await addItem(base({ title: '速记一句' }), d, { inbox: true });
    const b = await addItem(base({ title: '填好的' }), d);
    expect((await d.items.get(a))!.inbox).toBe(1);
    expect((await d.items.get(b))!.inbox).toBeUndefined();
    expect(await d.items.where('inbox').equals(1).count()).toBe(1);
  });
  it('穗仓只显示整理过的或超过 7 天的；关掉待理全显示', () => {
    expect(inLibrary({ createdAt: NOW }, NOW, true)).toBe(true);
    expect(inLibrary({ inbox: 1, createdAt: NOW - 2 * DAY }, NOW, true)).toBe(false);
    expect(inLibrary({ inbox: 1, createdAt: NOW - 8 * DAY }, NOW, true)).toBe(true);
    expect(inLibrary({ inbox: 1, createdAt: NOW }, NOW, false)).toBe(true);
  });
  it('设置里关掉：新穗不进待理', async () => {
    expect(inboxEnabled()).toBe(true);
    setInboxEnabled(false);
    expect(inboxEnabled()).toBe(false);
    const d = new LinganDB(uniq('inbox-off'));
    const id = await addItem(base({ title: '关掉待理时' }), d, { inbox: true });
    expect((await d.items.get(id))!.inbox).toBeUndefined();
    setInboxEnabled(true);
    expect(inboxEnabled()).toBe(true);
  });
  it('留下 / 一键全部入仓 / 撤销', async () => {
    const d = new LinganDB(uniq('inbox-keep'));
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await addItem(base({ title: '待理' + i }), d, { inbox: true }));
    expect(await keepItems([ids[0]], d)).toBe(1);
    expect((await d.items.get(ids[0]))!.inbox).toBeUndefined();
    const all = await keepAllInbox(d);
    expect(all.sort()).toEqual(ids.slice(1).sort());
    expect(await d.items.where('inbox').equals(1).count()).toBe(0);
    await reInbox(all, d);
    expect(await d.items.where('inbox').equals(1).count()).toBe(3);
  });
  it('「留下」不算修改内容：updatedAt 不变也行，但 inbox 一定没了；补为什么 = 整理过', async () => {
    const d = new LinganDB(uniq('inbox-why'));
    const id = await addItem(base({ title: '补一句就出待理' }), d, { inbox: true });
    await setWhy(id, '  因为安静  ', d);
    const it = (await d.items.get(id))!;
    expect(it.why).toBe('因为安静');
    expect(it.inbox).toBeUndefined();
  });
});

describe('0102 缺为什么 + 0146 提示问题', () => {
  const rows = [
    { id: 1, createdAt: 10, why: '' },
    { id: 2, createdAt: 30 },
    { id: 3, createdAt: 20, why: '有了' },
    { id: 4, createdAt: 40, sample: 1 as const },
    { id: 5, createdAt: 50, deletedAt: 9 },
    { id: 6, createdAt: 60, why: '   ' },
  ];
  it('只列没写为什么的（不含示例、回收站），最近的在前；跳过的排到最后', () => {
    expect(whyQueue(rows).map((x) => x.id)).toEqual([6, 2, 1]);
    expect(whyQueue(rows, new Set([6])).map((x) => x.id)).toEqual([2, 1, 6]);
    expect(whyQueue(rows, new Set([6, 2, 1])).map((x) => x.id)).toEqual([6, 2, 1]);
  });
  it('每种类型都有提示问题，轮换给 3 个，点了给半句开头', () => {
    for (const t of Object.keys(WHY_PROMPTS) as Array<keyof typeof WHY_PROMPTS>) {
      const p = whyPrompts(t, 7);
      expect(p.length).toBe(3);
      expect(p.every((x) => x.q.endsWith('？'))).toBe(true);
    }
    expect(whyPrompts('film', 0)[0].q).not.toBe(whyPrompts('film', 1)[0].q);
  });
});

describe('0103 标签别名与合并', () => {
  it('别名表：链式解析、合并时旧别名改指新正名', () => {
    let m = addAliases(['夜晚', 'night'], '夜', {});
    expect(resolveTag('Night', m)).toBe('夜');
    m = addAliases(['夜'], '深夜', m);
    expect(resolveTag('夜晚', m)).toBe('深夜');
    expect(resolveTag('深夜', m)).toBe('深夜');
  });
  it('mergeTags：旧穗改写、去重，以后输入别名自动写成正名', async () => {
    const d = new LinganDB(uniq('tags'));
    const a = await addItem(base({ title: 'a', tags: ['夜晚', '雨'] }), d);
    const b = await addItem(base({ title: 'b', tags: ['night', '夜'] }), d);
    const c = await addItem(base({ title: 'c', tags: ['雨'] }), d);
    expect(await mergeTags(['夜晚', 'night'], '夜', d)).toBe(2);
    expect((await d.items.get(a))!.tags).toEqual(['夜', '雨']);
    expect((await d.items.get(b))!.tags).toEqual(['夜']);
    expect((await d.items.get(c))!.tags).toEqual(['雨']);
    expect(loadAliases()).toMatchObject({ 夜晚: '夜', night: '夜' });
    expect(normalizeTags('NIGHT 夜晚 城市')).toEqual(['夜', '城市']);
  });
  it('rewriteTags 保持顺序、没变返回 null', () => {
    expect(rewriteTags(['a', 'b', 'c'], ['b'], 'a')).toEqual(['a', 'c']);
    expect(rewriteTags(['x'], ['b'], 'a')).toBeNull();
  });
  it('别名存本机，重新读也在', () => {
    saveAliases({ 晚上: '夜' });
    _resetAliasCache();
    expect(loadAliases()).toEqual({ 晚上: '夜' });
  });
});

describe('0110 AI 标签只从已有词汇里选', () => {
  it('已有的直接用（大小写不敏感，用你的写法），新词留给你点头，泛词丢掉', () => {
    const r = splitSuggested(['夜', 'Neon', '氛围感', '窗', '治愈', '窗'], ['夜', 'neon', '雨'], ['套路词']);
    expect(r.known).toEqual(['夜', 'neon']);
    expect(r.fresh).toEqual(['窗']);
  });
  it('点头 = 加进标签，摇头 = 不要', async () => {
    const d = new LinganDB(uniq('sugg'));
    const id = await addItem(base({ title: 's', tags: ['雨'] }), d);
    await d.items.update(id, { tagSugg: ['窗', '门'] });
    await acceptSugg(id, '窗', d);
    let it = (await d.items.get(id))!;
    expect(it.tags).toEqual(['雨', '窗']);
    expect(it.tagSugg).toEqual(['门']);
    await dropSugg(id, '门', d);
    it = (await d.items.get(id))!;
    expect(it.tagSugg).toBeUndefined();
  });
});

describe('0148 共现推荐 + 0147 标签体检 + 0160 整理度', () => {
  const items = [
    { tags: ['雨', '城市', '蓝'], createdAt: NOW },
    { tags: ['雨', '城市'], createdAt: NOW },
    { tags: ['雨', '蓝'], createdAt: NOW },
    { tags: ['雨', '夜'], createdAt: NOW - 300 * DAY },
    { tags: ['夜晚'], createdAt: NOW - 300 * DAY },
    { tags: ['夜'], createdAt: NOW - 250 * DAY },
    { tags: ['Neon'], createdAt: NOW },
    { tags: ['neon'], createdAt: NOW },
  ];
  it('打了「雨」推荐常一起出现的（至少 2 次）', () => {
    expect(cooccur(items, ['雨'])).toEqual(['城市', '蓝']);
    expect(cooccur(items, [])).toEqual([]);
  });
  it('体检：只用过一次、写法很近、半年没用', () => {
    const h = tagHealth(items, NOW);
    expect(h.once).toContain('夜晚');
    expect(h.near.some(([a, b]) => (a === '夜' && b === '夜晚') || (a === '夜晚' && b === '夜'))).toBe(true);
    expect(h.near.some(([a, b]) => [a, b].sort().join() === ['Neon', 'neon'].sort().join())).toBe(true);
    expect(h.stale).toContain('夜');
    expect(editDistance('kitten', 'sitten')).toBe(1);
  });
  it('整理度是真实计数（不含示例、回收站）', () => {
    expect(organizeStats([{ why: '有', tags: ['a'] }, { tags: [], inbox: 1 }, { why: 'x', tags: [], sample: 1 }, { why: 'y', tags: ['b'], deletedAt: 1 }])).toEqual({ total: 2, withWhy: 1, withTags: 1, inbox: 1 });
  });
  it('0115 今天理了几穗：按天计', () => {
    expect(sortedToday(NOW)).toBe(0);
    bumpSorted(2, NOW);
    expect(bumpSorted(1, NOW)).toBe(3);
    expect(sortedToday(NOW + DAY)).toBe(0);
  });
});

describe('ROADMAP v0.31 这穗收过了', () => {
  it('同一链接带不同追踪参数认得出；不同 id 不算', () => {
    const a = canonicalUrl('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1007&vd_source=abc');
    expect(a).toBe(canonicalUrl('https://m.bilibili.com/video/BV1xx411c7mD?share_source=copy_web&utm_medium=x'));
    expect(canonicalUrl('https://y.music.163.com/m/song?id=123&uct2=x&utm_source=w')).not.toBe(canonicalUrl('https://y.music.163.com/m/song?id=124'));
    expect(canonicalUrl('https://music.163.com/#/song?id=5&from=qq')).toBe(canonicalUrl('https://music.163.com/#/song?id=5'));
    expect(canonicalUrl('not a url')).toBe('');
  });
  it('几乎一样的文字：忽略标点、空格、全半角、大小写；太短不算', () => {
    expect(textKey('「少年不识愁滋味，爱上层楼。」')).toBe(textKey('少年不识愁滋味 爱上层楼'));
    expect(textKey('ＡＢＣ　def ghi')).toBe(textKey('abc,def,ghi'));
    expect(textKey('短')).toBe('');
  });
  it('同一张图收两次，第二次找得到第一次（原图 SHA-256）；不同的图不算', async () => {
    const d = new LinganDB(uniq('dup-img'));
    const a = await addItem(base({ type: 'image', title: '图一', image: PNG_A }), d);
    const b = await addItem(base({ type: 'image', title: '换了个标题', image: PNG_A }), d, { inbox: true });
    const c = await addItem(base({ type: 'image', title: '图二', image: PNG_B }), d);
    const dupes = await findDupes(b, d);
    expect(dupes.map((x) => x.id)).toEqual([a]);
    expect(dupReason((await d.items.get(b))!.dup, dupes[0].dup)).toBe('同一张图');
    expect(await findDupes(c, d)).toEqual([]);
  });
  it('同链接 + 文字：建索引查得到；回收站和示例里的不算', async () => {
    const d = new LinganDB(uniq('dup-url'));
    const a = await addItem(base({ type: 'link', title: '文章', url: 'https://example.com/post/1?utm_source=wx' }), d);
    const b = await addItem(base({ type: 'link', title: '同一篇', url: 'https://example.com/post/1/' }), d);
    expect((await findDupes(b, d)).map((x) => x.id)).toEqual([a]);
    const t1 = await addItem(base({ type: 'text', title: 'x', content: '人生若只如初见，何事秋风悲画扇' }), d);
    const t2 = await addItem(base({ type: 'text', title: 'y', content: '人生若只如初见 何事秋风悲画扇。' }), d);
    expect((await findDupes(t2, d)).map((x) => x.id)).toEqual([t1]);
    await trashItems([t1], d);
    expect(await findDupes(t2, d)).toEqual([]);
  });
  it('改了链接，重复钥匙跟着换', async () => {
    const d = new LinganDB(uniq('dup-edit'));
    const a = await addItem(base({ type: 'link', title: 'a', url: 'https://a.com/x' }), d);
    const b = await addItem(base({ type: 'link', title: 'b', url: 'https://b.com/y' }), d);
    expect(await findDupes(b, d)).toEqual([]);
    await d.items.update(b, { url: 'https://a.com/x?utm_campaign=1' });
    expect((await findDupes(b, d)).map((x) => x.id)).toEqual([a]);
  });
  it('0126 合并：留旧的，标签并集、两次的为什么都留、时间取更早，新的进回收站', async () => {
    const d = new LinganDB(uniq('dup-merge'));
    const a = await addItem(base({ type: 'film', title: '花样年华', creator: '王家卫', why: '旗袍', tags: ['香港'] }), d);
    const b = await addItem(base({ type: 'film', title: '花样年华', creator: '王家卫', why: '那首歌', tags: ['香港', '雨'], year: '2000' }), d);
    expect((await findDupes(b, d)).map((x) => x.id)).toEqual([a]);
    await mergeInto(a, b, d);
    const keep = (await d.items.get(a))!;
    expect(keep.tags).toEqual(['香港', '雨']);
    expect(keep.why).toBe('旗袍 / 那首歌');
    expect(keep.year).toBe('2000');
    expect((await d.items.get(b))!.deletedAt).toBeGreaterThan(0);
    expect(mergedPatch({ ...keep, why: '同' } as Item, { ...keep, why: '同' } as Item).why).toBeUndefined();
  });
  it('老原图在后台补哈希：补完以后也认得出', async () => {
    const d = new LinganDB(uniq('dup-backfill'));
    const a = await addItem(base({ type: 'image', title: 'old', image: PNG_A }), d);
    // 模拟 v0.22 的老穗：没有图片钥匙
    await d.items.update(a, { dup: [] });
    const b = await addItem(base({ type: 'image', title: 'new', image: PNG_A }), d);
    expect(await findDupes(b, d)).toEqual([]);
    let from = 0;
    for (let k = 0; k < 5; k++) {
      const r = await backfillImageDup(d, 6, from);
      if (r.next == null) break;
      from = r.next;
    }
    expect((await findDupes(b, d)).map((x) => x.id)).toEqual([a]);
    expect(dupKeys({ type: 'music', title: '', creator: '', content: '', url: '' })).toEqual([]);
    // 收图时调的整遍补：同样补齐，补过的跳过
    const d2 = new LinganDB(uniq('dup-ensure'));
    const x = await addItem(base({ type: 'image', title: 'x', image: PNG_B }), d2);
    await d2.items.update(x, { dup: [] });
    const y = await addItem(base({ type: 'image', title: 'y', image: PNG_B }), d2);
    await ensureImageDup(d2);
    expect((await findDupes(y, d2)).map((r) => r.id)).toEqual([x]);
  });
});

describe('0111 搜索语法', () => {
  it('拆出 key:value，剩下的照常全文搜；中文冒号、引号、取反都认', () => {
    const p = parseSyntax('雨 type:电影 tag:"夜 车" -from:小红书 why：空 before:2026-10');
    expect(p.text).toBe('雨');
    expect(p.filters).toEqual([
      { key: 'type', value: '电影' },
      { key: 'tag', value: '夜 车' },
      { key: 'from', value: '小红书', neg: true },
      { key: 'why', value: '空' },
      { key: 'before', value: '2026-10' },
    ]);
    expect(parseSyntax('备注:随便 https://a.com').filters).toEqual([]);
    expect(parseSyntax('备注:随便 https://a.com').text).toBe('备注:随便 https://a.com');
  });
  it('各个筛选', () => {
    const it: Parameters<typeof matchFilters>[0] = { type: 'film', tags: ['夜', 'Neon'], year: '1994', source: '小红书', url: 'https://www.douban.com/x', why: '', createdAt: new Date(2026, 8, 15).getTime(), creator: '' };
    const m = (q: string) => matchFilters(it, parseSyntax(q).filters);
    expect(m('type:电影')).toBe(true);
    expect(m('type:film')).toBe(true);
    expect(m('type:音乐')).toBe(false);
    expect(m('tag:neon')).toBe(true);
    expect(m('year:199x')).toBe(true);
    expect(m('year:1990s')).toBe(true);
    expect(m('year:200x')).toBe(false);
    expect(m('from:小红书')).toBe(true);
    expect(m('from:douban')).toBe(true);
    expect(m('-from:小红书')).toBe(false);
    expect(m('why:空')).toBe(true);
    expect(m('why:有')).toBe(false);
    expect(m('before:2026-10')).toBe(true);
    expect(m('after:2026-09')).toBe(false);
    expect(m('after:2026-08')).toBe(true);
    expect(m('inbox:是')).toBe(false);
    expect(m('inbox:否')).toBe(true);
    expect(typeOf('歌')).toBe('music');
    expect(dateSpan('2026')![1] - dateSpan('2026')![0]).toBeGreaterThan(360 * DAY);
  });
  it('输入 key: 时给补全', () => {
    const c = completeSyntax('雨 tag:城', { tags: ['城市', '夜', '城墙'], sources: [] });
    expect(c.map((x) => x.label)).toEqual(['tag:城市', 'tag:城墙']);
    expect(c[0].insert).toBe('雨 tag:城市 ');
    expect(completeSyntax('type:', { tags: [], sources: [] }).length).toBe(6);
    expect(completeSyntax('没有冒号', { tags: [], sources: [] })).toEqual([]);
  });
});

describe('ROADMAP v0.40 一次整理一把', () => {
  it('20 条一次加标签成功，可撤销；改类型可撤销', async () => {
    const d = new LinganDB(uniq('batch'));
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) ids.push(await addItem(base({ title: '穗' + i, tags: i % 2 ? ['已有'] : [] }), d));
    expect(await addTagsTo(ids, ['#毕设'], d)).toBe(20);
    const rows = await d.items.bulkGet(ids);
    expect(rows.every((r) => r!.tags.includes('毕设'))).toBe(true);
    expect(rows[1]!.tags).toEqual(['已有', '毕设']);
    await removeTagFrom(ids, '毕设', d);
    expect((await d.items.bulkGet(ids)).some((r) => r!.tags.includes('毕设'))).toBe(false);
    const prev = await setTypeOf(ids.slice(0, 5), 'film', d);
    expect(prev.length).toBe(5);
    expect((await d.items.get(ids[0]))!.type).toBe('film');
    await restoreTypes(prev, d);
    expect((await d.items.get(ids[0]))!.type).toBe('idea');
  });
});
