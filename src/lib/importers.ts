// v0.35 拾穗 · 把旧仓库搬进来（ROADMAP v0.28）：豆瓣（豆伴导出的 CSV / xlsx，0014 0802 0817）、flomo 导出 HTML、浏览器书签 HTML、
// Kindle My Clippings.txt 与微信读书笔记（0049）、纯文本 / 微信收藏导出文字（每段一穗）。全在本机解析，不联网。
// 导入前先预览：新的几穗、已经有的几穗（按重复钥匙认，再导一次不会重复）、读不出的几行；导进来的放进一个穗束当「导入报告」（0065）。
import { addItem, db, normalizeTags } from './db';
import { dupKeys } from './dupe';
import { extractUrl, guessType } from './linkmeta';
import type { Item, ItemType } from './types';

export type Draft = Omit<Item, 'id' | 'createdAt' | 'updatedAt'> & { at?: number };
export interface Parsed {
  kind: string;
  items: Draft[];
  bad: number;
}

const T = (type: ItemType, title: string, o: Partial<Draft> = {}): Draft => ({ type, title: title.slice(0, 120), creator: '', year: '', content: '', url: '', why: '', tags: [], ...o });

/** 一段文字 → 一穗（同速记：只有链接 = 链接穗，长的 = 文案，短的 = 想法）；#标签 拿出来 */
export function textDraft(raw: string, o: Partial<Draft> = {}): Draft | null {
  const tags: string[] = [...(o.tags || [])];
  const text = raw.replace(/(^|\s)#([^\s#]{1,24})(?=\s|$)/g, (_, p: string, t: string) => {
    tags.push(t);
    return p;
  }).replace(/[ \t]{2,}/g, ' ').trim();
  if (!text) return null;
  const url = extractUrl(text);
  const rest = url ? text.replace(url, '').trim() : text;
  const base = { ...o, tags: normalizeTags(tags) };
  if (url && rest.length <= 60) return T(guessType(url), rest || url, { ...base, url });
  if (rest.length > 60 || text.includes('\n')) return T('text', text.slice(0, 18), { ...base, content: text, url: url || '' });
  return T('idea', text, base);
}

