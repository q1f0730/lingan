// v0.33 系统入口：glean:// 深链接、剪贴板敏感内容、热键串、外链判断
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { itemLink, parseLink, routeLink, type LinkCtx } from '../lib/deeplink';
import { looksSensitive, shouldOffer } from '../lib/quick';
import { keyFromEvent, prettyKey } from '../lib/entry';
import { externalHref } from '../lib/entryboot';
import { addItem, db } from '../lib/db';
import { defaultSettings } from '../lib/settings';
import type { Item } from '../lib/types';

describe('0510 parseLink', () => {
  it('capture with text / url / why / tags', () => {
    const l = parseLink('glean://capture?text=' + encodeURIComponent('夜车上的一句话') + '&url=https%3A%2F%2Fexample.com%2Fa&why=%E5%A5%BD&tags=%E5%A4%9C,%23%E8%BD%A6');
    expect(l).toEqual({ k: 'capture', text: '夜车上的一句话', url: 'https://example.com/a', why: '好', title: '', tags: ['夜', '车'] });
  });
  it('rejects junk, non-http url, empty capture, other schemes', () => {
    expect(parseLink('https://x.com')).toBeNull();
    expect(parseLink('glean://capture?url=javascript:alert(1)')).toBeNull();
    expect(parseLink('glean://capture')).toBeNull();
    expect(parseLink('glean://item/../../x')).toBeNull();
    expect(parseLink('glean://nope')).toBeNull();
    expect(parseLink('glean://capture?text=' + 'a'.repeat(9000))).toBeNull();
    expect(parseLink('glean://item/%E0%A4%A')).toBeNull();
  });
  it('item / graft / search / go / quick, case-insensitive scheme', () => {
    expect(parseLink('GLEAN://item/01HZY3K9V7Q2W8E5R6T4Y1U0IO')).toEqual({ k: 'item', uid: '01HZY3K9V7Q2W8E5R6T4Y1U0IO' });
    expect(parseLink('glean://graft?ids=01HZY3K9V7Q2W8E5R6T4Y1U0IO,bad!,01HZY3K9V7Q2W8E5R6T4Y1U0IP')).toEqual({ k: 'graft', uids: ['01HZY3K9V7Q2W8E5R6T4Y1U0IO', '01HZY3K9V7Q2W8E5R6T4Y1U0IP'] });
    expect(parseLink('glean://graft?ids=')).toBeNull();
    expect(parseLink('glean://search?q=%E9%BB%84%E6%98%8F')).toEqual({ k: 'search', q: '黄昏' });
    expect(parseLink('glean://go/daily')).toEqual({ k: 'go', v: 'daily' });
    expect(parseLink('glean://go/hack')).toBeNull();
    expect(parseLink('glean://quick?text=hi')).toEqual({ k: 'quick', text: 'hi' });
    expect(itemLink('01ABCDEFGHJK')).toBe('glean://item/01ABCDEFGHJK');
  });
});

function ctx(): LinkCtx & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    settings: defaultSettings(),
    openItem: (it: Item) => log.push('open:' + it.title),
    developFrom: (ids: number[]) => log.push('graft:' + ids.length),
    toast: (m: string, k?: string) => log.push((k || 'ok') + ':' + m),
    goTo: (v: string) => log.push('go:' + v),
    quick: (t: string) => log.push('quick:' + t),
  };
}

describe('0510 routeLink', () => {
  it('opens items by uid, grafts, captures, and refuses unknown', async () => {
    const a = await addItem({ type: 'text', title: '空房间', content: '', creator: '', year: '', url: '', why: '', tags: [] }, db);
    const b = await addItem({ type: 'text', title: '末班车', content: '', creator: '', year: '', url: '', why: '', tags: [] }, db);
    const ua = (await db.items.get(a))!.uid!;
    const ub = (await db.items.get(b))!.uid!;
    const c = ctx();
    await routeLink(itemLink(ua), c);
    await routeLink(`glean://graft?ids=${ua},${ub}`, c);
    await routeLink('glean://item/01HZY3K9V7Q2W8E5R6T4Y1U0ZZ', c);
    await routeLink('glean://go/settings', c);
    await routeLink('glean://what', c);
    await routeLink('glean://capture?text=' + encodeURIComponent('雨夜的霓虹') + '&why=%E5%83%8F%E7%94%B5%E5%BD%B1&tags=%E5%A4%9C', c);
    expect(c.log.slice(0, 5)).toEqual(['open:空房间', 'graft:2', 'err:这一穗不在这台设备上', 'go:settings', 'err:认不出这个 glean:// 链接']);
    const got = (await db.items.toArray()).find((x) => x.title.includes('雨夜的霓虹'));
    expect(got?.why).toBe('像电影');
    expect(got?.tags).toContain('夜');
  });
});

describe('0018 / 0514 looksSensitive', () => {
  it('flags codes and password-like strings', () => {
    for (const t of ['482913', '【某银行】您的验证码是 739201，5 分钟内有效', 'Your verification code is 8821', 'Tr0ub4dor&3x!', 'aB3$kLm9_pQ'])
      expect(looksSensitive(t), t).toBe(true);
  });
  it('leaves normal clips alone', () => {
    for (const t of ['海边的卡夫卡', 'https://music.163.com/song?id=5257138', '2024 年最好的十张专辑', 'Hello World', 'github.com/User1/Repo-2', '123', '12345678901'])
      expect(looksSensitive(t), t).toBe(false);
    expect(shouldOffer('739201', null, [])).toBe(false);
    expect(shouldOffer('海边的卡夫卡', null, [])).toBe(true);
  });
});

describe('0515 hotkey strings', () => {
  it('builds and prettifies accelerators', () => {
    expect(keyFromEvent({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: 'L', code: 'KeyL' })).toBe('ctrl+shift+l');
    expect(keyFromEvent({ ctrlKey: false, shiftKey: false, altKey: true, metaKey: false, key: '3', code: 'Digit3' })).toBe('alt+3');
    expect(keyFromEvent({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: 'Control', code: 'ControlLeft' })).toBe('');
    expect(prettyKey('ctrl+shift+l')).toBe('Ctrl+Shift+L');
    expect(prettyKey('alt+f2')).toBe('Alt+F2');
  });
});

describe('0520 externalHref', () => {
  const a = (href: string) => ({ href }) as HTMLAnchorElement;
  it('only external http(s)', () => {
    expect(externalHref(a('https://music.163.com/song?id=1'), 'http://tauri.localhost')).toBe('https://music.163.com/song?id=1');
    expect(externalHref(a('http://tauri.localhost/x'), 'http://tauri.localhost')).toBe('');
    expect(externalHref(a('blob:http://tauri.localhost/abc'), 'http://tauri.localhost')).toBe('');
    expect(externalHref(a('mailto:a@b.c'), 'http://tauri.localhost')).toBe('');
    expect(externalHref(null, 'x')).toBe('');
  });
});
