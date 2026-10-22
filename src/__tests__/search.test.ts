import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { LinganDB, addItem, clearAll, deleteItem, updateItem } from '../lib/db';
import { FtSync } from '../lib/ftsync';
import { SearchIndex, dateBounds, hitRanges, itemFields, norm, parseQuery, pushRecent, searchDocs, signature, snippet, splitByTerms, toDoc, tokenize } from '../lib/search';
import { splitHits } from '../lib/studio';
import type { Development, Item } from '../lib/types';

let n = 0;
const it0 = (p: Partial<Item>): Item => ({ id: ++n, type: 'idea', title: 't', tags: [], createdAt: n * 1000, updatedAt: 0, ...p });

function indexOf(docs: ReturnType<typeof toDoc>[]) {
  const ix = new SearchIndex();
  for (const d of docs) ix.set(d.key, tokenize(d.fields), d.sig);
  return ix;
}

describe('v0.17 切词', () => {
  it('中文单字 + 相邻二元，英文整词小写，全角转半角', () => {
    const t = tokenize([{ f: 'title', text: '轮渡上的雾 Re: Stacks ＡＢＣ 1999' }]);
    for (const k of ['轮', '轮渡', '渡上', '的雾', '雾', 're', 'stacks', 'abc', '1999']) expect(t).toContain(k);
    expect(t).not.toContain('轮上');
    expect(norm('ＡＢＣ雾')).toBe('abc雾');
  });
  it('查询：中文连续段是短语，英文词是前缀，重复去掉', () => {
    expect(parseQuery(' 雾  stack 雾 ')).toEqual([
      { kind: 'cjk', s: '雾' },
      { kind: 'word', s: 'stack' },
    ]);
    expect(parseQuery('，。 ')).toEqual([]);
  });
  it('签名：内容变了才变', () => {
    const a = itemFields(it0({ title: '雾' }));
    expect(signature(a)).toBe(signature(itemFields(it0({ title: '雾' }))));
    expect(signature(a)).not.toBe(signature(itemFields(it0({ title: '雾', why: '安静' }))));
  });
});

