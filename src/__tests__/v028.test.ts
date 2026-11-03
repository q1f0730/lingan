import { describe, expect, it } from 'vitest';
import { addTo, basketHint, parseBasket } from '../lib/basket';
import { bundleCounts, normBundle, splitBundles, withBundles } from '../lib/bundles';
import { cleanUrl, parseShareCode } from '../lib/cleanurl';
import { isPinyinQuery, pinyinMatch, toPinyin } from '../lib/pinyin';
import { matchFilters, parseSyntax } from '../lib/qsyntax';
import { parseQuick } from '../lib/quick';

describe('0023 cleanUrl', () => {
  it('strips tracking params, keeps content params', () => {
    expect(cleanUrl('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1007&vd_source=abc&t=30&p=2&share_source=copy_web')).toBe('https://www.bilibili.com/video/BV1xx411c7mD/?t=30&p=2');
    expect(cleanUrl('https://music.163.com/song?id=5257138&userid=123&uct2=x')).toBe('https://music.163.com/song?id=5257138');
    expect(cleanUrl('https://www.xiaohongshu.com/explore/65a?xsec_token=AB&xsec_source=pc_share&xhsshare=CopyLink')).toBe('https://www.xiaohongshu.com/explore/65a');
    expect(cleanUrl('https://youtu.be/dQw4w9WgXcQ?si=Kj3&t=42')).toBe('https://youtu.be/dQw4w9WgXcQ?t=42');
    expect(cleanUrl('https://example.com/a?utm_source=x&utm_medium=y#top')).toBe('https://example.com/a#top');
    expect(cleanUrl('https://mp.weixin.qq.com/s?__biz=MzA&mid=22&idx=1&sn=ab&chksm=zz&scene=21#wechat_redirect')).toBe('https://mp.weixin.qq.com/s?__biz=MzA&mid=22&idx=1&sn=ab');
  });
  it('leaves ambiguous params on other sites and returns raw when unchanged', () => {
    expect(cleanUrl('https://docs.example.com/x?lang=zh&key=1&from=2')).toBe('https://docs.example.com/x?lang=zh&key=1&from=2');
    expect(cleanUrl('not a url')).toBe('not a url');
  });
});

describe('0019 share codes', () => {
  it('douyin', () => {
    const t = '7.94 复制打开抖音，看看【某某的作品】雨夜的霓虹灯 # 城市 https://v.douyin.com/iRNBho6u/ vSm@g.Oh 01/12 ';
    const r = parseShareCode(t, 'https://v.douyin.com/iRNBho6u/');
    expect(r?.source).toBe('抖音');
    expect(r?.title).toContain('雨夜的霓虹灯');
    expect(r?.title).not.toMatch(/复制|7\.94|作品/);
  });
  it('xiaohongshu', () => {
    const t = '一个人的末班车 http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！';
    const r = parseShareCode(t, 'http://xhslink.com/a/AbCdEf');
    expect(r).toEqual({ url: 'http://xhslink.com/a/AbCdEf', title: '一个人的末班车', source: '小红书' });
  });
  it('plain sentence + link is not a share code', () => {
    expect(parseShareCode('这篇写得好 https://example.com/a', 'https://example.com/a')).toBeNull();
  });
  it('parseQuick uses it', () => {
    const d = parseQuick('一个人的末班车 http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！');
    expect(d?.title).toBe('一个人的末班车');
    expect(d?.source).toBe('小红书');
    expect(d?.url).toBe('http://xhslink.com/a/AbCdEf');
  });
});

