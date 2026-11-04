// v0.35 拾穗 · 认得出常用 App + 把旧仓库搬进来：0012 短链展开 / 0803 B 站时间点 / 0062 播客 / 0063 0064 平台识别 / ROADMAP v0.27 分享文案（5 平台各 3 条）/
// 0016 再次遇见 / 0014 0802 0817 豆瓣 CSV·xlsx / ROADMAP v0.28 flomo·书签·纯文本 / 0049 Kindle·微信读书 / 0065 导入穗束 / 拼音字表紧凑编码
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuick } from '../lib/quick';
import { biliId, biliMeta, clock, isShort, timeMark } from '../lib/platforms';
import { fetchLinkMeta, guessType } from '../lib/linkmeta';
import { dupKeys, mergedPatch } from '../lib/dupe';
import { addItem, db, findDupes, mergeInto } from '../lib/db';
import { bookmarkItems, csvRows, flomoItems, kindleItems, parseFile, parseWhen, plainItems, planMoveIn, runMoveIn, tableItems, wereadItems } from '../lib/importers';
import { gb2312Chars, readingsOf, toPinyin, ready as pinyinReady } from '../lib/pinyin';
import type { Item } from '../lib/types';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => (m.has(k) ? m.get(k)! : null), key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => void m.delete(k), setItem: (k, v) => void m.set(k, String(v)) };
}
const g = globalThis as unknown as { localStorage?: Storage; window?: unknown };
beforeEach(async () => {
  g.localStorage = memStorage();
  if (!g.window) g.window = new EventTarget();
  await db.items.clear();
});
afterEach(() => {
  delete g.localStorage;
  vi.unstubAllGlobals();
});

// 手写的样例：照常见的分享文案格式写的（不是从真机复制的），用来锁住解析规则
const SHARES: Array<[string, string, Item['type'] | null, string?]> = [
  ['分享Cigarettes After Sex的单曲《Apocalypse》: https://163cn.tv/zH2Rk1 (来自@网易云音乐)', 'Apocalypse', 'music', 'Cigarettes After Sex'],
  ['分享陈奕迅的单曲《富士山下》https://y.music.163.com/m/song?id=65766&uct2=abc&dlt=0846 (来自@网易云音乐)', '富士山下', 'music', '陈奕迅'],
  ['分享坂本龍一的专辑《async》: http://163cn.tv/aBcD12 (来自@网易云音乐)', 'async', 'music', '坂本龍一'],
  ['分享周杰伦的单曲《晴天》https://c6.y.qq.com/base/fcgi-bin/u?__=Ab3dEf @QQ音乐', '晴天', 'music', '周杰伦'],
  ['分享陈绮贞的单曲《旅行的意义》: https://i.y.qq.com/v8/playsong.html?songmid=001Qu4I30eVFYb (来自@QQ音乐)', '旅行的意义', 'music', '陈绮贞'],
  ['分享王菲的歌曲《红豆》https://c6.y.qq.com/base/fcgi-bin/u?__=9XyZ12 （来自@QQ音乐）', '红豆', 'music', '王菲'],
  ['《花样年华》 https://m.douban.com/movie/subject/1291557/ (来自@豆瓣App)', '花样年华', 'film'],
  ['推荐电影《重庆森林》 https://movie.douban.com/subject/1291999/?_dtcc=1&dt_dapp=1', '重庆森林', 'film'],
  ['《OK Computer》 https://m.douban.com/music/subject/1400705/ (来自@豆瓣App)', 'OK Computer', 'music'],
  ['【一个人坐末班车-哔哩哔哩】 https://www.bilibili.com/video/BV1GJ411x7h7/?share_source=copy_web&vd_source=ab12&t=192', '一个人坐末班车', 'film'],
  ['【王家卫电影里的光影-哔哩哔哩】 https://b23.tv/AbC1234', '王家卫电影里的光影', null],
  ['【夜车 vlog_哔哩哔哩_bilibili】 https://b23.tv/Xy9z876', '夜车 vlog', null],
  ['雨天的书店 - 小林 | 小红书 - 你的生活兴趣社区 http://xhslink.com/a/Ab12Cd，复制本条信息，打开【小红书】App查看精彩内容！', '雨天的书店', 'link'],
  ['【旧胶片调色思路】😆 Kp3mNq 😆 http://xhslink.com/a/xyZ9，复制本条信息，打开【小红书】App查看精彩内容！', '旧胶片调色思路', 'link'],
  ['62 北海道的雪发布了一篇小红书笔记，快来看吧！ 😆 ZtUbn9pQ8q 😆 http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！', '（这种格式文案里没有标题，要联网抓）', 'link'],
];

