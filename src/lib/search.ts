// v0.17 秒搜：本地全文索引（纯函数，可单测）。
// 切词：中日韩字按「单字 + 相邻二元」（雾 / 晨雾 / 雾里），拉丁字母和数字按词（stacks / 1999），查询时英文按词前缀匹配。
// 索引只是加速器：候选来自倒排表，最后一律回到原文核对（连续出现、词首），所以不会因为二元切词误命中。
import type { Development, Item } from './types';

/** 切词规则变了就加 1：后台会按新规则重建所有索引行 */
export const SEARCH_VER = 1;
/** 从搜索结果点进某根新枝：新枝页读到它就展开并滚过去 */
export const FOCUS_BRANCH_KEY = 'glean.focusbranch';

export type FieldName = 'title' | 'creator' | 'year' | 'content' | 'why' | 'tags' | 'caption' | 'url' | 'idea' | 'bridge' | 'form' | 'step' | 'experiment' | 'theme';

export const FIELD_LABEL: Record<FieldName, string> = {
  title: '标题',
  creator: '作者',
  year: '年份',
  content: '正文',
  why: '为什么',
  tags: '标签',
  caption: '图片描述',
  url: '链接',
  idea: '正文',
  bridge: '嫁接点',
  form: '形式',
  step: '第一步',
  experiment: '小实验',
  theme: '主题',
};
const WEIGHT: Record<FieldName, number> = { title: 8, creator: 5, tags: 5, year: 3, form: 3, theme: 3, content: 3, idea: 3, bridge: 2, why: 2, caption: 2, step: 1, experiment: 1, url: 1 };

export interface SearchField {
  f: FieldName;
  text: string;
}

export function itemFields(it: Pick<Item, 'title' | 'creator' | 'year' | 'content' | 'why' | 'tags' | 'caption' | 'url'>): SearchField[] {
  const out: SearchField[] = [];
  const add = (f: FieldName, t?: string) => {
    if (t && t.trim()) out.push({ f, text: t });
  };
  add('title', it.title);
  add('creator', it.creator);
  add('year', it.year);
  if (it.content && it.content !== it.title) add('content', it.content);
  add('why', it.why);
  if (it.tags?.length) add('tags', it.tags.join(' · '));
  add('caption', it.caption);
  add('url', it.url);
  return out;
}

export function branchFields(d: Pick<Development, 'idea' | 'theme'>): SearchField[] {
  const out: SearchField[] = [];
  const add = (f: FieldName, t?: string) => {
    if (t && t.trim()) out.push({ f, text: t });
  };
  add('title', (d.idea.title || '').replace(/^《|》$/g, ''));
  add('idea', d.idea.idea);
  add('bridge', d.idea.bridge);
  add('form', d.idea.form);
  add('step', d.idea.firstStep);
  add('experiment', d.idea.experiment);
  add('theme', d.theme);
  return out;
}

// ——— 归一化：逐字 NFKC + 小写，长度不变（高亮位置可以直接对回原文） ———
const normCache = new Map<string, string>();
function normChar(c: string): string {
  const code = c.charCodeAt(0);
  if (code < 128) return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : c;
  let n = normCache.get(c);
  if (n === undefined) {
    const k = c.normalize('NFKC').toLowerCase();
    n = k.length === c.length ? k : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
    normCache.set(c, n);
  }
  return n;
}
export function norm(s: string): string {
  if (!s) return '';
  // 快路径：纯 ASCII
  if (/^[\x00-\x7f]*$/.test(s)) return s.toLowerCase();
  let out = '';
  for (const ch of s) out += normChar(ch);
  return out;
}

/** 中日韩：汉字（含扩展 A、兼容区）、假名、谚文 */
export function isCJK(code: number): boolean {
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x3040 && code <= 0x30ff) || (code >= 0xac00 && code <= 0xd7af);
}
/** 词字符：a-z、0-9、带重音的拉丁字母 */
export function isWordChar(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7);
}

