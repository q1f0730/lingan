// v0.39 外面的东西拾进来：链接快照 / 公众号、网易云歌单、RSS 待拾、接入权限、上锁、待补重试、模型国内镜像
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../lib/types';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
beforeAll(() => {
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
beforeEach(() => localStorage.clear());

const FX = import.meta.glob('./fixtures/v039/*', { query: '?raw', eager: true, import: 'default' }) as Record<string, string>;
const fx = (n: string) => FX[`./fixtures/v039/${n}`];

describe('0017 / 0829 正文快照', () => {
  it('<article> 里的正文，去掉导航 / 页脚 / 脚本，取第一张像样的图', async () => {
    const S = await import('../lib/snapshot');
    const a = S.extractArticle(fx('article.html'), 'https://blog.example.com/p/1');
    expect(a.how).toBe('container');
    expect(a.text).toContain('很多东西不用急着收藏');
    expect(a.text).toContain('招牌字体');
    expect(a.text).not.toContain('导航文字');
    expect(a.text).not.toContain('页脚');
    expect(a.text).not.toContain('track()');
    expect(a.image).toBe('https://blog.example.com/img/photo.jpg');
  });
  it('认不出容器时退回所有 ≥20 字的段落', async () => {
    const S = await import('../lib/snapshot');
    const a = S.extractArticle(fx('plain.html'), 'https://x.com/');
    expect(a.how).toBe('paragraphs');
    expect(a.text.split('\n\n')).toHaveLength(2);
  });
  it('截到 50KB 以内、不切断字', async () => {
    const S = await import('../lib/snapshot');
    const big = '<article>' + '<p>' + '拾穗'.repeat(40000) + '</p></article>';
    const a = S.extractArticle(big, 'https://x.com/');
    expect(new TextEncoder().encode(a.text).length).toBeLessThanOrEqual(S.SNAP_MAX);
    expect(a.text.endsWith('…')).toBe(true);
    expect(S.clipBytes('短的')).toBe('短的');
  });
  it('嵌套同名标签按层数配对', async () => {
    const S = await import('../lib/snapshot');
    const h = '<div id="a"><div>1</div><div>2<div>3</div></div></div><div>外面</div>';
    expect(S.innerAt(h, 0)).toBe('<div>1</div><div>2<div>3</div></div>');
  });
});

describe('0013 / 0827 公众号', () => {
  it('读脚本变量：标题 / 公众号名 / 封面 / 摘要 / 发布时间；正文取 #js_content', async () => {
    const S = await import('../lib/snapshot');
    const h = fx('wx.html');
    const w = S.wxMeta(h);
    expect(w).toMatchObject({ title: '一盏灯的夜晚', creator: '夜里写字的人', description: '关于等待的一点点记录', image: 'https://mmbiz.qpic.cn/mmbiz_jpg/cover/0?wx_fmt=jpeg', at: 1787270880000 });
    const a = S.extractArticle(h, 'https://mp.weixin.qq.com/s/abc');
    expect(a.text.split('\n')[0]).toBe('末班车开过来的时候，整条街只剩下一盏灯。');
    expect(a.text).toContain('外婆家的厨房 & 那些<慢慢>熬的汤');
    expect(a.text).toContain('灯是一种等待');
    expect(a.text).not.toContain('阅读 10万+');
    expect(a.image).toBe('https://mmbiz.qpic.cn/mmbiz_jpg/abc/640?wx_fmt=jpeg');
    expect(S.isWx('https://mp.weixin.qq.com/s/abc')).toBe(true);
  });
  it('删了 / 要验证 / 参数错误给能看懂的原因', async () => {
    const S = await import('../lib/snapshot');
    expect(() => S.wxMeta('<p>该内容已被发布者删除</p>')).toThrow('已被删除');
    expect(() => S.wxMeta('<p>环境异常 去验证</p>')).toThrow('验证');
    expect(() => S.wxMeta('<p>参数错误</p>')).toThrow('没读到');
  });
});

describe('0015 / 0801 网易云歌单', () => {
  it('认出各种歌单链接', async () => {
    const N = await import('../lib/netease');
    expect(N.playlistId('https://music.163.com/#/playlist?id=3778678')).toBe('3778678');
    expect(N.playlistId('分享歌单：夜里 https://music.163.com/playlist?id=123456&userid=9 (@网易云音乐)')).toBe('123456');
    expect(N.playlistId('https://y.music.163.com/m/playlist?app_version=9&id=777888&creatorId=1')).toBe('777888');
    expect(N.playlistId('https://music.163.com/song?id=11')).toBeNull();
    expect(N.shortLink('来听 https://163cn.tv/AbC123 吧')).toBe('https://163cn.tv/AbC123');
  });
  it('解析详情：缺的曲目列出来补；封面换 https', async () => {
    const N = await import('../lib/netease');
    const { pl, missing } = N.parsePlaylist(JSON.parse(fx('playlist.json')), '123456');
    expect(pl).toMatchObject({ name: '夜里 #听的', creator: 'Q1f730', count: 3, cover: 'https://p1.music.126.net/pl.jpg' });
    expect(pl.songs.map((s) => s.name)).toEqual(['晴天', '夜曲']);
    expect(pl.songs[0]).toMatchObject({ artists: ['周杰伦'], album: '叶惠美', cover: 'https://p2.music.126.net/a.jpg', dur: 269000 });
    expect(missing).toEqual([13]);
    expect(N.songOf({ id: 13, name: '稻香', artists: [{ name: '周杰伦' }], album: { name: '魔杰座' } })).toMatchObject({ artists: ['周杰伦'], album: '魔杰座' });
    expect(() => N.parsePlaylist({ code: 401 }, '1')).toThrow('不公开');
  });
  it('每首一穗（标签 = 歌单名、为什么留空）或整单一穗', async () => {
    const N = await import('../lib/netease');
    const { pl } = N.parsePlaylist(JSON.parse(fx('playlist.json')), '123456');
    const each = N.playlistDrafts(pl, new Set([11, 12]), 'each');
    expect(each).toHaveLength(2);
    expect(each[0].d).toMatchObject({ type: 'music', title: '晴天', creator: '周杰伦', why: '', tags: ['夜里听的'], url: 'https://music.163.com/song?id=11', source: '网易云音乐', content: '专辑《叶惠美》' });
    expect(each[0].cover).toBe('https://p2.music.126.net/a.jpg');
    const one = N.playlistDrafts(pl, new Set([12]), 'one');
    expect(one).toHaveLength(1);
    expect(one[0].d.title).toBe('歌单《夜里 #听的》');
    expect(one[0].d.content).toBe('1. 夜曲 — 周杰伦');
  });
});

describe('0804 / 0826 / 0847 订阅进待拾', () => {
  it('RSS 2.0：CDATA、转义 HTML、guid、日期', async () => {
    const F = await import('../lib/feeds');
    const p = F.parseFeed(fx('rss.xml'), 'https://example.com/feed');
    expect(p.title).toBe('某某的播客');
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toMatchObject({ title: '第 12 期：城市夜晚 & 声音', link: 'https://example.com/ep12', guid: 'ep-12', summary: '我们聊了夜班公交和便利店的白光。' });
    expect(p.items[0].at).toBe(Date.parse('2026-11-02T02:00:00Z'));
    expect(p.items[1].summary).toBe('转义过的 HTML 摘要');
    expect(p.items[1].at).toBe(Date.parse('2026-10-26T02:00:00Z'));
  });
  it('Atom：alternate 链接、相对地址补全', async () => {
    const F = await import('../lib/feeds');
    const p = F.parseFeed(fx('atom.xml'), 'https://letterboxd.com/q1f730/rss/');
    expect(p.title).toBe('Letterboxd - q1f730');
    expect(p.items[0]).toMatchObject({ title: '花样年华, 2000 - ★★★★½', link: 'https://letterboxd.com/q1f730/film/in-the-mood-for-love/', summary: '走廊里擦肩。' });
    expect(p.items[1].link).toBe('https://letterboxd.com/q1f730/film/last-bus/');
  });
  it('RSSHub 模板 + 自定实例；Letterboxd 直连', async () => {
    const F = await import('../lib/feeds');
    const bili = F.TEMPLATES.find((t) => t.id === 'bili')!;
    expect(F.tplUrl(bili, ' 2267573 ')).toBe('https://rsshub.app/bilibili/user/video/2267573');
    localStorage.setItem(F.RSSHUB_KEY, 'https://hub.example.org/');
    expect(F.tplUrl(bili, '1')).toBe('https://hub.example.org/bilibili/user/video/1');
    const lb = F.TEMPLATES.find((t) => t.id === 'lbxd')!;
    expect(F.tplUrl(lb, '@q1f730')).toBe('https://letterboxd.com/q1f730/rss/');
  });
  it('拾必须有为什么或标签', async () => {
    const F = await import('../lib/feeds');
    expect(F.pickReady('', [])).toBe(false);
    expect(F.pickReady('  ', [])).toBe(false);
    expect(F.pickReady('像小时候', [])).toBe(true);
    expect(F.pickReady('', ['夜'])).toBe(true);
  });
  it('订阅 → 待拾（独立库），同一条不进两次，丢掉的不再出现', async () => {
    const F = await import('../lib/feeds');
    const xml = fx('rss.xml');
    const fetchMock = vi.fn(async () => new Response(xml, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await F.addFeed('https://example.com/feed');
    expect(r.added).toBe(2);
    expect(localStorage.getItem(F.FEEDS_N)).toBe('1');
    const again = await F.pullAll();
    expect(again.added).toBe(0);
    const rows = await F.fdb().entries.toArray();
    await F.setState([rows[0].id!], 'dropped');
    expect(await F.fdb().entries.where('state').equals('new').count()).toBe(1);
    await F.pullAll();
    expect(await F.fdb().entries.where('state').equals('new').count()).toBe(1);
    await expect(F.addFeed('https://example.com/feed')).rejects.toThrow('已经订阅过');
    await F.removeFeed(r.feed.id!);
    expect(await F.fdb().entries.count()).toBe(0);
    expect(localStorage.getItem(F.FEEDS_N)).toBeNull();
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', memStorage());
    vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
  });
});

describe('0805 接入权限', () => {
  it('域名白名单：精确 / 子域 / 任意', async () => {
    const P = await import('../lib/plugs');
    expect(P.hostAllowed('p2.music.126.net', P.NETEASE_HOSTS)).toBe(true);
    expect(P.hostAllowed('music.126.net', P.NETEASE_HOSTS)).toBe(true);
    expect(P.hostAllowed('evil-music.126.net.example.com', P.NETEASE_HOSTS)).toBe(false);
    expect(P.hostAllowed('example.com', ['*'])).toBe(true);
  });
  it('停用后拒绝；没声明的域名拒绝', async () => {
    const P = await import('../lib/plugs');
    expect(() => P.assertPlug('netease', 'https://music.163.com/api/x', P.NETEASE_HOSTS)).not.toThrow();
    expect(() => P.assertPlug('netease', 'https://tracker.example.com/x', P.NETEASE_HOSTS)).toThrow('没声明');
    P.setPlug('netease', false);
    expect(P.plugOn('netease')).toBe(false);
    expect(() => P.assertPlug('netease', 'https://music.163.com/api/x', P.NETEASE_HOSTS)).toThrow('已停用');
    P.setPlug('netease', true);
    expect(localStorage.getItem(P.PLUG_OFF_KEY)).toBeNull();
  });
  it('停用 AI 服务：模型调用直接拒绝，不发请求', async () => {
    const P = await import('../lib/plugs');
    const { chat } = await import('../lib/ai');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    P.setPlug('ai', false);
    const s = { preset: 'x', chat: { baseUrl: 'https://api.example.com/v1', apiKey: 'k', chatModel: 'm', visionModel: '' }, embed: { baseUrl: '', apiKey: '', model: '', sameAsChat: true }, theme: 'system', temperature: 1, autoCaption: false, autoEmbed: false } as never;
    await expect(chat(s, [{ role: 'user', content: 'hi' }])).rejects.toThrow('已停用');
    expect(fetchMock).not.toHaveBeenCalled();
    P.setPlug('ai', true);
  });
});

describe('0907 上锁', () => {
  const it0 = { id: 1, type: 'idea', title: '心事', content: '说不出口的', why: '因为', tags: ['夜'], createdAt: 1, updatedAt: 1, locked: 1, url: 'https://x.com', snap: '正文' } as Item;
  it('没解锁：卡片只剩空壳；解锁后原样', async () => {
    const L = await import('../lib/lock');
    L.relock();
    expect(L.hidden(it0)).toBe(true);
    const m = L.masked(it0);
    expect(m).toMatchObject({ title: L.LOCKED_TITLE, content: '', why: '', tags: [], url: '' });
    expect(m.snap).toBeUndefined();
    L.openFor(60000);
    expect(L.hidden(it0)).toBe(false);
    expect(L.masked(it0)).toBe(it0);
    L.relock();
    expect(L.unlocked()).toBe(false);
  });
  it('PIN：PBKDF2 存本机，对了才解锁，输错 5 次锁 30 秒', async () => {
    const L = await import('../lib/lock');
    const P = await import('../lib/lockpin');
    await expect(P.setPin('12')).rejects.toThrow('4–12');
    await P.setPin('2468');
    expect(L.lockReady()).toBe(true);
    expect(localStorage.getItem(L.LOCK_KEY)).not.toContain('2468');
    expect(await P.checkPin('1111')).toBe(false);
    expect(L.unlocked()).toBe(false);
    expect(await P.checkPin('2468')).toBe(true);
    expect(L.unlocked()).toBe(true);
    L.relock();
    for (let i = 0; i < 5; i++) await P.checkPin('0000');
    expect(P.waitLeft()).toBeGreaterThan(0);
    expect(await P.checkPin('2468')).toBe(false);
    expect(await P.clearPin('0000')).toBe(false);
  }, 20000);
  it('上锁的穗：任何模型都不发、Agent 看不到、不进每日一穗 / 花园 / 分享溯源', async () => {
    const { aiVisible, MINI } = await import('../lib/privacy');
    const s = { privateLocal: true, chat: { baseUrl: 'http://127.0.0.1:1234/v1' } };
    expect(aiVisible({ locked: 1 }, s)).toBe(false);
    expect(aiVisible({ locked: 1 }, s, MINI)).toBe(false);
    expect(aiVisible({ private: 1 }, s, MINI)).toBe(true);
    const { visible } = await import('../lib/agentapi');
    expect(visible(it0)).toBe(false);
    const { dailyPool } = await import('../lib/daily');
    const mk = (id: number, o: Partial<Item> = {}) => ({ id, type: 'idea', title: 't' + id, tags: [], createdAt: id, updatedAt: id, ...o }) as Item;
    expect(dailyPool([mk(1, { locked: 1 }), mk(2), mk(3), mk(4), mk(5)]).map((x) => x.id)).toEqual([2, 3, 4, 5]);
    const { gardenItems } = await import('../lib/garden');
    expect(gardenItems([mk(1, { garden: 1, locked: 1 }), mk(2, { garden: 1 })]).map((x) => x.id)).toEqual([2]);
    const { branchShareText } = await import('../lib/sharekit');
    const t = branchShareText({ title: '新枝', idea: 'x' }, [mk(1, { locked: 1, title: '心事' }), mk(2, { title: '晴天' })], 'show', 'Q1f730');
    expect(t).toContain('晴天');
    expect(t).not.toContain('心事');
    expect(t).not.toContain('私密');
  });
});

describe('0054 待补 / 同步字段', () => {
  it('待补只在本机（不同步、不算修改）；快照和上锁随同步', async () => {
    const { SKIP } = await import('../lib/sync/merge');
    expect(SKIP.items.has('metaTodo')).toBe(true);
    expect(SKIP.items.has('snap')).toBe(false);
    expect(SKIP.items.has('locked')).toBe(false);
  });
  it('网页没读到：打待补、计数；重试成功去掉待补、补上快照', async () => {
    const { db, addItem } = await import('../lib/db');
    const LM = await import('../lib/linkretry');
    const id = await addItem({ type: 'link', title: 'https://blog.example.com/p/1', url: 'https://blog.example.com/p/1', tags: [] });
    await LM.markMetaTodo(id);
    expect((await db.items.get(id))!.metaTodo).toBe(1);
    expect(localStorage.getItem(LM.TODO_KEY)).toBe('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fx('article.html'), { status: 200 })));
    const r = await LM.retryTodo();
    expect(r).toEqual({ done: 1, left: 0 });
    const row = (await db.items.get(id))!;
    expect(row.metaTodo).toBeUndefined();
    expect(row.title).toBe('Blog');
    expect(row.snap).toContain('慢下来的一年');
    expect(localStorage.getItem(LM.TODO_KEY)).toBeNull();
  });
});

describe('本机小模型国内镜像', () => {
  it('中国大陆时区先走国内镜像；其它地方 jsDelivr → raw → 国内镜像；都指同一个 tag 文件', async () => {
    const M = await import('../lib/mini');
    const cn = M.miniUrls('Asia/Shanghai');
    expect(new URL(cn[0]).hostname).toBe('cdn.jsdmirror.com');
    expect(new URL(cn[1]).hostname).toBe('jsd.onmicrosoft.cn');
    expect(cn[cn.length - 1]).toContain('raw.githubusercontent.com');
    const us = M.miniUrls('America/New_York');
    expect(us.slice(0, 2)).toEqual(M.MINI_URLS);
    expect(us).toContain(cn[0]);
    for (const u of [...cn, ...us]) {
      expect(u).toMatch(/v0\.38\.0\/models\/mini-zh-v1\.bin$/);
      expect(M.MINI_HOSTS).toContain(new URL(u).hostname);
    }
    expect(M.miniUrls('Asia/Taipei')[0]).toBe(M.MINI_URLS[0]);
  });
});

describe('0934 每穗出口', () => {
  const mk = (id: number, o: Partial<Item> = {}) => ({ id, type: 'idea', title: 't' + id, tags: [], createdAt: id, updatedAt: id, ...o }) as Item;
  it('关掉的出口拿不到这一穗，别的出口照常；上锁 = 全关', async () => {
    const { aiVisible, exitOpen, EXITS } = await import('../lib/privacy');
    const s = { chat: { baseUrl: 'https://api.example.com/v1' } };
    const ai = mk(1, { shut: ['ai'] });
    expect(aiVisible(ai, s)).toBe(false);
    expect(exitOpen(ai, 'agent')).toBe(true);
    for (const [e] of EXITS) expect(exitOpen(mk(2, { locked: 1 }), e)).toBe(false);
    const { visible } = await import('../lib/agentapi');
    expect(visible(mk(3, { shut: ['agent'] }))).toBe(false);
    expect(visible(ai)).toBe(true);
    const { gardenItems } = await import('../lib/garden');
    expect(gardenItems([mk(4, { garden: 1, shut: ['garden'] }), mk(5, { garden: 1, shut: ['ai'] })]).map((x) => x.id)).toEqual([5]);
    const { branchShareText } = await import('../lib/sharekit');
    const t = branchShareText({ title: '新枝', idea: 'x' }, [mk(6, { shut: ['share'], title: '心事' }), mk(7, { title: '晴天' })], 'show', 'Q1f730');
    expect(t).toContain('晴天');
    expect(t).not.toContain('心事');
  });
  it('按标签批量关 / 开；出口随同步', async () => {
    const { db, addItem } = await import('../lib/db');
    const { shutByTag } = await import('../lib/repo');
    const a = await addItem({ type: 'idea', title: '甲', tags: ['心事934'] });
    const b = await addItem({ type: 'idea', title: '乙', tags: ['心事934', '夜'] });
    const c = await addItem({ type: 'idea', title: '丙', tags: ['夜'] });
    expect(await shutByTag('心事934', 'agent', true)).toBe(2);
    expect(await shutByTag('心事934', 'agent', true)).toBe(0);
    expect((await db.items.get(a))!.shut).toEqual(['agent']);
    expect((await db.items.get(c))!.shut).toBeUndefined();
    expect(await shutByTag('心事934', 'agent', false)).toBe(2);
    expect((await db.items.get(b))!.shut).toBeUndefined();
    const { SKIP } = await import('../lib/sync/merge');
    expect(SKIP.items.has('shut')).toBe(false);
  });
});