// v0.42 拼音字表压缩进包，先解开
beforeAll(() => pinyinReady);

describe('ROADMAP v0.27 认得出常用 App', () => {
  it('5 平台各 3 条分享文案：主标题 + 类型 ≥ 13/15（b23 短链的类型要展开后才知道，见下一条）', () => {
    let ok = 0;
    const miss: string[] = [];
    for (const [text, title, type, creator] of SHARES) {
      const d = parseQuick(text)!;
      const good = d.title === title && (type == null || d.type === type) && (!creator || d.creator === creator);
      if (good) ok++;
      else miss.push(`${d.title}|${d.type}|${d.creator}`);
    }
    expect(miss).toEqual(['北海道的雪|link|']); // 唯一认不出的是「某某发布了一篇小红书笔记」：标题只能联网抓
    expect(ok).toBeGreaterThanOrEqual(13);
    expect(ok).toBe(14);
  });
  it('0063 / 0064 平台识别', () => {
    expect(guessType('https://music.apple.com/cn/album/x/1')).toBe('music');
    expect(guessType('https://open.spotify.com/track/abc')).toBe('music');
    expect(guessType('https://music.youtube.com/watch?v=x')).toBe('music');
    expect(guessType('https://www.maoyan.com/films/1')).toBe('film');
    expect(guessType('https://letterboxd.com/film/x/')).toBe('film');
    expect(guessType('https://www.themoviedb.org/movie/1')).toBe('film');
    expect(guessType('https://m.douban.com/movie/subject/1/')).toBe('film');
    expect(guessType('https://m.bilibili.com/video/BV1GJ411x7h7')).toBe('film');
    expect(guessType('https://www.bilibili.com/read/cv1')).toBe('link');
  });
  it('0062 播客：小宇宙认来源和《》里的单集名', () => {
    const d = parseQuick('我在小宇宙听《第 12 期：夜车》 https://www.xiaoyuzhoufm.com/episode/abc?t=754')!;
    expect(d.title).toBe('第 12 期：夜车');
    expect(d.source).toBe('小宇宙');
    expect(timeMark(d.url)).toBe(754);
  });
});

describe('0803 / 0012 时间点、短链', () => {
  it('timeMark / clock', () => {
    expect(timeMark('https://www.bilibili.com/video/BV1?t=192')).toBe(192);
    expect(timeMark('https://youtu.be/x?t=3m12s')).toBe(192);
    expect(timeMark('https://x.com/a#t=01:02:05')).toBe(3725);
    expect(timeMark('https://x.com/a?start=1')).toBe(0);
    expect(clock(192)).toBe('3:12');
    expect(clock(3725)).toBe('1:02:05');
    expect(isShort('https://b23.tv/AbC')).toBe(true);
    expect(isShort('http://xhslink.com/a/x')).toBe(true);
    expect(isShort('https://www.bilibili.com/video/BV1')).toBe(false);
    expect(biliId('https://www.bilibili.com/video/BV1GJ411x7h7/?t=3')).toBe('BV1GJ411x7h7');
    expect(biliId('https://m.bilibili.com/video/av170001')).toBe('av170001');
  });
  it('b23 短链 → 跟跳转拿到真实地址（保留 t、去掉追踪参数）→ B 站接口取标题 / UP 主', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      calls.push(u);
      if (u.startsWith('https://b23.tv/')) return { ok: true, status: 200, url: 'https://www.bilibili.com/video/BV1GJ411x7h7/?share_source=copy_web&vd_source=ab&t=192', text: async () => '<title>x</title>' } as unknown as Response;
      if (u.startsWith('https://api.bilibili.com/')) return { ok: true, status: 200, url: u, json: async () => ({ data: { title: '王家卫电影里的光影', owner: { name: '影像笔记' }, pubdate: 1700000000, desc: '-' } }) } as unknown as Response;
      throw new Error('unexpected ' + u);
    });
    const m = await fetchLinkMeta('https://b23.tv/AbC1234');
    expect(m.url).toBe('https://www.bilibili.com/video/BV1GJ411x7h7/?t=192');
    expect(m.type).toBe('film');
    expect(m.title).toBe('王家卫电影里的光影');
    expect(m.creator).toBe('影像笔记');
    expect(m.year).toBe('2023');
    expect(calls.some((c) => c.includes('bvid=BV1GJ411x7h7'))).toBe(true);
  });
  it('B 站接口读不到（网页版跨域）→ 退回读网页', async () => {
    const f = async () => ({ ok: true, json: async () => ({ code: -400 }) }) as unknown as Response;
    expect(await biliMeta('BV1GJ411x7h7', 'u', f)).toBeNull();
  });
});

