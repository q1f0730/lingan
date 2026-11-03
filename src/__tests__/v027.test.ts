import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildDrafts, dropSummary, fileTitle, isImageFile, isOutsideDrag, MAX_DROP, planTransfer, TEXT_FILE_MAX } from '../lib/dropin';
import { applyTag, countTags, existingTags, suggestTags, tagQueryAt } from '../lib/tagsuggest';
import { keyboardInset, parseInsets, resizedByKeyboard, THEME_BG } from '../lib/chrome';
import { nextType } from '../lib/quick';
import { placeMenu } from '../components/CardMenu';
import { TYPE_ORDER } from '../lib/types';

const F = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('v0.27 粘贴 / 拖放成穗（0405 0406 0407）', () => {
  it('图片、小文本文件收，其它文件跳过', () => {
    const r = planTransfer({ files: [F('a.png', 'image/png'), F('notes.md', ''), F('x.pdf', 'application/pdf'), F('big.txt', 'text/plain', TEXT_FILE_MAX + 1)], uris: [], text: 'a.png' });
    expect(r.steps).toEqual([
      { kind: 'image', index: 0 },
      { kind: 'textfile', index: 1 },
    ]);
    expect(r.skipped).toBe(2);
  });
  it('有文件时忽略浏览器塞进来的文件名文字', () => {
    expect(planTransfer({ files: [F('shot.jpg', 'image/jpeg')], uris: [], text: 'shot.jpg' }).steps).toHaveLength(1);
  });
  it('拖链接：uri-list 和 text 是同一个地址只收一次；多个链接各成一穗', () => {
    expect(planTransfer({ files: [], uris: ['https://a.com/x'], text: 'https://a.com/x' }).steps).toEqual([{ kind: 'text', text: 'https://a.com/x' }]);
    expect(planTransfer({ files: [], uris: ['https://a.com/x'], text: '一篇文章' }).steps).toEqual([{ kind: 'text', text: '一篇文章 https://a.com/x' }]);
    expect(planTransfer({ files: [], uris: ['https://a.com', 'https://b.com', 'ftp://c'], text: '' }).steps).toHaveLength(2);
    expect(planTransfer({ files: [], uris: [], text: '   ' }).steps).toHaveLength(0);
  });
  it('一次最多 20 穗，多出来的算跳过', () => {
    const files = Array.from({ length: 25 }, (_, i) => F(`p${i}.png`, 'image/png'));
    const r = planTransfer({ files, uris: [], text: '' });
    expect(r.steps).toHaveLength(MAX_DROP);
    expect(r.skipped).toBe(5);
  });
  it('认图片：看 MIME，没有 MIME 看扩展名；SVG 不收', () => {
    expect(isImageFile(F('a.webp', 'image/webp'))).toBe(true);
    expect(isImageFile(F('a.JPG', ''))).toBe(true);
    expect(isImageFile(F('a.svg', 'image/svg+xml'))).toBe(false);
  });
  it('生成草稿：图片用说明或文件名当标题，剪贴板截图叫「粘贴的图片」；文本文件成文案', async () => {
    const files = [new File(['x'], 'image.png', { type: 'image/png' }), new File(['第一行\r\n第二行'], '读书笔记.md', { type: '' }), new File(['x'], '海边.jpg', { type: 'image/jpeg' }), new File(['  '], 'empty.txt', { type: 'text/plain' })];
    const steps = planTransfer({ files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })), uris: [], text: '' }).steps;
    const { drafts, failed } = await buildDrafts(steps, files, { compress: async () => 'data:image/jpeg;base64,AA', readText: (f) => f.text() });
    expect(drafts.map((d) => [d.type, d.title])).toEqual([
      ['image', '粘贴的图片'],
      ['text', '读书笔记'],
      ['image', '海边'],
    ]);
    expect(drafts[1].content).toBe('第一行\n第二行');
    expect(failed).toBe(1);
    const cap = await buildDrafts([{ kind: 'image', index: 0 }], files, { compress: async () => 'data:,', readText: async () => '', caption: '雾里的轮渡' });
    expect(cap.drafts[0].title).toBe('雾里的轮渡');
  });
  it('文字走速记识别：链接认类型、#标签变标签', async () => {
    const { drafts } = await buildDrafts([{ kind: 'text', text: 'https://music.163.com/song?id=1 #夜' }], [], { compress: async () => '', readText: async () => '' });
    expect(drafts[0].type).toBe('music');
    expect(drafts[0].tags).toEqual(['夜']);
  });
  it('只认外面拖进来的；页面里自己拖的不算', () => {
    expect(isOutsideDrag(['Files'], false)).toBe(true);
    expect(isOutsideDrag(['text/uri-list', 'text/plain'], false)).toBe(true);
    expect(isOutsideDrag(['Files'], true)).toBe(false);
    expect(isOutsideDrag(['text/html'], false)).toBe(false);
    expect(isOutsideDrag(null, false)).toBe(false);
  });
  it('提示文案与文件名标题', () => {
    expect(dropSummary(2, 1, 0)).toBe('已拾 2 穗 · 跳过 1 个（只收图片、文字和 .txt / .md）');
    expect(dropSummary(0, 0, 1)).toBe('没拾到东西 · 1 个没读出来');
    expect(fileTitle('毕业设计参考.v2.png')).toBe('毕业设计参考.v2');
    expect(fileTitle('.png')).toBe('无题');
  });
});