/** 本地时间：2023-01-02 03:04:05 / 2023/1/2 / 2023年1月2日 下午3:04 */
export function parseWhen(s: string | undefined): number | undefined {
  const m = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:\D{0,12}?(上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i.exec(s || '');
  if (!m) return undefined;
  let h = +(m[5] || 0);
  const pm = /下午|PM/i.test((m[4] || '') + (m[8] || ''));
  if (pm && h < 12) h += 12;
  if (/上午|AM/i.test((m[4] || '') + (m[8] || '')) && h === 12) h = 0;
  const t = new Date(+m[1], +m[2] - 1, +m[3], h, +(m[6] || 0), +(m[7] || 0)).getTime();
  return Number.isFinite(t) ? t : undefined;
}

/** RFC 4180 CSV（逗号或制表符，引号里可以有换行） */
export function csvRows(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '');
  const sep = (s.split('\n')[0].match(/\t/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** 表格（豆伴导出 / 通用 CSV）：按表头认列，sheet 名（看过 / 想看 / 听过…）当标签 */
export function tableItems(rows: string[][], sheet = ''): Parsed {
  const [head, ...body] = rows;
  const col = (re: RegExp) => (head || []).findIndex((h) => re.test(h.trim()));
  const c = { t: col(/^(标题|名称|title|name)$/i), r: col(/评分|rating/i), w: col(/短评|评语|备注|comment|why/i), d: col(/(打分|标记|收藏|添加|创建)?(日期|时间)$|^date|^time/i), u: col(/链接|url|link/i), a: col(/导演|作者|表演者|艺术家|歌手|creator|director|artist|author/i), y: col(/^(上映|出版|发行)?(日期|年份)$|year/i), g: col(/标签|tags?/i), x: col(/^(内容|正文|content|text)$/i) };
  if (c.t < 0 && c.x < 0) return { kind: '表格', items: [], bad: body.length };
  const items: Draft[] = [];
  let bad = 0, douban = false;
  for (const r of body) {
    const v = (i: number) => (i >= 0 ? (r[i] || '').trim() : '');
    const url = v(c.u);
    const title = v(c.t);
    if (!title && !v(c.x)) {
      bad++;
      continue;
    }
    douban ||= /douban\.com/.test(url);
    const tags = normalizeTags([...(v(c.g) ? v(c.g).split(/[\s,，;；]+/) : []), ...(sheet && !/^sheet\d*$/i.test(sheet) ? [sheet] : [])]);
    const at = parseWhen(v(c.d));
    const rate = v(c.r) ? `我的评分 ${v(c.r)}` : '';
    if (!title) {
      const d = textDraft(v(c.x), { tags, at });
      if (d) items.push(d);
      continue;
    }
    const type: ItemType = /book\.douban/.test(url) || /读/.test(sheet) ? 'text' : /music\.douban/.test(url) || /听/.test(sheet) ? 'music' : /movie\.douban/.test(url) || /看/.test(sheet) ? 'film' : url ? guessType(url) : 'idea';
    items.push(T(type, title, { url, creator: v(c.a).split(/\s*\/\s*/)[0].slice(0, 80), year: (v(c.y).match(/(18|19|20)\d{2}/) || [''])[0], why: v(c.w), content: [v(c.x), rate].filter(Boolean).join('\n'), tags: type === 'text' ? normalizeTags([...tags, '书']) : tags, at, ...(douban ? { source: '豆瓣' } : {}) }));
  }
  return { kind: douban ? '豆瓣' : '表格', items, bad };
}

const unesc = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();

/** flomo 导出：<div class="memo"><div class="time">…</div><div class="content">…</div> */
export function flomoItems(html: string): Parsed {
  const items: Draft[] = [];
  let bad = 0;
  for (const m of html.matchAll(/<div class="time">([^<]*)<\/div>\s*<div class="content">([\s\S]*?)<\/div>\s*(?=<div class="files"|<\/div>)/g)) {
    const d = textDraft(unesc(m[2]), { at: parseWhen(m[1]), source: 'flomo' });
    if (d) items.push(d);
    else bad++;
  }
  return { kind: 'flomo', items, bad };
}

/** 浏览器书签（Netscape 格式）：所在文件夹当标签（书签栏 / 其他书签不算） */
export function bookmarkItems(html: string): Parsed {
  const items: Draft[] = [];
  const stack: string[] = [];
  let pending = '';
  for (const m of html.matchAll(/<H3[^>]*>([^<]*)<\/H3>|<DL>|<\/DL>|<A\s([^>]*)>([^<]*)<\/A>/gi)) {
    if (m[1] != null) pending = unesc(m[1]);
    else if (/^<DL/i.test(m[0])) {
      stack.push(pending);
      pending = '';
    }
    else if (/^<\/DL/i.test(m[0])) stack.pop();
    else {
      const url = (/HREF="([^"]+)"/i.exec(m[2]) || [])[1] || '';
      if (!/^https?:/i.test(url)) continue;
      const add = +((/ADD_DATE="(\d+)"/i.exec(m[2]) || [])[1] || 0);
      const folder = [...stack].reverse().find((f) => f && !/书签栏|收藏夹栏|其他书签|Bookmarks|Favorites|Other/i.test(f));
      items.push(T(guessType(url), unesc(m[3]) || url, { url: unesc(url), tags: folder ? normalizeTags([folder]) : [], at: add ? (add > 1e11 ? add : add * 1000) : undefined }));
    }
  }
  return { kind: '书签', items, bad: 0 };
}

/** Kindle My Clippings.txt：书名 (作者) / - 标注 | 添加于 … / 正文；书签条跳过 */
export function kindleItems(text: string): Parsed {
  const items: Draft[] = [];
  let bad = 0;
  for (const blk of text.replace(/^\uFEFF/, '').split(/\r?\n={5,}\r?\n?/)) {
    const lines = blk.split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '').trim());
    while (lines.length && !lines[0]) lines.shift();
    if (lines.length < 2) continue;
    const body = lines.slice(2).join('\n').trim();
    if (/书签|Bookmark/i.test(lines[1])) continue;
    if (!body) {
      bad++;
      continue;
    }
    const bm = /^(.*?)\s*[(（]([^()（）]+)[)）]\s*$/.exec(lines[0]);
    const en = /Added on \w+, (.+)$/.exec(lines[1]);
    items.push(T('text', bm ? bm[1] : lines[0], { creator: bm ? bm[2] : '', content: body, tags: ['摘抄'], source: 'Kindle', at: en ? Date.parse(en[1]) || undefined : parseWhen(lines[1]) }));
  }
  return { kind: 'Kindle', items, bad };
}

/** 微信读书「导出笔记」：《书名》/ 作者 / ◆ 章节 / >> 划线；想法 + 原文 → 原文做正文、想法做为什么 */
export function wereadItems(text: string): Parsed {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const book = (/^《(.+)》$/.exec(lines.find((l) => l) || '') || [])[1] || '';
  const author = book ? lines.filter((l) => l)[1] || '' : '';
  const items: Draft[] = [];
  let thought = '';
  const add = (content: string, why = '') => void (content && items.push(T('text', book || content.slice(0, 18), { creator: /^[◆>]/.test(author) ? '' : author.slice(0, 80), content, why, tags: ['摘抄'], source: '微信读书' })));
  for (const l of lines) {
    if (/^>>\s*/.test(l)) add(l.replace(/^>>\s*/, ''));
    else if (/^原文[:：]/.test(l)) {
      add(l.replace(/^原文[:：]\s*/, ''), thought);
      thought = '';
    }
    else if (/^◆.*发表想法/.test(l)) thought = '';
    else if (l && !/^◆/.test(l) && !/^《/.test(l) && l !== author && !/^\d+个笔记$/.test(l)) thought = thought ? thought + '\n' + l : l;
  }
  return { kind: '微信读书', items, bad: 0 };
}