const mk = (o: Partial<Item>) => ({ type: 'film' as const, title: '花样年华', creator: '王家卫', year: '', content: '', url: '', why: '', tags: [], ...o });

describe('0016 再次遇见', () => {
  it('带链接的电影也按作品名 + 作者认；合并记下重逢时间', async () => {
    expect(dupKeys(mk({ url: 'https://movie.douban.com/subject/1291557/' })).some((k) => dupKeys(mk({})).includes(k))).toBe(true);
    const a = await addItem(mk({ url: 'https://movie.douban.com/subject/1291557/', why: '旗袍' }), db, { createdAt: 1000 });
    const b = await addItem(mk({ why: '楼梯' }), db, { createdAt: 5000 });
    expect((await findDupes(b)).map((x) => x.id)).toEqual([a]);
    await mergeInto(a, b);
    const keep = (await db.items.get(a))!;
    expect(keep.meets).toEqual([5000]);
    expect(keep.why).toBe('旗袍 / 楼梯');
    expect((await db.items.get(b))!.deletedAt).toBeTruthy();
  });
  it('新的反而更早：最早那次当首次拾于，原来那次进重逢', async () => {
    const a = await addItem(mk({}), db, { createdAt: 9000 });
    const b = await addItem(mk({}), db, { createdAt: 2000 });
    await mergeInto(a, b);
    const keep = (await db.items.get(a))!;
    expect(keep.createdAt).toBe(2000);
    expect(keep.meets).toEqual([9000]);
  });
  it('mergedPatch 把对方的重逢一起带过来、去重', () => {
    const p = mergedPatch({ ...mk({}), createdAt: 1, updatedAt: 1, meets: [3] } as Item, { ...mk({}), createdAt: 5, updatedAt: 1, meets: [3, 7] } as Item);
    expect(p.meets).toEqual([3, 5, 7]);
  });
});

const XLSX = 'UEsDBBQAAAAIABSOY13HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgAFI5jXV7FM+FfAAAAlwAAAA8AAAB4bC93b3JrYm9vay54bWyzsa/IzVEoSy0qzszPs1Uy1DNQsrezKc8vyk7Kz8+2synOSE0tKYbSCnmJuam2Ss/ndL/Y366kABbzTAHqUlIossoEMoo8UwyV9FFVP52wBlW1EZJqI5BqfZgl+nB7AVBLAwQUAAAACAAUjmNd0OSFUCoBAAA6AgAAFAAAAHhsL3NoYXJlZFN0cmluZ3MueG1sdZJfTsJAEIev0vRJH9r9I4SUlHIWqSTWSGvcLeEARJEAojwURQM2gIkJNiYkIlFP092WW7jEF9OVefy+nZnfJmOWG7VTpV49J47nllSkQ7VsmYRQRXCXlNSGqtie71LhCqowjmVSi08uN+HQBNQywZb80nj1Eq/XadRkrYus41cDQXkw4w9jybVukvtmMl6IVnlmmw8nO/oen5LR62bwzXuzrEvbb3zyzj6WrNvLunwWYIgMDR5oECsYFREsQijtCoI07LLbDp998jCSJ0CoQUPDxl68WrDR12Z+x1fRfvbdMaVnpAhAzas7Vf3I8yuHrm57NUD8yknVpgBhA+XzBSDtD+fxupOlOTkHFjmQBqU/sukzv+4n/eXOSD5x7H8j5eC2/kQC4j6sH1BLAwQUAAAACAAUjmNd4mb+OZMAAAC3AQAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbF3R2woCIRCA4VcRHyBXO8PsLNW277EsQtFBUHF7/CzCxrlS+ebiZ4Tu9biLZH24umcr9aKRHcLs/C1crI0I36Mf44jg3Sx8npEI0+dy0FLEVob8TtiASghq+tmRmq7tRM3U1lNb1namtqptoLYupnJzCTcl3JDhDQuntmXh1HYsnNqehVPTbFNDhZqlK7J/9f+WN1BLAwQUAAAACAAUjmNd2TRFl8sAAADtAQAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQyLnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt7Mpzy/KLs5ITS2xswFTLokliXY2RfnlCkVANUp2NskghqOhkkKJrVIxkF9mZ2CjX2Zno58MlXNCljNElXNGljNClXNBljNGlXNFljNBlXNDljOFy+kD3Qx3uBHc4UbIjkNzgROKJJoTnFEk0dzggiJpiuZAFEkz7C40hrvQGKw6My8nMy81uKQIKJ5ZbGdTYvds08JnczpfTt73rG/p81ktz9b22OgDY0kfJIswTh8p1vQRkQkAUEsBAhQDFAAAAAgAFI5jXcccFzwKAAAACAAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACAAUjmNdXsUz4V8AAACXAAAADwAAAAAAAAAAAAAAgAE7AAAAeGwvd29ya2Jvb2sueG1sUEsBAhQDFAAAAAgAFI5jXdDkhVAqAQAAOgIAABQAAAAAAAAAAAAAAIABxwAAAHhsL3NoYXJlZFN0cmluZ3MueG1sUEsBAhQDFAAAAAgAFI5jXeJm/jmTAAAAtwEAABgAAAAAAAAAAAAAAIABIwIAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLAQIUAxQAAAAIABSOY13ZNEWXywAAAO0BAAAYAAAAAAAAAAAAAACAAewCAAB4bC93b3Jrc2hlZXRzL3NoZWV0Mi54bWxQSwUGAAAAAAUABQBMAQAA7QMAAAAA';