/** 把（已归一化的）文字切成段：cjk 连续段 / word 连续段，其余是分隔 */
export function runs(n: string): Array<{ kind: 'cjk' | 'word'; s: string; at: number }> {
  const out: Array<{ kind: 'cjk' | 'word'; s: string; at: number }> = [];
  let kind: 'cjk' | 'word' | null = null;
  let start = 0;
  for (let i = 0; i <= n.length; i++) {
    const c = i < n.length ? n.charCodeAt(i) : -1;
    const k = c < 0 ? null : isCJK(c) ? 'cjk' : isWordChar(c) ? 'word' : null;
    if (k !== kind) {
      if (kind) out.push({ kind, s: n.slice(start, i), at: start });
      kind = k;
      start = i;
    }
  }
  return out;
}

/** 文档的索引词：中文单字 + 二元，英文 / 数字整词（≤32 字符） */
export function tokenize(fields: SearchField[]): string[] {
  const set = new Set<string>();
  for (const f of fields) {
    for (const r of runs(norm(f.text))) {
      if (r.kind === 'cjk') {
        for (let i = 0; i < r.s.length; i++) {
          set.add(r.s[i]);
          if (i + 1 < r.s.length) set.add(r.s.slice(i, i + 2));
        }
      } else if (r.s.length <= 32) set.add(r.s);
      else set.add(r.s.slice(0, 32));
    }
  }
  return [...set];
}

/** 字段内容的签名（FNV-1a）：变了才重新切词 */
export function signature(fields: SearchField[]): string {
  let h = 0x811c9dc5;
  const s = SEARCH_VER + '\u0001' + fields.map((f) => f.f + '\u0002' + f.text).join('\u0001');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
}

// ——— 查询 ———
export interface Term {
  kind: 'cjk' | 'word';
  s: string;
}
/** 查询切成词项：每个中文连续段是一个短语（必须连续出现），每个英文词是一个前缀 */
export function parseQuery(q: string): Term[] {
  const seen = new Set<string>();
  const out: Term[] = [];
  for (const r of runs(norm(q || ''))) {
    const k = r.kind + r.s;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: r.kind, s: r.kind === 'word' ? r.s.slice(0, 32) : r.s });
  }
  return out;
}

/** 在归一化文字里找词项的所有出现位置 [start, end) */
export function termRanges(n: string, t: Term): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!t.s) return out;
  let i = 0;
  for (;;) {
    const j = n.indexOf(t.s, i);
    if (j < 0) break;
    if (t.kind === 'cjk' || j === 0 || !isWordChar(n.charCodeAt(j - 1))) {
      let end = j + t.s.length;
      // 英文前缀：高亮到词尾（搜 stack 高亮 Stacks 的 stack 部分即可，不扩展）
      out.push([j, end]);
      i = end;
    } else i = j + 1;
  }
  return out;
}

