// v0.23 搜索语法（0111）：type:电影 tag:夜 year:199x from:小红书 why:空 before:2026-10 after:2026-09 inbox:是，可叠加，剩下的字照常全文搜。
// 中文冒号「：」也认。值里有空格时用引号：tag:"夜 车"。认不出的 key:value 原样留给全文搜索。
import { TYPE_LABEL, type Item, type ItemType } from './types';

export type QKey = 'type' | 'tag' | 'year' | 'from' | 'why' | 'before' | 'after' | 'inbox' | 'bundle';
export interface QFilter {
  key: QKey;
  value: string;
  /** 前面带 - ：取反（-tag:夜） */
  neg?: boolean;
}
export interface ParsedQuery {
  text: string;
  filters: QFilter[];
}

const KEYS: Record<string, QKey> = {
  type: 'type', 类型: 'type', t: 'type',
  tag: 'tag', 标签: 'tag', '#': 'tag',
  year: 'year', 年份: 'year', 年: 'year',
  from: 'from', 来自: 'from', 来源: 'from', src: 'from',
  why: 'why', 为什么: 'why',
  before: 'before', 之前: 'before',
  after: 'after', 之后: 'after',
  inbox: 'inbox', 待理: 'inbox',
  bundle: 'bundle', 束: 'bundle', 穗束: 'bundle',
};
export const SYNTAX_HELP: Array<[string, string]> = [
  ['type:电影', '类型'],
  ['tag:夜', '标签'],
  ['year:199x', '作品年份'],
  ['from:小红书', '来自哪个 App / 网站'],
  ['why:空', '没写为什么'],
  ['before:2026-10', '这之前收的'],
  ['inbox:是', '还在待理'],
  ['束:毕业设计', '在哪个穗束（v0.28）'],
];

const TOKEN = /(^|\s)(-?)([A-Za-z#\u4e00-\u9fff]{1,6})[:：]("[^"]*"|“[^”]*”|[^\s]+)/g;

export function parseSyntax(q: string): ParsedQuery {
  const filters: QFilter[] = [];
  const text = (q || '')
    .replace(TOKEN, (m, pre: string, neg: string, k: string, v: string) => {
      const key = KEYS[k.toLowerCase()];
      if (!key) return m;
      const value = v.replace(/^["“]|["”]$/g, '').trim();
      if (!value) return m;
      filters.push({ key, value, ...(neg ? { neg: true } : {}) });
      return pre || ' ';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text, filters };
}

const TYPE_ALIAS: Record<string, ItemType> = {
  music: 'music', 歌: 'music', 歌曲: 'music', song: 'music',
  film: 'film', movie: 'film', 影: 'film', 片: 'film', 剧: 'film',
  image: 'image', img: 'image', pic: 'image', 图: 'image', 照片: 'image',
  text: 'text', quote: 'text', 摘抄: 'text', 句子: 'text', 文: 'text',
  link: 'link', url: 'link', 网页: 'link', 文章: 'link',
  idea: 'idea', 念头: 'idea', 想: 'idea',
};
export function typeOf(v: string): ItemType | null {
  const k = v.toLowerCase();
  for (const [t, label] of Object.entries(TYPE_LABEL)) if (label === v || t === k) return t as ItemType;
  return TYPE_ALIAS[k] || null;
}

/** 2026-10 / 2026-10-05 / 2026 → 那一段的开头和结尾（本地时间） */
export function dateSpan(v: string): [number, number] | null {
  const m = v.match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/);
  if (!m) return null;
  const y = +m[1];
  if (m[3]) {
    const a = new Date(y, +m[2] - 1, +m[3]).getTime();
    return [a, a + 86400000];
  }
  if (m[2]) return [new Date(y, +m[2] - 1, 1).getTime(), new Date(y, +m[2], 1).getTime()];
  return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];
}

const NO = /^(否|不|不是|no|n|0|false)$/i;
const isEmptyWord = (v: string) => /^(空的?|没有|无|none|empty|0|no)$/i.test(v);

/** year:199x / 1990s / 1994 / 199* */
function yearMatch(year: string | undefined, v: string): boolean {
  const y = (year || '').match(/\d{4}/)?.[0];
  if (!y) return false;
  const pat = v.toLowerCase().replace(/s$/, 'x').replace(/0x$/, 'x');
  if (/^\d{4}$/.test(pat)) return y === pat;
  const pre = pat.replace(/[x*?]+$/, '');
  return /^\d{1,3}$/.test(pre) && y.startsWith(pre);
}

type QItem = Pick<Item, 'type' | 'tags' | 'year' | 'source' | 'url' | 'creator' | 'why' | 'createdAt' | 'inbox' | 'bundles'>;
function one(it: QItem, f: QFilter): boolean {
  const v = f.value;
  switch (f.key) {
    case 'type': {
      const t = typeOf(v);
      return t ? it.type === t : false;
    }
    case 'tag':
      return (it.tags || []).some((t) => t === v || t.toLowerCase() === v.toLowerCase());
    case 'year':
      return yearMatch(it.year, v);
    case 'from': {
      const k = v.toLowerCase();
      const host = (() => {
        try {
          return it.url ? new URL(it.url).host.toLowerCase() : '';
        } catch {
          return '';
        }
      })();
      return [(it.source || '').toLowerCase(), host].some((s) => s && s.includes(k)) || (it.type === 'link' && (it.creator || '').toLowerCase().includes(k));
    }
    case 'why': {
      const has = !!(it.why || '').trim();
      if (isEmptyWord(v)) return !has;
      if (/^(有|写了|yes|y|1)$/i.test(v)) return has;
      return (it.why || '').includes(v);
    }
    case 'before': {
      const s = dateSpan(v);
      return s ? it.createdAt < s[0] : false;
    }
    case 'after': {
      const s = dateSpan(v);
      return s ? it.createdAt >= s[1] : false;
    }
    case 'inbox':
      return NO.test(v) ? !it.inbox : !!it.inbox;
    case 'bundle':
      return isEmptyWord(v) ? !it.bundles?.length : (it.bundles || []).some((b) => b === v || b.toLowerCase() === v.toLowerCase());
  }
}
export function matchFilters(it: QItem, filters: QFilter[]): boolean {
  for (const f of filters) if (one(it, f) === !!f.neg) return false;
  return true;
}

/** 正在输入 key: 时给的补全（最多 6 个） */
export function completeSyntax(q: string, ctx: { tags: string[]; sources: string[]; bundles?: string[] }): Array<{ label: string; insert: string }> {
  const m = q.match(/(?:^|\s)(-?)([A-Za-z\u4e00-\u9fff]{1,6})[:：]([^\s]*)$/);
  if (!m) return [];
  const key = KEYS[m[2].toLowerCase()];
  if (!key) return [];
  const part = m[3];
  const head = q.slice(0, q.length - part.length);
  let opts: string[] = [];
  if (key === 'type') opts = Object.values(TYPE_LABEL);
  else if (key === 'tag') opts = ctx.tags;
  else if (key === 'from') opts = ctx.sources;
  else if (key === 'why') opts = ['空', '有'];
  else if (key === 'inbox') opts = ['是', '否'];
  else if (key === 'bundle') opts = ctx.bundles || [];
  else if (key === 'year') opts = ['199x', '200x', '201x', '202x'];
  return opts
    .filter((o) => !part || o.toLowerCase().startsWith(part.toLowerCase()) || o.includes(part))
    .slice(0, 6)
    .map((o) => ({ label: `${m[2]}:${o}`, insert: head + (/\s/.test(o) ? `"${o}"` : o) + ' ' }));
}