describe('搬进来', () => {
  it('CSV：引号里的逗号 / 换行 / 双引号', () => {
    expect(csvRows('\uFEFFa,b\n"x,1","line\n2"\n"say ""hi"""\n')).toEqual([['a', 'b'], ['x,1', 'line\n2'], ['say "hi"']]);
    expect(csvRows('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('parseWhen', () => {
    expect(parseWhen('2019-03-02 21:10:00')).toBe(new Date(2019, 2, 2, 21, 10).getTime());
    expect(parseWhen('添加于 2023年1月2日星期一 下午3:04:05')).toBe(new Date(2023, 0, 2, 15, 4, 5).getTime());
    expect(parseWhen('2020/1/5')).toBe(new Date(2020, 0, 5).getTime());
    expect(parseWhen('昨天')).toBeUndefined();
  });
  it('0014 / 0817 豆瓣 CSV（豆伴导出）：短评进为什么、评分进正文、打分日期当拾于、类型按链接', () => {
    const p = tableItems(csvRows('标题,个人评分,打分日期,我的短评,上映日期,制片国家,条目链接\n花样年华,5,2019-03-02 21:10:00,旗袍和楼梯,2000-09-29(中国香港),中国香港,https://movie.douban.com/subject/1291557/\n,,,,,,\n'), '看过');
    expect(p.kind).toBe('豆瓣');
    expect(p.bad).toBe(0);
    const [x] = p.items;
    expect(x).toMatchObject({ type: 'film', title: '花样年华', why: '旗袍和楼梯', year: '2000', source: '豆瓣', tags: ['看过'] });
    expect(x.content).toContain('我的评分 5');
    expect(x.at).toBe(new Date(2019, 2, 2, 21, 10).getTime());
  });
  it('0802 豆伴 xlsx：每张表都读，sheet 名当标签', async () => {
    const buf = Uint8Array.from(atob(XLSX), (c) => c.charCodeAt(0));
    const p = await parseFile('豆伴.xlsx', buf);
    expect(p.kind).toBe('豆瓣');
    expect(p.items.map((x) => [x.type, x.title, x.tags.join()])).toEqual([['film', '花样年华', '看过'], ['music', '梦二', '听过'], ['music', '没有链接的歌', '听过']]);
    expect(p.items[1].why).toBe('大提琴');
  });
  it('ROADMAP v0.28 flomo 100 条：条数、时间、标签一致，再导一次不重复', async () => {
    const memos = Array.from({ length: 100 }, (_, i) => `<div class="memo"><div class="time">2023-05-${String((i % 28) + 1).padStart(2, '0')} 10:${String(i % 60).padStart(2, '0')}:00</div><div class="content"><p>第 ${i} 条想法 #灵感/${i % 3} 还有一句</p></div><div class="files"></div></div>`).join('\n');
    const html = `<html><body><div class="memos">${memos}</div></body></html>`;
    const p = await parseFile('flomo.html', new TextEncoder().encode(html));
    expect(p.kind).toBe('flomo');
    expect(p.items).toHaveLength(100);
    expect(p.items[7].at).toBe(new Date(2023, 4, 8, 10, 7).getTime());
    expect(p.items[7].tags).toEqual(['灵感/1']);
    expect(p.items[7].title).toBe('第 7 条想法 还有一句');
    const plan = await planMoveIn(p);
    expect(plan.fresh).toHaveLength(100);
    expect(await runMoveIn(plan.fresh, '导入 · flomo 11/4')).toBe(100);
    const rows = await db.items.toArray();
    expect(rows).toHaveLength(100);
    expect(rows.every((r) => r.bundles?.[0] === '导入 · flomo 11/4' && !r.inbox)).toBe(true);
    const again = await planMoveIn(await parseFile('flomo.html', new TextEncoder().encode(html)));
    expect([again.fresh.length, again.dup]).toEqual([0, 100]);
  });
  it('flomo 单条解析', () => {
    expect(flomoItems('<div class="memo"><div class="time">2023-01-01 08:00:00</div><div class="content"><p>https://example.com/a</p></div><div class="files"></div></div>').items[0]).toMatchObject({ type: 'link', url: 'https://example.com/a' });
  });
  it('浏览器书签：文件夹当标签，书签栏不算', () => {
    const p = bookmarkItems('<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>\n<DL><p>\n<DT><A HREF="https://open.spotify.com/track/1" ADD_DATE="1600000000">一首歌</A>\n<DT><H3>电影 参考</H3>\n<DL><p>\n<DT><A HREF="https://movie.douban.com/subject/1/" ADD_DATE="1600000001">花样年华 (豆瓣)</A>\n<DT><A HREF="javascript:void(0)">小书签</A>\n</DL><p>\n</DL><p>\n</DL>');
    expect(p.items.map((x) => [x.type, x.title, x.tags.join()])).toEqual([['music', '一首歌', ''], ['film', '花样年华 (豆瓣)', '电影 参考']]);
    expect(p.items[0].at).toBe(1600000000000);
  });
  it('0049 Kindle：中文 / 英文，书签条跳过', () => {
    const t = '\uFEFF红楼梦 (曹雪芹)\n- 您在位置 #120-121的标注 | 添加于 2023年1月2日星期一 下午3:04:05\n\n满纸荒唐言\n==========\n红楼梦 (曹雪芹)\n- 您在位置 #130 的书签 | 添加于 2023年1月2日星期一 下午3:05:00\n\n\n==========\nWalden (Henry David Thoreau)\n- Your Highlight on page 3 | Location 40-41 | Added on Sunday, January 1, 2023 10:00:00 AM\n\nI went to the woods.\n==========\n';
    const p = kindleItems(t);
    expect(p.items.map((x) => [x.title, x.creator, x.content])).toEqual([['红楼梦', '曹雪芹', '满纸荒唐言'], ['Walden', 'Henry David Thoreau', 'I went to the woods.']]);
    expect(p.items[0].at).toBe(new Date(2023, 0, 2, 15, 4, 5).getTime());
    expect(p.items[1].source).toBe('Kindle');
  });
  it('0049 微信读书：划线成摘抄，想法 + 原文 → 原文正文、想法为什么', async () => {
    const t = '《瓦尔登湖》\n梭罗\n3个笔记\n\n◆ 经济篇\n\n>> 大多数人过着平静的绝望生活。\n\n◆ 2023/01/02发表想法\n\n说的就是我。\n\n原文：我愿意深深地扎入生活。\n';
    const p = await parseFile('瓦尔登湖.txt', new TextEncoder().encode(t));
    expect(p.kind).toBe('微信读书');
    expect(p.items.map((x) => [x.title, x.creator, x.content, x.why])).toEqual([['瓦尔登湖', '梭罗', '大多数人过着平静的绝望生活。', ''], ['瓦尔登湖', '梭罗', '我愿意深深地扎入生活。', '说的就是我。']]);
    expect(wereadItems(t).items).toHaveLength(2);
  });
  it('纯文本 / 微信收藏导出文字：每段一穗', () => {
    const p = plainItems('第一段想法\n\n- https://example.com/x\n\n很长很长的一段'.padEnd(120, '字'));
    expect(p.items.map((x) => x.type)).toEqual(['idea', 'link', 'text']);
  });
  it('这批里自己重复的只收一次', async () => {
    const p = plainItems('同一句话说了两遍呀\n\n同一句话说了两遍呀');
    const plan = await planMoveIn(p);
    expect([plan.fresh.length, plan.dup]).toEqual([1, 1]);
  });
});

describe('拼音字表紧凑编码', () => {
  it('GB2312 6763 字都还原、读音和以前一样', () => {
    const cs = gb2312Chars();
    expect(cs).toHaveLength(6763);
    expect(cs[0]).toBe('啊');
    expect(cs.at(-1)).toBe('齄');
    expect(readingsOf('重')).toEqual(['zhong', 'chong', 'tong']);
    expect(readingsOf('啊')?.[0]).toBe('a');
    expect(cs.filter((c) => readingsOf(c)).length).toBe(6763);
    expect(toPinyin('拾穗').full).toBe('shisui');
  });
});