/** 多个词项在一段文字里的命中区间（合并重叠） */
export function hitRanges(text: string, terms: Term[]): Array<[number, number]> {
  if (!text || !terms.length) return [];
  const n = norm(text);
  const all: Array<[number, number]> = [];
  for (const t of terms) all.push(...termRanges(n, t));
  all.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: Array<[number, number]> = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** 文字切成命中 / 非命中段（界面黑底白字） */
export function splitByTerms(text: string, terms: Term[]): Array<{ t: string; hit: boolean }> {
  const rs = hitRanges(text, terms);
  if (!rs.length) return [{ t: text, hit: false }];
  const out: Array<{ t: string; hit: boolean }> = [];
  let i = 0;
  for (const [a, b] of rs) {
    if (a > i) out.push({ t: text.slice(i, a), hit: false });
    out.push({ t: text.slice(a, b), hit: true });
    i = b;
  }
  if (i < text.length) out.push({ t: text.slice(i), hit: false });
  return out;
}

/** 命中处附近的一小段（「…轮渡上的雾…」），max 个字左右 */
export function snippet(text: string, terms: Term[], max = 28): { text: string; offset: number } {
  const t = text.replace(/\s+/g, ' ');
  if (t.length <= max) return { text: t, offset: 0 };
  const rs = hitRanges(t, terms);
  const at = rs.length ? rs[0][0] : 0;
  let start = Math.max(0, at - Math.floor(max / 3));
  if (start + max > t.length) start = Math.max(0, t.length - max);
  const body = t.slice(start, start + max);
  return { text: (start > 0 ? '…' : '') + body + (start + max < t.length ? '…' : ''), offset: start };
}

// ——— 倒排索引（内存）———
export class SearchIndex {
  private post = new Map<string, Set<string>>();
  private docs = new Map<string, { tok: string[]; sig: string }>();
  private words: string[] | null = null;
  rev = 0;

  get size() {
    return this.docs.size;
  }
  sigOf(key: string): string | undefined {
    return this.docs.get(key)?.sig;
  }
  has(key: string) {
    return this.docs.has(key);
  }
  keys() {
    return this.docs.keys();
  }
  set(key: string, tok: string[], sig: string) {
    const old = this.docs.get(key);
    if (old) {
      if (old.sig === sig) return;
      this.unlink(key, old.tok);
    }
    this.docs.set(key, { tok, sig });
    for (const t of tok) {
      let s = this.post.get(t);
      if (!s) {
        s = new Set();
        this.post.set(t, s);
        if (!isCJK(t.charCodeAt(0))) this.words = null;
      }
      s.add(key);
    }
    this.rev++;
  }
  remove(key: string) {
    const old = this.docs.get(key);
    if (!old) return;
    this.unlink(key, old.tok);
    this.docs.delete(key);
    this.rev++;
  }
  clear() {
    this.post.clear();
    this.docs.clear();
    this.words = null;
    this.rev++;
  }
  private unlink(key: string, tok: string[]) {
    for (const t of tok) {
      const s = this.post.get(t);
      if (!s) continue;
      s.delete(key);
      if (!s.size) {
        this.post.delete(t);
        if (!isCJK(t.charCodeAt(0))) this.words = null;
      }
    }
  }
  private wordList(): string[] {
    if (!this.words) this.words = [...this.post.keys()].filter((t) => !isCJK(t.charCodeAt(0))).sort();
    return this.words;
  }
  /** 一个词项的候选文档（倒排表求交 / 前缀求并）；不保证最终命中，调用方要核对原文 */
  candidates(t: Term): Set<string> {
    if (t.kind === 'cjk') {
      if (t.s.length === 1) return this.post.get(t.s) || new Set();
      const lists: Array<Set<string>> = [];
      for (let i = 0; i + 1 < t.s.length; i++) {
        const s = this.post.get(t.s.slice(i, i + 2));
        if (!s) return new Set();
        lists.push(s);
      }
      lists.sort((a, b) => a.size - b.size);
      const out = new Set<string>();
      for (const k of lists[0]) if (lists.every((l) => l.has(k))) out.add(k);
      return out;
    }
    const ws = this.wordList();
    let lo = 0;
    let hi = ws.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ws[mid] < t.s) lo = mid + 1;
      else hi = mid;
    }
    const out = new Set<string>();
    for (let i = lo; i < ws.length && ws[i].startsWith(t.s); i++) for (const k of this.post.get(ws[i])!) out.add(k);
    return out;
  }
}

// ——— 搜索 ———
export interface SearchDoc<T = unknown> {
  key: string; // i:12 / b:5
  kind: 'i' | 'b';
  ref: number;
  createdAt: number;
  fields: SearchField[];
  /** 与 fields 一一对应的归一化文字 */
  norms: string[];
  sig: string;
  obj: T;
}

const docCache = new WeakMap<object, SearchDoc>();
/** 穗 / 新枝 → 可搜文档（同一个对象只算一次） */
export function toDoc<T extends Item | Development>(kind: 'i' | 'b', obj: T): SearchDoc<T> {
  const hit = docCache.get(obj);
  if (hit) return hit as SearchDoc<T>;
  const fields = kind === 'i' ? itemFields(obj as Item) : branchFields(obj as Development);
  const d: SearchDoc<T> = { key: kind + ':' + obj.id, kind, ref: obj.id!, createdAt: obj.createdAt, fields, norms: fields.map((f) => norm(f.text)), sig: signature(fields), obj };
  docCache.set(obj, d);
  return d;
}

