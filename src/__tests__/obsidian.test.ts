import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addItem, LinganDB } from '../lib/db';
import { buildVault, exportObsidianZip, imageExt, obsidianTag, safeName, vaultZipName, INDEX_NOTE } from '../lib/obsidian';
import { crc32, makeZip, readZip } from '../lib/zip';
import type { Development, Item } from '../lib/types';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
const dec = new TextDecoder();
const T = new Date(2026, 9, 22, 12, 30, 5).getTime();

/** 极简 YAML 头解析（只认 buildVault 写出的形式：key: "json" / key: 数字布尔 / key: [] / 列表） */
function parseNote(md: string): { fm: Record<string, unknown>; body: string } {
  expect(md.startsWith('---\n')).toBe(true);
  const end = md.indexOf('\n---\n', 4);
  expect(end).toBeGreaterThan(0);
  const fm: Record<string, unknown> = {};
  let listKey = '';
  for (const line of md.slice(4, end).split('\n')) {
    const li = line.match(/^ {2}- (.*)$/);
    if (li) {
      (fm[listKey] as unknown[]).push(JSON.parse(li[1]));
      continue;
    }
    const m = line.match(/^([^:]+): ?(.*)$/);
    expect(m, `bad yaml line: ${line}`).toBeTruthy();
    const [, k, v] = m!;
    if (v === '') {
      fm[k] = [];
      listKey = k;
    } else fm[k] = JSON.parse(v);
  }
  return { fm, body: md.slice(end + 5) };
}

/** 仓库里所有 [[链接]]（含 ![[嵌入]]），去掉 |别名 */
function links(md: string): string[] {
  return [...md.matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]);
}

function vaultFiles(zip: Uint8Array) {
  const entries = readZip(zip);
  const map = new Map(entries.map((e) => [e.path, e]));
  return { entries, map, text: (p: string) => dec.decode(map.get(p)!.data) };
}

/** 每条双链都要落在仓库里真实存在的文件上（笔记省略 .md，附件带扩展名） */
function assertLinksResolve(map: Map<string, unknown>) {
  for (const [p, e] of map) {
    if (!p.endsWith('.md')) continue;
    const md = dec.decode((e as { data: Uint8Array }).data);
    for (const l of links(md)) {
      const ok = map.has(l) || map.has(l + '.md');
      expect(ok, `${p} → [[${l}]] dangles`).toBe(true);
    }
  }
}

const it0 = (o: Partial<Item> & { id: number }): Item => ({ type: 'idea', title: '无题', tags: [], createdAt: T, updatedAt: T, ...o });

describe('zip writer', () => {
  it('round-trips UTF-8 names and binary data with correct CRC', () => {
    const bin = new Uint8Array(70000).map((_, i) => (i * 31) & 0xff);
    const z = makeZip([
      { path: '音乐/晴天.md', data: '# 你好\n' },
      { path: 'attachments/a.jpg', data: bin },
      { path: '音乐/晴天.md', data: 'dup ignored' },
    ]);
    const r = readZip(z);
    expect(r.map((e) => e.path)).toEqual(['音乐/晴天.md', 'attachments/a.jpg']);
    expect(r.every((e) => e.crcOk && e.utf8Flag)).toBe(true);
    expect(dec.decode(r[0].data)).toBe('# 你好\n');
    expect(r[1].data).toEqual(bin);
  });
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('empty zip is still a valid archive', () => {
    expect(readZip(makeZip([]))).toEqual([]);
  });
});

describe('names and helpers', () => {
  it('safeName strips link-breaking and Windows-illegal characters and caps length', () => {
    expect(safeName('A/B: C? [x] #1 ^2 |y|')).toBe('A B C x 1 2 y');
    expect(safeName('  ...  ')).toBe('未命名');
    expect(safeName('CON')).toBe('CON_');
    expect(safeName('字'.repeat(100)).length).toBe(60);
    expect(safeName('结尾点.')).toBe('结尾点');
  });
  it('tags become Obsidian-safe', () => {
    expect(obsidianTag('#city pop')).toBe('city_pop');
    expect(obsidianTag('夜晚！')).toBe('夜晚');
  });
  it('image extensions', () => {
    expect(imageExt('image/png')).toBe('png');
    expect(imageExt('image/jpeg')).toBe('jpg');
    expect(imageExt('')).toBe('jpg');
  });
  it('zip name carries the local date', () => {
    expect(vaultZipName(T)).toBe('glean-obsidian-2026-10-22.zip');
  });
});