/** 纯文本 / Markdown / 微信收藏导出文字：空行隔开的每一段一穗 */
export function plainItems(text: string): Parsed {
  const items = text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => textDraft(b.replace(/^\s*[-*]\s+/gm, '').trim()))
    .filter((x): x is Draft => !!x);
  return { kind: '文本', items, bad: 0 };
}

/** xlsx：每张表 → 行（sharedStrings + inlineStr），用浏览器自带的解压（deflate-raw） */
async function xlsxSheets(buf: Uint8Array): Promise<Array<[string, string[][]]>> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('不是 xlsx');
  const files = new Map<string, string>();
  const dec = new TextDecoder();
  for (let p = v.getUint32(e + 16, true), n = v.getUint16(e + 10, true); n-- > 0; ) {
    const [meth, csz, nl, xl, cl, off] = [v.getUint16(p + 10, true), v.getUint32(p + 20, true), v.getUint16(p + 28, true), v.getUint16(p + 30, true), v.getUint16(p + 32, true), v.getUint32(p + 42, true)];
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (!/^xl\/(sharedStrings|workbook|worksheets\/sheet\d+)\.xml$/.test(name)) continue;
    const s = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const raw = buf.slice(s, s + csz);
    files.set(name, meth ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text() : dec.decode(raw));
  }
  const x = (s: string) => unesc(s.replace(/<rPh[\s\S]*?<\/rPh>/g, ''));
  const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => x(m[1]));
  const names = [...(files.get('xl/workbook.xml') || '').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => x(m[1]));
  const out: Array<[string, string[][]]> = [];
  for (let i = 1; files.has(`xl/worksheets/sheet${i}.xml`); i++) {
    const rows: string[][] = [];
    for (const r of files.get(`xl/worksheets/sheet${i}.xml`)!.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ci = [...c[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const val = (/<v>([\s\S]*?)<\/v>/.exec(c[3] || '') || [])[1];
        row[ci] = /t="s"/.test(c[2]) ? shared[+(val || 0)] || '' : /t="inlineStr"/.test(c[2]) ? x(c[3] || '') : x(val || '');
      }
      rows.push(Array.from(row, (z) => z || ''));
    }
    out.push([names[i - 1] || '', rows]);
  }
  return out;
}

/** 认格式并解析 */
export async function parseFile(name: string, buf: Uint8Array): Promise<Parsed> {
  if (/\.xlsx$/i.test(name)) {
    const all: Parsed = { kind: '表格', items: [], bad: 0 };
    for (const [sheet, rows] of await xlsxSheets(buf)) {
      const p = tableItems(rows, sheet);
      all.items.push(...p.items);
      all.bad += p.bad;
      if (p.kind === '豆瓣') all.kind = '豆瓣';
    }
    return all;
  }
  const text = new TextDecoder().decode(buf);
  if (/\.csv$/i.test(name) || /\.tsv$/i.test(name)) return tableItems(csvRows(text));
  if (/class="memo"/.test(text)) return flomoItems(text);
  if (/NETSCAPE-Bookmark-file|<DT><A /i.test(text)) return bookmarkItems(text);
  if (/\n={8,}/.test(text) && /(添加于|Added on)/.test(text)) return kindleItems(text);
  if (/^\s*《[^\n]+》\s*\n/.test(text) && /\n>>\s/.test(text)) return wereadItems(text);
  if (/<html|<body/i.test(text)) return plainItems(unesc(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')));
  return plainItems(text);
}

/** 预览：去掉和本机已有的、以及这批里自己重复的 */
export async function planMoveIn(p: Parsed): Promise<{ fresh: Draft[]; dup: number }> {
  const seen = new Set<string>();
  const fresh: Draft[] = [];
  let dup = 0;
  for (const it of p.items) {
    const keys = dupKeys(it);
    const have = keys.length ? (await db.items.where('dup').anyOf(keys).filter((x) => !x.deletedAt).count()) > 0 : false;
    if (have || keys.some((k) => seen.has(k))) {
      dup++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    fresh.push(it);
  }
  return { fresh, dup };
}

/** 写进穗仓（不进待理），全部放进穗束「导入 · 来源 月/日」 */
export async function runMoveIn(fresh: Draft[], bundle: string): Promise<number> {
  let n = 0;
  for (const { at, ...it } of fresh) {
    await addItem({ ...it, bundles: [bundle] }, db, { createdAt: at });
    n++;
  }
  return n;
}
