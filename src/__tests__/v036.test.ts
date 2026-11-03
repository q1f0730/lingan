// v0.36 系统能力接进来：浏览器扩展（0008 / 0009 / 0042）、glean://capture 带图、图中文字进秒搜（0020）、说一句就收、统一通知（0519 / 0527）
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { captureUrl, cleanTitle, encFrag, fmtTime, fragmentUrl, isVideoPage, menuToLink, timeUrl } from '../../extension/lib.js';
import { parseLink } from '../lib/deeplink';
import { FIELD_LABEL, itemFields, parseQuery, searchDocs, toDoc } from '../lib/search';
import type { Item } from '../lib/types';
import { cleanOcr } from '../lib/ocr';
import { hasVoice, hold, letGo, voiceBridge, voiceErr, type VoiceBridge } from '../lib/voice';
import { inBackground, notify } from '../lib/sysnotify';

describe('0008 拾这一句：Text Fragment 链接', () => {
  it('短句整句、长句开头 + 结尾，- 和 , 要转义', () => {
    expect(fragmentUrl('https://example.com/a?x=1#old', '一个人坐末班车')).toBe('https://example.com/a?x=1#:~:text=' + encodeURIComponent('一个人坐末班车'));
    expect(encFrag('a-b,c&d')).toBe('a%2Db%2Cc%26d');
    const long = '甲'.repeat(30) + '中间很长的一段' + '乙'.repeat(40);
    const u = fragmentUrl('https://example.com/', long);
    expect(u).toBe(`https://example.com/#:~:text=${encFrag('甲'.repeat(20))},${encFrag('乙'.repeat(20))}`);
    expect(fragmentUrl('chrome://settings', 'x')).toBe('chrome://settings');
  });
  it('右键「拾这一句」→ glean://capture，App 解析出摘抄 + 原句链接', () => {
    const link = menuToLink('sel', { pageUrl: 'https://example.com/post', selectionText: '雨夜的霓虹 - 像电影' }, { title: '一篇文章' });
    const l = parseLink(link);
    expect(l).toMatchObject({ k: 'capture', text: '雨夜的霓虹 - 像电影', tags: ['摘抄'], img: '', clip: false });
    expect(l && l.k === 'capture' && l.url).toBe('https://example.com/post#:~:text=' + encFrag('雨夜的霓虹 - 像电影'));
  });
});

describe('0009 视频当前时间点', () => {
  it('B 站 ?t=秒、YouTube &t=秒s，去追踪参数', () => {
    expect(timeUrl('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1&vd_source=abc', 192.7)).toBe('https://www.bilibili.com/video/BV1xx411c7mD/?t=192');
    expect(timeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz', 61)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=61s');
    expect(fmtTime(192)).toBe('3:12');
    expect(fmtTime(3723)).toBe('1:02:03');
    expect(isVideoPage('https://www.bilibili.com/video/BV1')).toBe(true);
    expect(isVideoPage('https://www.youtube.com/watch?v=1')).toBe(true);
    expect(isVideoPage('https://example.com/video/1')).toBe(false);
    expect(cleanTitle('花样年华 4K 修复_哔哩哔哩_bilibili')).toBe('花样年华 4K 修复');
    expect(cleanTitle('(3) Lofi Girl - YouTube')).toBe('Lofi Girl');
  });
  it('带上这一帧（剪贴板）= clip=1；截不到只给时间码', () => {
    const tab = { title: '花样年华 4K 修复_哔哩哔哩_bilibili', url: 'https://www.bilibili.com/video/BV1xx411c7mD' };
    const a = parseLink(menuToLink('time', {}, tab, { t: 192, url: tab.url, frame: true }));
    expect(a).toMatchObject({ k: 'capture', title: '花样年华 4K 修复 · 3:12', url: 'https://www.bilibili.com/video/BV1xx411c7mD?t=192', clip: true });
    const b = parseLink(menuToLink('time', {}, tab, { t: 5, url: tab.url, frame: false }));
    expect(b).toMatchObject({ clip: false });
  });
});