describe('v0.17 搜索与高亮', () => {
  const items = [
    it0({ type: 'image', title: '轮渡上的雾', tags: ['清晨'] }),
    it0({ type: 'music', title: 'Re: Stacks', creator: 'Bon Iver', why: '雪夜木屋亮着的窗', tags: ['冬天', '夜'] }),
    it0({ type: 'film', title: '一一', why: '台北公寓夜里的窗' }),
    it0({ type: 'idea', title: '雾气慢慢散开', content: '晨光里的雾' }),
    it0({ type: 'text', title: '晨', content: '早晨起了大雾' }), // 「晨」和「雾」都在，但「晨雾」不连续
  ];
  const docs = items.map((i) => toDoc('i', i));
  const ix = indexOf(docs);
  const keys = (r: ReturnType<typeof searchDocs>) => r.map((h) => h.doc.ref).sort((a, b) => a - b);

  it('两个汉字必须连着出现：二元候选 + 原文核对，不误命中', () => {
    const r = searchDocs(ix, docs, parseQuery('晨光'));
    expect(keys(r)).toEqual([items[3].id]);
    expect(keys(searchDocs(ix, docs, parseQuery('晨雾')))).toEqual([]);
    expect(keys(searchDocs(ix, docs, parseQuery('雾')))).toEqual([items[0].id, items[3].id, items[4].id]);
  });
  it('英文按词首前缀、大小写不敏感；词中间不算', () => {
    expect(keys(searchDocs(ix, docs, parseQuery('stack')))).toEqual([items[1].id]);
    expect(keys(searchDocs(ix, docs, parseQuery('BON')))).toEqual([items[1].id]);
    expect(keys(searchDocs(ix, docs, parseQuery('tacks')))).toEqual([]);
  });
  it('多个词是「且」：窗 + 夜', () => {
    expect(keys(searchDocs(ix, docs, parseQuery('窗 夜')))).toEqual([items[1].id, items[2].id]);
    expect(keys(searchDocs(ix, docs, parseQuery('窗 stack')))).toEqual([items[1].id]);
  });
  it('标题命中排在前面；记下命中了哪些字段', () => {
    const r = searchDocs(ix, docs, parseQuery('雾'));
    // 只在正文里出现的排最后
    expect(r[r.length - 1].doc.ref).toBe(items[4].id);
    const w = searchDocs(ix, docs, parseQuery('窗'));
    expect(w.find((h) => h.doc.ref === items[1].id)!.fields.map((f) => f.f)).toEqual(['why']);
  });
  it('没有索引 / 索引不全时结果一样（后台建索引期间）', () => {
    for (const q of ['雾', '晨光', 'stack', '窗 夜', '夜里的窗']) {
      const full = keys(searchDocs(ix, docs, parseQuery(q)));
      expect(keys(searchDocs(null, docs, parseQuery(q)))).toEqual(full);
      const half = new SearchIndex();
      for (const d of docs.slice(0, 2)) half.set(d.key, tokenize(d.fields), d.sig);
      expect(keys(searchDocs(half, docs, parseQuery(q)))).toEqual(full);
    }
  });
  it('索引过期（签名不对）的文档也会被直接核对', () => {
    const stale = new SearchIndex();
    for (const d of docs) stale.set(d.key, tokenize(d.fields), d === docs[2] ? 'old' : d.sig);
    stale.set(docs[2].key, [], 'old');
    expect(keys(searchDocs(stale, docs, parseQuery('台北')))).toEqual([items[2].id]);
  });
  it('高亮：多个词各自黑底，英文只亮词首那段', () => {
    expect(splitByTerms('雪夜木屋亮着的窗', parseQuery('窗 雪夜'))).toEqual([
      { t: '雪夜', hit: true },
      { t: '木屋亮着的', hit: false },
      { t: '窗', hit: true },
    ]);
    expect(hitRanges('Re: Stacks restack', parseQuery('stack'))).toEqual([[4, 9]]);
    expect(splitHits('雾里的雾', '雾').map((x) => x.hit)).toEqual([true, false, true]);
  });
  it('片段：长文字截在命中附近', () => {
    const s = snippet('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十窗外的雨一二三四五六七八九十', parseQuery('窗外'), 12);
    expect(s.text.startsWith('…')).toBe(true);
    expect(s.text).toContain('窗外');
  });
  it('新枝也能搜：标题、正文、嫁接点', () => {
    const dv: Development = { id: 7, itemIds: [1, 2, 3], jump: 0.5, source: 'offline', createdAt: 1, idea: { title: '《渡轮上的平山》', idea: '每天同一时刻只拍清晨的雾。', bridge: '重复', cliches: [] } };
    const d = toDoc('b', dv);
    expect(d.key).toBe('b:7');
    expect(searchDocs(null, [d], parseQuery('平山')).length).toBe(1);
    expect(searchDocs(null, [d], parseQuery('清晨的雾')).length).toBe(1);
  });
  it('1000 条里搜两个汉字：计算 < 20ms', () => {
    const words = ['麦田', '黄昏', '旧歌', '慢镜头', '雨', '海边', '便利店', '霓虹', '胶片', '手写', '风', '街角', '老电影', '钢琴', '夏天', '夜车'];
    const many: Item[] = [];
    for (let i = 0; i < 1000; i++) {
      const w1 = words[i % 16];
      const w2 = words[(i * 7) % 16];
      many.push(it0({ title: `${w1}与${w2} · 第 ${i} 穗`, content: `${w1}和${w2}之间有一种说不清的关系，像${words[(i * 3) % 16]}落在${words[(i * 5) % 16]}上。`.repeat(1 + (i % 3)), tags: [w1, w2] }));
    }
    const ds = many.map((i) => toDoc('i', i));
    const mix = indexOf(ds);
    const t0 = performance.now();
    let hits = 0;
    for (let k = 0; k < 20; k++) hits = searchDocs(mix, ds, parseQuery('黄昏')).length;
    const per = (performance.now() - t0) / 20;
    expect(hits).toBe(many.filter((x) => (x.title + x.content + x.tags.join()).includes('黄昏')).length);
    expect(per).toBeLessThan(20);
  });
});