describe('buildVault: Obsidian vault structure', () => {
  const items: Item[] = [
    it0({ id: 1, type: 'music', title: '晴天', creator: '周杰伦', year: '2003', tags: ['夏天', 'city pop'], url: 'https://music.example/1', why: '前奏一响就是操场', createdAt: T - 3000 }),
    it0({ id: 2, type: 'film', title: '花样年华', creator: '王家卫', year: '2000', tags: ['旗袍'], createdAt: T - 2000 }),
    it0({ id: 3, type: 'image', title: '雨后的操场', tags: [], hasImage: 1, createdAt: T - 1000 }),
    it0({ id: 4, type: 'text', title: '晴天', content: '# 不是标题\n第二行', createdAt: T - 500 }), // 同名 → 晴天 2
    it0({ id: 5, type: 'music', title: 'Clair de Lune', creator: 'Debussy', tags: [], sample: 1, createdAt: T - 100 }),
  ];
  const devs: Development[] = [
    { id: 10, itemIds: [1, 2, 3, 5], jump: 0.7, source: 'ai', starred: true, evidence: 'ok', batch: { id: 'b1', index: 0, size: 2 }, createdAt: T, idea: { title: '小票上的情书', bridge: '桥', idea: '一本用小票装订的书', form: '手作小书', transform: 'medium', cliches: ['雨夜霓虹'], refs: [1, 2, 4], experiment: '收三张小票', evidence: 'ok' } },
    { id: 11, itemIds: [1, 2, 3, 5], jump: 0.7, source: 'ai', evidence: 'ok', batch: { id: 'b1', index: 1, size: 2 }, createdAt: T + 1, idea: { title: '咳嗽副歌', bridge: '', idea: '循环那声咳嗽', cliches: [], refs: [2, 3, 1] } },
    // 只由示例长出来的：不带示例时不导出
    { id: 12, itemIds: [5, 5, 5], jump: 0.5, source: 'offline', createdAt: T + 2, idea: { title: '月光', bridge: '', idea: '只有示例', cliches: [], refs: [1, 2, 3] } },
    // 有素材被删了（-1 / 不存在的 id）
    { id: 13, itemIds: [4, -1, 999], jump: 0.5, source: 'offline', createdAt: T + 3, idea: { title: '残缺的枝', bridge: '', idea: '素材少了', cliches: [], refs: [1, 3] } },
  ];
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const images = new Map([[3, { bytes: png, mime: 'image/png' }], [5, { bytes: png, mime: 'image/png' }]]);

  const v = buildVault({ items, developments: devs, images, now: T });
  const z = makeZip(v.files, T);
  const { map, text } = vaultFiles(z);

  it('lays out one note per ear, by type folder, plus branches, attachments and an index', () => {
    const paths = [...map.keys()].sort();
    expect(paths).toEqual(
      [
        '.obsidian/app.json',
        'attachments/glean-3.png',
        '图片/雨后的操场.md',
        '拾穗索引.md',
        '文案/晴天 2.md',
        '新枝/咳嗽副歌.md',
        '新枝/小票上的情书.md',
        '新枝/残缺的枝.md',
        '电影/花样年华.md',
        '音乐/晴天.md',
      ].sort(),
    );
    expect(v.stats).toEqual({ items: 4, branches: 3, images: 1, skippedSamples: 1 });
    expect(map.get('attachments/glean-3.png')!.data).toEqual(png);
  });

  it('writes the YAML front matter: 类型 / 作者 / 年份 / 标签 / 来源 / 记录时间', () => {
    const { fm, body } = parseNote(text('音乐/晴天.md'));
    expect(fm['类型']).toBe('音乐');
    expect(fm['作者']).toBe('周杰伦');
    expect(fm['年份']).toBe('2003');
    expect(fm['标签']).toEqual(['夏天', 'city pop']);
    expect(fm['tags']).toEqual(['夏天', 'city_pop']);
    expect(fm['来源']).toBe('https://music.example/1');
    expect(fm['记录时间']).toBe('2026-10-22T12:30:02');
    expect(fm['为什么']).toBe('前奏一响就是操场');
    expect(fm['glean_id']).toBe(1);
    expect(body).toContain('前奏一响就是操场');
    // 反链：这穗长出的两根新枝
    expect(body).toContain('[[新枝/小票上的情书|小票上的情书]]');
    expect(body).toContain('[[新枝/咳嗽副歌|咳嗽副歌]]');
    // 空字段也有键（属性面板一致）
    const film = parseNote(text('电影/花样年华.md')).fm;
    expect(film['来源']).toBe('');
    expect(film['标签']).toEqual(['旗袍']);
  });

  it('embeds images from attachments/ and keeps user text from turning into headings', () => {
    expect(text('图片/雨后的操场.md')).toContain('![[attachments/glean-3.png]]');
    const quote = parseNote(text('文案/晴天 2.md')).body;
    expect(quote).toContain('> \\# 不是标题');
    expect(quote).not.toMatch(/^# 不是标题/m);
  });

  it('branches link back to their source ears with [[wikilinks]] (refs order), siblings linked', () => {
    const { fm, body } = parseNote(text('新枝/小票上的情书.md'));
    expect(fm['类型']).toBe('新枝');
    // refs [1,2,4] → 晴天、花样年华、示例(未导出)；示例写成纯文字，不出现断链
    expect(fm['来源穗']).toEqual(['[[音乐/晴天|晴天]]', '[[电影/花样年华|花样年华]]']);
    expect(fm['收藏']).toBe(true);
    expect(fm['变形']).toBe('换媒介');
    expect(fm['生成']).toBe('AI');
    expect(body).toMatch(/## 因为这几穗\n\n- \[\[音乐\/晴天\|晴天\]\]\n- \[\[电影\/花样年华\|花样年华\]\]\n- 「Clair de Lune」（示例穗，未导出）/);
    expect(body).toContain('## 这次嫁接的其余素材');
    expect(body).toContain('[[图片/雨后的操场|雨后的操场]]');
    expect(body).toContain('[[新枝/咳嗽副歌|咳嗽副歌]]');
    const broken = text('新枝/残缺的枝.md');
    expect(broken).toContain('[[文案/晴天 2|晴天 2]]');
    expect(broken).toContain('（已删除的穗）');
  });

  it('index lists every ear by type and every branch; no link dangles anywhere', () => {
    const idx = text(`${INDEX_NOTE}.md`);
    expect(idx).toContain('## 音乐（1）');
    expect(idx).toContain('## 新枝（3）');
    expect(idx).toContain('示例穗 1 件未导出');
    for (const p of ['音乐/晴天', '电影/花样年华', '图片/雨后的操场', '文案/晴天 2', '新枝/小票上的情书', '新枝/咳嗽副歌', '新枝/残缺的枝']) expect(links(idx)).toContain(p);
    expect(idx).not.toContain('月光');
    assertLinksResolve(map);
    expect(JSON.parse(text('.obsidian/app.json')).attachmentFolderPath).toBe('attachments');
  });

  it('includeSamples exports the sample ear, its image and the sample-only branch', () => {
    const w = buildVault({ items, developments: devs, images, includeSamples: true, now: T });
    const m = vaultFiles(makeZip(w.files, T)).map;
    expect(m.has('音乐/Clair de Lune.md')).toBe(true);
    expect(m.has('attachments/glean-5.png')).toBe(true);
    expect(m.has('新枝/月光.md')).toBe(true);
    expect(w.stats.skippedSamples).toBe(0);
    const fm = parseNote(dec.decode(m.get('音乐/Clair de Lune.md')!.data)).fm;
    expect(fm['示例']).toBe(true);
    assertLinksResolve(m);
  });
});

describe('exportObsidianZip from the real database', () => {
  it('reads originals from the images table, skips samples by default, produces a parseable vault', async () => {
    const d = new LinganDB(uniq('obs'));
    const jpeg = 'data:image/jpeg;base64,' + btoa('JPEG-ORIGINAL'.padEnd(2048, '#'));
    const a = await addItem({ type: 'image', title: '窗外/的树?', tags: ['树'], image: jpeg }, d);
    const b = await addItem({ type: 'music', title: '旧收音机', creator: '某人', tags: [] }, d);
    const c = await addItem({ type: 'film', title: '示例电影', tags: [] }, d);
    await d.items.update(c, { sample: 1 });
    await d.developments.add({ itemIds: [a, b, c], jump: 0.5, source: 'offline', createdAt: Date.now(), idea: { title: '树的收音机', bridge: '', idea: '…', cliches: [], refs: [1, 2, 3] } });

    const { zip, stats } = await exportObsidianZip(d);
    expect(stats).toMatchObject({ items: 2, branches: 1, images: 1, skippedSamples: 1 });
    const { map, text } = vaultFiles(zip);
    expect(map.has('图片/窗外 的树.md')).toBe(true);
    const img = map.get(`attachments/glean-${a}.jpg`)!;
    expect(dec.decode(img.data).startsWith('JPEG-ORIGINAL')).toBe(true);
    expect(text('图片/窗外 的树.md')).toContain(`![[attachments/glean-${a}.jpg]]`);
    const branch = parseNote(text('新枝/树的收音机.md'));
    expect(branch.fm['来源穗']).toEqual(['[[图片/窗外 的树|窗外 的树]]', '[[音乐/旧收音机|旧收音机]]']);
    expect([...map.keys()].some((p) => p.includes('示例电影'))).toBe(false);
    assertLinksResolve(map);

    const all = await exportObsidianZip(d, { includeSamples: true });
    expect(all.stats.items).toBe(3);
    expect(vaultFiles(all.zip).map.has('电影/示例电影.md')).toBe(true);
    d.close();
  });
});