describe('0042 拾这张图 + 链接长度', () => {
  it('img 只收 http(s)，没有文字也算一穗', () => {
    const l = parseLink(menuToLink('img', { pageUrl: 'https://example.com/p', srcUrl: 'https://img.example.com/a.jpg' }, { title: '展览' }));
    expect(l).toMatchObject({ k: 'capture', img: 'https://img.example.com/a.jpg', url: 'https://example.com/p', title: '展览' });
    expect(parseLink('glean://capture?img=javascript:alert(1)')).toBeNull();
    const big = captureUrl({ text: '字'.repeat(5000), url: 'https://example.com/' + 'a'.repeat(3000) });
    expect(big.length).toBeLessThanOrEqual(8192);
    expect(parseLink(big)).not.toBeNull();
  });
});

describe('0020 图中文字进秒搜', () => {
  it('ocr 字段进索引，标签叫「图中文字」', () => {
    const f = itemFields({ title: '一张截图', creator: '', year: '', content: '', why: '', tags: [], url: '', ocr: '拾穗 · 灵感收集\n第二行' });
    expect(f.find((x) => x.f === 'ocr')?.text).toContain('拾穗');
    expect(FIELD_LABEL.ocr).toBe('图中文字');
    const it = { id: 1, type: 'image', title: '一张截图', tags: [], createdAt: 1, ocr: '拾穗 · 灵感收集' } as unknown as Item;
    const hits = searchDocs(null, [toDoc('i', it)], parseQuery('灵感'));
    expect(hits.length).toBe(1);
    expect(hits[0].fields.some((x) => x.f === 'ocr')).toBe(true);
  });
  it('cleanOcr 压空白、去空行、限长', () => {
    expect(cleanOcr('  第一行  有\u3000空白 \n\n 第二行 ')).toBe('第一行 有 空白\n第二行');
    expect(cleanOcr('字'.repeat(9000)).length).toBe(8000);
    expect(cleanOcr('')).toBe('');
  });
});

describe('说一句就收', () => {
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => {
    delete g.window;
  });
  it('错误码翻成人话：断网说清楚', () => {
    expect(voiceErr(2)).toContain('没网');
    expect(voiceErr(7)).toContain('没听清');
    expect(voiceErr(9)).toContain('麦克风');
    expect(voiceErr(99)).toContain('99');
  });
  it('有桥 / 桌面版才显示「说」', () => {
    expect(hasVoice({})).toBe(false);
    expect(hasVoice({ LinganVoice: { start: () => '' } })).toBe(true);
    expect(hasVoice({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(hasVoice({ __TAURI_INTERNALS__: {}, LinganShare: {} })).toBe(false);
    expect(voiceBridge({ LinganVoice: 1 })).toBeNull();
  });
  it('按住 → 松手 → 拿到文字；断网报错', async () => {
    let st = { state: 'idle', text: '', err: 0 };
    const b: VoiceBridge = {
      start: () => ((st = { state: 'listening', text: '', err: 0 }), 'listening'),
      stop: () => void (st = { state: 'done', text: '雨夜的霓虹像电影', err: 0 }),
      poll: () => JSON.stringify(st),
    };
    g.window = { LinganVoice: b };
    const got: string[] = [];
    const errs: string[] = [];
    await hold(null, (t) => void got.push(t), (m) => void errs.push(m));
    await letGo();
    expect(got).toEqual(['雨夜的霓虹像电影']);
    b.stop = () => void (st = { state: 'error', text: '', err: 2 });
    await hold(null, (t) => void got.push(t), (m) => void errs.push(m));
    await letGo();
    expect(errs[0]).toContain('没网');
    b.start = () => 'none';
    await hold(null, () => {}, (m) => void errs.push(m));
    expect(errs[1]).toContain('没有系统语音识别');
  });
});

describe('0519 / 0527 统一通知', () => {
  it('网页版不发；前台不发', async () => {
    expect(await notify('graft', '新枝长出来了', 'x')).toBe(false);
    expect(inBackground({ visibilityState: 'visible', hasFocus: () => true })).toBe(false);
    expect(inBackground({ visibilityState: 'hidden', hasFocus: () => false })).toBe(true);
    expect(inBackground({ visibilityState: 'visible', hasFocus: () => false })).toBe(true);
  });
});
