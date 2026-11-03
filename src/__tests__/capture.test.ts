import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinganDB, addItem } from '../lib/db';
import { drainInbox, inboxToDraft, parseInbox, pushHints, recentTags, type InboxBridge, type InboxEntry } from '../lib/capture';
import { sourceName, cleanSource } from '../lib/sources';
import { nowPlayingDraft, nowPlayingSupport, parseNowPlaying } from '../lib/nowplaying';
import { readNotify, requestNotify } from '../lib/notify';
import { clearDraft, draftWriter, loadDraft, saveDraft } from '../lib/drafts';
import { isUlid, ulid, ulidTime } from '../lib/ulid';
import { takeGo } from '../lib/share';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
const T0 = 1_760_000_000_000;

// Kotlin Glean.ulid() 的同款算法（scripts/android/Glean.kt）：10 位时间 + 16 位随机
function kotlinUlid(t: number): string {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const time: string[] = [];
  let x = t;
  for (let i = 9; i >= 0; i--) {
    time[i] = A[x % 32];
    x = Math.floor(x / 32);
  }
  let r = '';
  for (let i = 0; i < 16; i++) r += A[Math.floor(Math.random() * 32)];
  return time.join('') + r;
}

/** 模拟原生收件箱（filesDir/glean_inbox） */
function fakeInbox(entries: InboxEntry[], images: Record<string, string> = {}) {
  const box = new Map(entries.map((e) => [e.uid, e]));
  const acked: string[] = [];
  let hints = '';
  const bridge: InboxBridge = {
    list: () => JSON.stringify([...box.values()]),
    image: (uid) => images[uid] || '',
    ack: (uid) => {
      acked.push(uid);
      return box.delete(uid);
    },
    setHints: (j) => {
      hints = j;
    },
  };
  return { bridge, box, acked, hints: () => hints };
}

const JPEG = 'data:image/jpeg;base64,' + btoa('\xff\xd8' + 'x'.repeat(600));