export interface FieldHit {
  f: FieldName;
  i: number; // fields 下标
  n: number; // 命中次数
}
export interface SearchHit<T = unknown> {
  doc: SearchDoc<T>;
  score: number;
  fields: FieldHit[];
}

/**
 * 在 docs 里搜 terms：所有词项都要命中（AND）。
 * 候选 = 索引给出的 ∪ 还没进索引 / 索引过期的文档（后台建索引期间结果也完整）。
 */
export function searchDocs<T>(index: SearchIndex | null, docs: Array<SearchDoc<T>>, terms: Term[]): Array<SearchHit<T>> {
  if (!terms.length) return [];
  let pool: Array<SearchDoc<T>>;
  if (index && index.size) {
    let cand: Set<string> | null = null;
    // 先算最稀有的词项
    const sets = terms.map((t) => index.candidates(t)).sort((a, b) => a.size - b.size);
    for (const s of sets) {
      if (!cand) cand = new Set(s);
      else for (const k of cand) if (!s.has(k)) cand.delete(k);
      if (!cand.size) break;
    }
    pool = [];
    for (const d of docs) if (cand!.has(d.key) || index.sigOf(d.key) !== d.sig) pool.push(d);
  } else pool = docs;
  const out: Array<SearchHit<T>> = [];
  for (const d of pool) {
    let score = 0;
    const hits = new Map<number, number>();
    let ok = true;
    for (const t of terms) {
      let found = false;
      for (let i = 0; i < d.norms.length; i++) {
        const n = termRanges(d.norms[i], t).length;
        if (n) {
          found = true;
          hits.set(i, (hits.get(i) || 0) + n);
          score += WEIGHT[d.fields[i].f] * (1 + Math.min(n, 3) * 0.2) + (d.norms[i] === t.s ? 6 : 0) + (d.norms[i].startsWith(t.s) ? 2 : 0);
        }
      }
      if (!found) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const fields = [...hits.entries()].sort((a, b) => a[0] - b[0]).map(([i, n]) => ({ f: d.fields[i].f, i, n }));
    out.push({ doc: d, score, fields });
  }
  out.sort((a, b) => b.score - a.score || b.doc.createdAt - a.doc.createdAt);
  return out;
}

// ——— 筛选 ———
export type DateRange = 'all' | '7d' | '30d' | 'year' | 'custom';
export const DATE_LABEL: Record<DateRange, string> = { all: '不限', '7d': '近 7 天', '30d': '近 30 天', year: '今年', custom: '自定' };

/** 日期范围 → [from, to)（毫秒）。自定用 YYYY-MM-DD，to 那天整天都算 */
export function dateBounds(r: DateRange, now = Date.now(), from?: string, to?: string): [number, number] {
  const d = new Date(now);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  switch (r) {
    case '7d':
      return [startOfDay(d) - 6 * 86400000, Infinity];
    case '30d':
      return [startOfDay(d) - 29 * 86400000, Infinity];
    case 'year':
      return [new Date(d.getFullYear(), 0, 1).getTime(), Infinity];
    case 'custom': {
      const p = (s?: string) => {
        const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
      };
      let a = p(from);
      let b = p(to);
      if (!isNaN(a) && !isNaN(b) && a > b) [a, b] = [b, a];
      return [isNaN(a) ? -Infinity : a, isNaN(b) ? Infinity : b + 86400000];
    }
    default:
      return [-Infinity, Infinity];
  }
}

/** 最近搜过：新的在前、去重、最多 n 个 */
export function pushRecent(list: string[], q: string, n = 6): string[] {
  const s = q.trim().slice(0, 40);
  if (!s) return list;
  return [s, ...list.filter((x) => x !== s)].slice(0, n);
}