describe('v0.27 #标签补全（0413）', () => {
  const counts = new Map([
    ['夜车', 9],
    ['夜晚', 3],
    ['雨夜', 5],
    ['城市', 7],
    ['Lo-Fi', 2],
  ]);
  it('光标前的 #词 是查询；空 # 也给常用的', () => {
    expect(tagQueryAt('末班车 #夜', 7)).toEqual({ start: 4, end: 6, q: '夜', hash: true });
    expect(tagQueryAt('#', 1)).toEqual({ start: 0, end: 1, q: '', hash: true });
    expect(tagQueryAt('没有标签', 4)).toBeNull();
  });
  it('网址里的 # 不当标签', () => {
    expect(tagQueryAt('https://a.com/#top', 18)).toBeNull();
  });
  it('bare 模式：标签栏里光标所在那个词', () => {
    expect(tagQueryAt('城市 夜', 4, true)).toEqual({ start: 3, end: 4, q: '夜', hash: false });
    expect(tagQueryAt('城市，', 3, true)).toEqual({ start: 3, end: 3, q: '', hash: false });
  });
  it('前缀命中排前面，再按次数；已填的不给；忽略大小写', () => {
    expect(suggestTags('夜', counts)).toEqual(['夜车', '夜晚', '雨夜']);
    expect(suggestTags('夜', counts, ['夜车'])).toEqual(['夜晚', '雨夜']);
    expect(suggestTags('lo', counts)).toEqual(['Lo-Fi']);
    expect(suggestTags('', counts, [], 2)).toEqual(['夜车', '城市']);
    expect(suggestTags('夜车', counts)).toEqual([]);
  });
  it('填回去：替换整个词，后面补空格，光标落在空格后', () => {
    const q = tagQueryAt('末班车 #夜 好', 6)!;
    expect(applyTag('末班车 #夜 好', q, '夜车')).toEqual({ text: '末班车 #夜车 好', caret: 8 });
    const b = tagQueryAt('城市 夜', 4, true)!;
    expect(applyTag('城市 夜', b, '夜车')).toEqual({ text: '城市 夜车 ', caret: 6 });
  });
  it('已填的标签、用量统计（回收站里的不算）', () => {
    expect(existingTags('a #夜车 b #城市', false)).toEqual(['夜车', '城市']);
    expect(existingTags('夜车, 城市、雨', true)).toEqual(['夜车', '城市', '雨']);
    const m = countTags([{ tags: ['a', 'b'] }, { tags: ['a'] }, { tags: ['a'], deletedAt: 1 }]);
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(1);
  });
});

describe('v0.27 外框：键盘 / 安全区 / 主题（0401 0410 0416）', () => {
  it('键盘高度：小于 80 当没开（地址栏伸缩之类）', () => {
    expect(keyboardInset(800, 460, 0)).toBe(340);
    expect(keyboardInset(800, 760, 0)).toBe(0);
    expect(keyboardInset(800, 460, 40)).toBe(300);
  });
  it('布局视口自己缩了 150 以上 = 键盘开着', () => {
    expect(resizedByKeyboard(500, 800)).toBe(true);
    expect(resizedByKeyboard(760, 800)).toBe(false);
  });
  it('原生安全区：数字取整，坏值归零，坏 JSON 返回 null', () => {
    expect(parseInsets('{"t":24.6,"b":16,"l":0,"r":0}')).toEqual({ t: 25, b: 16, l: 0, r: 0 });
    expect(parseInsets('{"t":-3,"b":"x","l":9999}')).toEqual({ t: 0, b: 0, l: 0, r: 0 });
    expect(parseInsets('nope')).toBeNull();
    expect(parseInsets('')).toBeNull();
  });
  it('状态栏底色和页面底色一致', () => {
    expect(THEME_BG).toEqual({ light: '#f7f5f1', dark: '#17161a' });
  });
});

describe('v0.27 速记类型小标 / 上下文菜单（0412 0411）', () => {
  it('点一下换下一种，转一圈回来', () => {
    let t = TYPE_ORDER[0];
    for (let i = 0; i < TYPE_ORDER.length; i++) t = nextType(t);
    expect(t).toBe(TYPE_ORDER[0]);
    expect(nextType('music')).toBe('film');
  });
  it('菜单贴着点的位置，不出屏幕；底下放不下就往上翻', () => {
    expect(placeMenu(100, 100, 180, 240, 1440, 900)).toEqual({ left: 100, top: 100 });
    expect(placeMenu(1400, 100, 180, 240, 1440, 900).left).toBe(1440 - 180 - 8);
    expect(placeMenu(100, 800, 180, 240, 1440, 900).top).toBe(560);
    expect(placeMenu(2, 2, 180, 240, 1440, 900)).toEqual({ left: 8, top: 8 });
  });
});