describe('v0.22 来源 App', () => {
  it('安卓包名映射成中文名，认不出留空不猜', () => {
    expect(sourceName('com.tencent.weread')).toBe('微信读书');
    expect(sourceName('com.netease.cloudmusic')).toBe('网易云音乐');
    expect(sourceName('com.xingin.xhs')).toBe('小红书');
    expect(sourceName('com.example.unknown')).toBe('');
    expect(sourceName('')).toBe('');
    expect(sourceName(undefined)).toBe('');
  });
  it('Windows SMTC 的 AUMID 也能认', () => {
    expect(sourceName('cloudmusic.exe')).toBe('网易云音乐');
    expect(sourceName('Spotify.exe')).toBe('Spotify');
    expect(sourceName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify')).toBe('Spotify');
    expect(sourceName('QQMusic.exe')).toBe('QQ 音乐');
    expect(sourceName('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic')).toBe('媒体播放器');
    expect(sourceName('weird.exe')).toBe('');
  });
  it('来源字段去控制字符、限长', () => {
    expect(cleanSource(' 微信\u0000读书 ')).toBe('微信读书');
    expect(cleanSource('x'.repeat(100)).length).toBe(40);
  });
});

describe('v0.22 收件箱解析', () => {
  it('原生 ULID 与 JS 同格式，时间可还原', () => {
    const u = kotlinUlid(T0);
    expect(isUlid(u)).toBe(true);
    expect(ulidTime(u)).toBe(T0);
    expect(ulid(T0).slice(0, 10)).toBe(u.slice(0, 10));
  });
  it('坏 JSON、缺 uid、未知类型都丢掉', () => {
    expect(parseInbox('')).toEqual([]);
    expect(parseInbox('{oops')).toEqual([]);
    expect(parseInbox('{"a":1}')).toEqual([]);
    const ok = { uid: kotlinUlid(T0), createdAt: T0, kind: 'note', text: 'hi' };
    const r = parseInbox(JSON.stringify([ok, { uid: 'nope', kind: 'note' }, { uid: kotlinUlid(T0), kind: 'weird' }, null, 3]));
    expect(r).toHaveLength(1);
    expect(r[0].uid).toBe(ok.uid);
  });
});

describe('v0.22 收件箱条目 → 穗', () => {
  const base = { uid: kotlinUlid(T0), createdAt: T0 };
  it('0001 分享链接：保留为什么、面板上点的标签和来源', () => {
    const d = inboxToDraft({ ...base, kind: 'share', text: '好歌 https://music.163.com/song?id=1', subject: '', why: '副歌那一下', tags: ['夜'], source: '网易云音乐', sourcePkg: 'com.netease.cloudmusic' })!;
    expect(d.url).toBe('https://music.163.com/song?id=1');
    expect(d.type).toBe('music');
    expect(d.why).toBe('副歌那一下');
    expect(d.tags).toEqual(expect.arrayContaining(['分享', '夜']));
    expect(d.source).toBe('网易云音乐');
  });
  it('分享图片带上原图', () => {
    const d = inboxToDraft({ ...base, kind: 'share', subject: '海报', image: true }, JPEG)!;
    expect(d.type).toBe('image');
    expect(d.image).toBe(JPEG);
    expect(d.title).toBe('海报');
  });
  it('0002 / 0057 选字菜单：收成摘抄（文案类型 + 摘抄标签），作者留空，来源从包名补', () => {
    const d = inboxToDraft({ ...base, kind: 'quote', text: '「人是为了活着本身而活着的。」', sourcePkg: 'com.tencent.weread' })!;
    expect(d.type).toBe('text');
    expect(d.content).toBe('人是为了活着本身而活着的。');
    expect(d.creator).toBe('');
    expect(d.tags).toEqual(['摘抄']);
    expect(d.source).toBe('微信读书');
    // 短句也强制是摘抄，不会被猜成「想法」
    expect(inboxToDraft({ ...base, kind: 'quote', text: '短' })!.type).toBe('text');
    expect(inboxToDraft({ ...base, kind: 'quote', text: '   ' })).toBeNull();
  });
  it('0010 正在播放：音乐穗，歌手进 creator，专辑进内容，封面进原图', () => {
    const d = inboxToDraft({ ...base, kind: 'music', title: '晴天', artist: '周杰伦', album: '叶惠美', source: 'QQ 音乐', image: true }, JPEG)!;
    expect(d).toMatchObject({ type: 'music', title: '晴天', creator: '周杰伦', content: '专辑《叶惠美》', source: 'QQ 音乐', image: JPEG });
    expect(d.tags).toContain('正在听');
    expect(inboxToDraft({ ...base, kind: 'music', title: '' })).toBeNull();
  });
  it('通知栏 / 磁贴的随手一句与粘贴拾走速记解析', () => {
    expect(inboxToDraft({ ...base, kind: 'note', text: '雨天的公交站 #城市' })).toMatchObject({ type: 'idea', title: '雨天的公交站', tags: ['城市'] });
    expect(inboxToDraft({ ...base, kind: 'paste', text: 'https://www.bilibili.com/video/BV1xx' })!.url).toBe('https://www.bilibili.com/video/BV1xx');
    expect(inboxToDraft({ ...base, kind: 'note', text: '' })).toBeNull();
  });
});

describe('v0.22 收进穗仓（drainInbox）', () => {
  it('逐条入库：保留原生 uid 与按「存」的时间，盖 v0.21 的 updatedAt / deviceId，成功后 ack', async () => {
    const d = new LinganDB(uniq('cap'));
    const a: InboxEntry = { uid: kotlinUlid(T0), createdAt: T0, kind: 'quote', text: '一句话', source: '微信读书' };
    const b: InboxEntry = { uid: kotlinUlid(T0 + 5000), createdAt: T0 + 5000, kind: 'music', title: '晴天', artist: '周杰伦', image: true };
    const box = fakeInbox([a, b], { [b.uid]: JPEG });
    const before = Date.now();
    const r = await drainInbox(d, box.bridge);
    expect(r.added).toHaveLength(2);
    expect(box.box.size).toBe(0);
    expect(box.acked).toEqual([a.uid, b.uid]);
    const rows = await d.items.orderBy('createdAt').toArray();
    expect(rows.map((x) => x.uid)).toEqual([a.uid, b.uid]);
    expect(rows[0].createdAt).toBe(T0);
    expect(rows[0].updatedAt).toBeGreaterThanOrEqual(before);
    expect(rows[0].deviceId).toBeTruthy();
    expect(rows[0].source).toBe('微信读书');
    expect(rows[1].hasImage).toBe(1);
    expect(await d.images.get(rows[1].id!)).toBeTruthy();
    d.close();
  });
  it('同一个 uid 已在库里（上次没来得及 ack）：不重复，只 ack', async () => {
    const d = new LinganDB(uniq('cap'));
    const e: InboxEntry = { uid: kotlinUlid(T0), createdAt: T0, kind: 'note', text: '只收一次' };
    await drainInbox(d, fakeInbox([e]).bridge);
    const again = fakeInbox([e]);
    const r = await drainInbox(d, again.bridge);
    expect(r.added).toHaveLength(0);
    expect(r.dup).toBe(1);
    expect(again.acked).toEqual([e.uid]);
    expect(await d.items.count()).toBe(1);
    d.close();
  });
  it('并发触发（focus + visibilitychange）只收一遍', async () => {
    const d = new LinganDB(uniq('cap'));
    const box = fakeInbox([{ uid: kotlinUlid(T0), createdAt: T0, kind: 'note', text: '并发' }]);
    const [r1, r2] = await Promise.all([drainInbox(d, box.bridge), drainInbox(d, box.bridge)]);
    expect(r1.added.length + r2.added.length).toBe(1);
    expect(await d.items.count()).toBe(1);
    d.close();
  });
  it('收不成穗的条目 ack 掉；写库失败的留在收件箱下次再试', async () => {
    const d = new LinganDB(uniq('cap'));
    const bad: InboxEntry = { uid: kotlinUlid(T0), createdAt: T0, kind: 'note', text: '   ' };
    const good: InboxEntry = { uid: kotlinUlid(T0 + 1), createdAt: T0 + 1, kind: 'note', text: '好的' };
    const box = fakeInbox([bad, good]);
    const spy = vi.spyOn(d.items, 'add').mockRejectedValueOnce(new Error('quota'));
    const r = await drainInbox(d, box.bridge);
    expect(r.bad).toBe(1);
    expect(r.added).toHaveLength(0);
    expect(box.box.has(good.uid)).toBe(true);
    spy.mockRestore();
    const r2 = await drainInbox(d, box.bridge);
    expect(r2.added).toHaveLength(1);
    expect(box.box.size).toBe(0);
    d.close();
  });
  it('将来时间 / 坏时间不当真：退回现在', async () => {
    const d = new LinganDB(uniq('cap'));
    const now = Date.now();
    await drainInbox(d, fakeInbox([{ uid: kotlinUlid(T0), createdAt: now + 86400000 * 30, kind: 'note', text: '未来' }]).bridge);
    const it0 = (await d.items.toArray())[0];
    expect(it0.createdAt).toBeLessThanOrEqual(Date.now());
    expect(it0.createdAt).toBeGreaterThanOrEqual(now);
    d.close();
  });
  it('没桥（浏览器 / Windows）什么都不做', async () => {
    const d = new LinganDB(uniq('cap'));
    expect(await drainInbox(d, null)).toEqual({ added: [], dup: 0, bad: 0 });
    d.close();
  });
});

describe('v0.22 面板快捷标签（0056）', () => {
  it('最近 20 穗里最常用的 3 个，自动标签不算，墓碑不算', () => {
    const mk = (tags: string[], t: number, del = false) => ({ tags, createdAt: t, deletedAt: del ? t : undefined });
    const items = [mk(['夜', '分享'], 10), mk(['夜', '雨'], 9), mk(['雨'], 8), mk(['摘抄', '书'], 7), mk(['城市'], 6), mk(['夜', '废'], 11, true)];
    expect(recentTags(items)).toEqual(['夜', '雨', '书']);
    expect(recentTags([])).toEqual([]);
  });
  it('收完写给原生面板', async () => {
    const d = new LinganDB(uniq('cap'));
    await addItem({ type: 'idea', title: 'a', tags: ['夜'] }, d);
    await addItem({ type: 'idea', title: 'b', tags: ['夜', '雨'] }, d);
    const box = fakeInbox([]);
    expect(await pushHints(d, box.bridge)).toEqual(['夜', '雨']);
    expect(JSON.parse(box.hints())).toEqual({ tags: ['夜', '雨'] });
    d.close();
  });
});

describe('v0.22 正在播放', () => {
  it('解析安卓 JSON / Windows 对象，没标题 = 没在放', () => {
    expect(parseNowPlaying('')).toBeNull();
    expect(parseNowPlaying('{bad')).toBeNull();
    expect(parseNowPlaying({ title: '  ' })).toBeNull();
    const a = parseNowPlaying(JSON.stringify({ title: '晴天', artist: '周杰伦', album: '叶惠美', pkg: 'com.tencent.qqmusic', app: '', image: JPEG }))!;
    expect(a).toEqual({ title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'QQ 音乐', image: JPEG });
    const w = parseNowPlaying({ title: 'Song', artist: 'X', album: '', app: 'Spotify.exe', image: null })!;
    expect(w.app).toBe('Spotify');
    expect(w.image).toBeUndefined();
    // 非图片的 data URL 不收
    expect(parseNowPlaying({ title: 't', image: 'javascript:alert(1)' })!.image).toBeUndefined();
  });
  it('变成音乐穗草稿', () => {
    expect(nowPlayingDraft({ title: '晴天', artist: '周杰伦', album: '', app: '网易云音乐' })).toMatchObject({ type: 'music', title: '晴天', creator: '周杰伦', content: '', source: '网易云音乐', tags: ['正在听'] });
  });
  it('平台探测：安卓桥 / Tauri+Windows / 都没有', () => {
    expect(nowPlayingSupport({ LinganNowPlaying: { read: () => '', status: () => 'ok', openAccess: () => true } })).toBe('android');
    expect(nowPlayingSupport({})).toBeNull();
  });
});

describe('v0.22 常驻通知权限（0556：先说明再请求）', () => {
  function fakeNotify(sequence: Array<{ perm: string; last?: string }>, grantable = true) {
    let i = 0;
    let on = false;
    const calls: string[] = [];
    return {
      calls,
      b: {
        status: () => JSON.stringify({ ...sequence[Math.min(i, sequence.length - 1)], on }),
        request: () => {
          calls.push('request');
          i++;
          return grantable;
        },
        setOn: (v: boolean) => {
          on = v;
          return true;
        },
        openSettings: () => true,
      },
    };
  }
  it('读状态，坏 JSON 返回 null', () => {
    expect(readNotify({ status: () => 'x', request: () => true, setOn: () => true, openSettings: () => true })).toBeNull();
    expect(readNotify(fakeNotify([{ perm: 'granted' }]).b)).toEqual({ perm: 'granted', on: false, last: '' });
  });
  it('已允许不再弹框；被拒「不再询问」直接 blocked', async () => {
    const g = fakeNotify([{ perm: 'granted' }]);
    expect(await requestNotify(g.b, 1000, 5)).toBe('granted');
    expect(g.calls).toEqual([]);
    const bl = fakeNotify([{ perm: 'blocked' }]);
    expect(await requestNotify(bl.b, 1000, 5)).toBe('blocked');
    expect(bl.calls).toEqual([]);
  });
  it('弹框后轮询原生记下的结果', async () => {
    const ok = fakeNotify([{ perm: 'ask' }, { perm: 'ask' }, { perm: 'granted', last: 'granted' }]);
    // request 让序号 +1 到 ask，再手动推进到 granted
    const p = requestNotify(ok.b, 2000, 5);
    setTimeout(() => ok.b.request(), 20);
    expect(await p).toBe('granted');
    const no = fakeNotify([{ perm: 'ask' }, { perm: 'ask', last: 'denied' }]);
    expect(await requestNotify(no.b, 1000, 5)).toBe('denied');
    const tm = fakeNotify([{ perm: 'ask' }, { perm: 'ask' }]);
    expect(await requestNotify(tm.b, 40, 5)).toBe('timeout');
  });
});

describe('v0.22 草稿永不丢（0025）', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.useRealTimers();
  });
  it('存 / 读 / 清，空白不存，7 天以前的不恢复', () => {
    saveDraft('quick', '写到一半', T0);
    expect(loadDraft('quick', T0 + 1000)).toBe('写到一半');
    expect(loadDraft('quick', T0 + 8 * 86400000)).toBe('');
    expect(store.size).toBe(0);
    saveDraft('quick', '   ');
    expect(store.size).toBe(0);
    saveDraft('quick', 'x');
    clearDraft('quick');
    expect(loadDraft('quick')).toBe('');
  });
  it('防抖 500ms 写；flush 立刻落盘；cancel 不写', () => {
    vi.useFakeTimers();
    const w = draftWriter('t', 500);
    w.write('a');
    w.write('ab');
    expect(loadDraft('t')).toBe('');
    vi.advanceTimersByTime(499);
    expect(loadDraft('t')).toBe('');
    vi.advanceTimersByTime(1);
    expect(loadDraft('t')).toBe('ab');
    w.write('abc');
    w.flush();
    expect(loadDraft('t')).toBe('abc');
    w.write('zzz');
    w.cancel();
    vi.advanceTimersByTime(1000);
    expect(loadDraft('t')).toBe('abc');
  });
  it('存储不可用时不抛', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => saveDraft('q', 'x')).not.toThrow();
    expect(loadDraft('q')).toBe('');
    expect(() => clearDraft('q')).not.toThrow();
  });
});

describe('v0.22 长按图标快捷方式', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });
  it('takeGo 只认 daily / library / settings', () => {
    let v = 'daily';
    (globalThis as { window?: unknown }).window = { LinganShare: { go: () => v } };
    expect(takeGo()).toBe('daily');
    v = 'javascript:';
    expect(takeGo()).toBe('');
  });
});