describe('0024 inline syntax', () => {
  it('《片名》 @作者 > 为什么 #标签', () => {
    const d = parseQuick('《重庆森林》 @王家卫 > 雨夜里的霓虹 #夜')!;
    expect(d.type).toBe('film');
    expect(d.title).toBe('重庆森林');
    expect(d.creator).toBe('王家卫');
    expect(d.why).toBe('雨夜里的霓虹');
    expect(d.tags).toEqual(['夜']);
  });
  it('year after book title', () => {
    const d = parseQuick('《花样年华》 2000')!;
    expect(d.type).toBe('film');
    expect(d.year).toBe('2000');
  });
  it('/歌 forces type', () => {
    const d = parseQuick('/歌 晴天 @周杰伦')!;
    expect(d.type).toBe('music');
    expect(d.title).toBe('晴天');
    expect(d.creator).toBe('周杰伦');
  });
  it('emails and urls with @ are left alone; link keeps why', () => {
    expect(parseQuick('给 a@b.com 写信')!.creator).toBe('');
    const d = parseQuick('https://example.com/@me/post?utm_source=x > 排版好看')!;
    expect(d.url).toBe('https://example.com/@me/post');
    expect(d.why).toBe('排版好看');
    expect(d.creator).toBe('');
  });
  it('old behaviour unchanged', () => {
    expect(parseQuick('想做一个只在下雨天更新的网站 #点子')).toMatchObject({ type: 'idea', title: '想做一个只在下雨天更新的网站', tags: ['点子'], why: '' });
    expect(parseQuick('「人生若只如初见」')!.type).toBe('text');
  });
});

describe('0112 pinyin', () => {
  it('full and initials', () => {
    expect(toPinyin('王家卫').full).toBe('wangjiawei');
    expect(toPinyin('王家卫 2046').initials).toBe('wjw2046');
    const it0 = { title: '重庆森林', creator: '王家卫', tags: ['夜'] };
    expect(pinyinMatch(it0, 'wjw')).toBe(true);
    expect(pinyinMatch(it0, 'wangjiawei')).toBe(true);
    expect(pinyinMatch(it0, 'jiawei')).toBe(true);
    expect(pinyinMatch(it0, 'senlin')).toBe(true);
    expect(pinyinMatch(it0, 'chongqing')).toBe(true); // 多音字：重 = chong
    expect(pinyinMatch(it0, 'cqsl')).toBe(true);
    expect(pinyinMatch(it0, 'chongq')).toBe(true); // 最后一个音节打一半
    expect(pinyinMatch(it0, 'angjia')).toBe(false); // 不从字的开头起
    expect(pinyinMatch(it0, 'lwj')).toBe(false); // 不跨字段
  });
  it('query detection', () => {
    expect(isPinyinQuery('wjw')).toBe(true);
    expect(isPinyinQuery('wang jia wei')).toBe(true);
    expect(isPinyinQuery('w')).toBe(false);
    expect(isPinyinQuery('王')).toBe(false);
    expect(isPinyinQuery('type:film')).toBe(false);
  });
});

describe('0408 basket', () => {
  it('add / dedupe / bump', () => {
    expect(addTo([], 1)).toEqual({ list: [1], result: 'added' });
    expect(addTo([1], 1).result).toBe('already');
    expect(addTo([1, 2, 3, 4, 5], 6)).toEqual({ list: [2, 3, 4, 5, 6], result: 'bumped', bumped: 1 });
    expect(parseBasket('[1,1,"x",2,-3,4.5]')).toEqual([1, 2]);
    expect(parseBasket('oops')).toEqual([]);
    expect(basketHint(1)).toBe('再放 2 穗就能嫁接');
    expect(basketHint(3)).toContain('可以嫁接了');
  });
});

describe('0107 bundles', () => {
  it('names and counts', () => {
    expect(splitBundles(' 毕业设计参考，想写的歌、毕业设计参考 ')).toEqual(['毕业设计参考', '想写的歌']);
    expect(normBundle('#  夜 车 ')).toBe('夜 车');
    expect(withBundles(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(bundleCounts([{ bundles: ['a', 'b'] }, { bundles: ['a'] }, { bundles: ['a'], deletedAt: 1 }, {}])).toEqual([['a', 2], ['b', 1]]);
  });
  it('束: search syntax', () => {
    const p = parseSyntax('束:想写的歌 夜');
    expect(p.text).toBe('夜');
    const base = { type: 'idea' as const, tags: [], createdAt: 0 };
    expect(matchFilters({ ...base, bundles: ['想写的歌'] }, p.filters)).toBe(true);
    expect(matchFilters({ ...base }, p.filters)).toBe(false);
    expect(matchFilters({ ...base }, parseSyntax('束:空').filters)).toBe(true);
  });
});