describe('v0.17 筛选与最近搜过', () => {
  it('日期范围：近 7 天含今天，自定的结束日整天都算，反了自动对调', () => {
    const now = new Date(2026, 9, 22, 15).getTime();
    const [a] = dateBounds('7d', now);
    expect(new Date(a).getDate()).toBe(16);
    const [y] = dateBounds('year', now);
    expect(new Date(y).getMonth()).toBe(0);
    const [c1, c2] = dateBounds('custom', now, '2026-10-20', '2026-10-01');
    expect(new Date(c1).getDate()).toBe(1);
    expect(c2).toBe(new Date(2026, 9, 21).getTime());
    expect(dateBounds('all', now)).toEqual([-Infinity, Infinity]);
  });
  it('最近搜过：新的在前、去重、最多 6 个', () => {
    let r: string[] = [];
    for (const q of ['雾', '夜里', '书店', '雾', 'a', 'b', 'c', 'd']) r = pushRecent(r, q);
    expect(r).toEqual(['d', 'c', 'b', 'a', '雾', '书店']);
  });
});

describe('v0.17 索引表（Dexie version 5）', () => {
  it('从 v4 库升级：旧数据一条不丢，打开后后台补齐索引', async () => {
    const name = 'ft-up-' + Math.random();
    const old = new Dexie(name);
    old.version(4).stores({ items: '++id, type, createdAt, updatedAt, *tags, thumbTodo, sample, touchedAt', developments: '++id, createdAt, starred, evidence', images: '&itemId', daily: '&day' });
    await old.table('items').bulkAdd([
      { type: 'film', title: '旧片子', why: '夜里的窗', tags: [], createdAt: 1, updatedAt: 1 },
      { type: 'music', title: 'Old Song', tags: ['雨'], createdAt: 2, updatedAt: 2 },
    ]);
    await old.table('developments').add({ itemIds: [1, 2], jump: 0.5, source: 'offline', createdAt: 3, idea: { title: '早先的一根', idea: '雨夜', bridge: '', cliches: [] } });
    old.close();
    const d = new LinganDB(name);
    expect(await d.items.count()).toBe(2);
    expect(await d.ftidx.count()).toBe(0);
    expect(d.verno).toBe(6); // v0.18 起是 6
    const ft = new FtSync(d);
    ft.attach();
    await ft.load();
    await ft.reconcile();
    expect(await d.ftidx.count()).toBe(3);
    expect(ft.status.ready).toBe(true);
    expect(ft.status.indexed).toBe(3);
    const row = await d.ftidx.get('i:1');
    expect(row!.tok).toContain('窗');
    // 第二次打开：读表就行，不用重切
    const ft2 = new FtSync(d);
    await ft2.load();
    await ft2.reconcile();
    expect(ft2.status.built).toBe(0);
    expect(ft2.index.size).toBe(3);
    d.close();
  });

  it('增删改穗时增量更新索引', async () => {
    const d = new LinganDB('ft-inc-' + Math.random());
    const ft = new FtSync(d);
    ft.attach();
    await ft.load();
    await ft.reconcile();
    const docs = async () => (await d.items.toArray()).map((i) => toDoc('i', i));
    const find = async (q: string) => searchDocs(ft.index, await docs(), parseQuery(q)).map((h) => h.doc.ref);
    const id = await addItem({ type: 'idea', title: '凌晨四点的便利店', tags: ['夜'] }, d);
    await ft.settle();
    expect(ft.index.has(`i:${id}`)).toBe(true);
    expect((await d.ftidx.get(`i:${id}`))!.tok).toContain('便利');
    expect(await find('便利')).toEqual([id]);
    const before = ft.status.built;
    // 只碰了一下（touchedAt）：不重切
    await d.items.update(id, { touchedAt: 5 });
    await ft.settle();
    expect(ft.status.built).toBe(before);
    await updateItem(id, { title: '下雨天公交车窗上的水痕' }, d);
    await ft.settle();
    expect(ft.status.built).toBe(before + 1);
    expect(ft.index.candidates({ kind: 'cjk', s: '便利' }).size).toBe(0);
    expect(await find('车窗')).toEqual([id]);
    await deleteItem(id, d);
    await ft.settle();
    expect(ft.index.has(`i:${id}`)).toBe(false);
    expect(await d.ftidx.count()).toBe(0);
    // 新枝也一样
    const bid = await d.developments.add({ itemIds: [], jump: 0.5, source: 'offline', createdAt: 1, idea: { title: '咳嗽副歌', idea: '把咳嗽循环成节拍', bridge: '', cliches: [] } });
    await ft.settle();
    expect(ft.index.has(`b:${bid}`)).toBe(true);
    await d.developments.update(bid, { starred: true });
    await ft.settle();
    await clearAll(d);
    expect(await d.ftidx.count()).toBe(0);
    await ft.reconcile();
    expect(ft.index.size).toBe(0);
    d.close();
  });
});
