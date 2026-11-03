/**
 * v0.28 0112 拼音与首字母搜索：输入 wjw 或 wangjiawei 能找到王家卫。
 * 只在搜索框里打的是纯字母时才懒加载（字表约 29KB，不进首屏）。多音字最多认 3 个读音（重庆 = chongqing）。
 */
import { PINYIN_ALT, PINYIN_TABLE } from './pinyin-table';

let map: Map<string, string[]> | null = null;
/** v0.35 字表改成紧凑编码（见 scripts/pinyin/gen.py）：必须和那边的 DIGITS / NT 一致 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./;<=>?@[]^_{}~';
const NT = 52;
/** GB2312 一二级 6763 字，按编码顺序（D7FA–D7FE 是空位） */
export function gb2312Chars(): string[] {
  const b: number[] = [];
  for (let h = 0xb0; h < 0xf8; h++) for (let l = 0xa1; l < 0xff; l++) if (h !== 0xd7 || l < 0xfa) b.push(h, l);
  return [...new TextDecoder('gbk').decode(new Uint8Array(b))];
}
function table(): Map<string, string[]> {
  if (map) return map;
  map = new Map();
  const chars = gb2312Chars();
  // 先常用读音，再补多音字的其它读音：每个字的第一个读音就是常用的
  for (const seg of (PINYIN_TABLE + '|' + PINYIN_ALT).split('|')) {
    const i = seg.indexOf(':');
    const py = seg.slice(0, i);
    let prev = -1, v = 0;
    for (let k = i + 1; k < seg.length; k++) {
      const d = DIGITS.indexOf(seg[k]);
      if (d >= NT) {
        v = v * (DIGITS.length - NT) + d - NT;
        continue;
      }
      prev += v * NT + d + 1;
      v = 0;
      const ch = chars[prev];
      const a = map.get(ch);
      if (a) a.push(py);
      else map.set(ch, [py]);
    }
  }
  return map;
}

/** 一个字段拆成「字」：汉字给它的读音，字母数字是它自己（小写），别的字符断开 */
type Tok = string[] | null; // null = 断点（空格、标点、字段之间）
function tokens(s: string): Tok[] {
  const t = table();
  const out: Tok[] = [];
  for (const ch of s || '') {
    const py = t.get(ch);
    if (py) out.push(py);
    else if (/[A-Za-z0-9]/.test(ch)) out.push([ch.toLowerCase()]);
    else if (out.length && out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

/** 「王家卫 2046」→ { full: 'wangjiawei2046', initials: 'wjw2046' }（多音字取第一个读音，给人看 / 测试用） */
export function toPinyin(s: string): { full: string; initials: string } {
  let full = '';
  let initials = '';
  for (const tk of tokens(s)) {
    if (!tk) continue;
    full += tk[0];
    initials += tk[0][0];
  }
  return { full, initials };
}

/** 搜索框里这样的才走拼音：2–24 个字母（允许中间空格，如 wang jia wei） */
export function isPinyinQuery(q: string): boolean {
  const s = (q || '').trim();
  const n = s.replace(/ /g, '').length;
  return /^[A-Za-z][A-Za-z ]*$/.test(s) && n >= 2 && n <= 24;
}

/** 从第 i 个字起，能不能把 q[qi..] 全拼吃完（最后一个音节可以只打一半：chongq） */
function fullFrom(toks: Tok[], i: number, q: string, qi: number): boolean {
  if (qi >= q.length) return true;
  const tk = toks[i];
  if (!tk) return false;
  for (const r of tk) {
    if (q.startsWith(r, qi) && fullFrom(toks, i + 1, q, qi + r.length)) return true;
    if (q.length - qi < r.length && r.startsWith(q.slice(qi))) return true;
  }
  return false;
}
/** 首字母：一字一个字母，连续对上 */
function initFrom(toks: Tok[], i: number, q: string, qi: number): boolean {
  if (qi >= q.length) return true;
  const tk = toks[i];
  if (!tk) return false;
  return tk.some((r) => r[0] === q[qi]) && initFrom(toks, i + 1, q, qi + 1);
}

type Py = { toks: Tok[]; key: string };
const cache = new WeakMap<object, Py>();

/** 这一穗的标题 / 作者 / 标签里，拼音能不能对上：全拼要从某个字的开头连着对（wangjia、jiawei），首字母 ≥2 个连续对上（wjw）；不跨字段 */
export function pinyinMatch(it: { title: string; creator?: string; tags?: string[] }, q: string): boolean {
  const qq = q.toLowerCase().replace(/ /g, '');
  if (qq.length < 2) return false;
  const key = `${it.title}\u0001${it.creator || ''}\u0001${(it.tags || []).join('\u0001')}`;
  let c = cache.get(it);
  if (!c || c.key !== key) {
    const toks: Tok[] = [];
    for (const f of [it.title, it.creator || '', ...(it.tags || [])]) toks.push(...tokens(f), null);
    c = { toks, key };
    cache.set(it, c);
  }
  const { toks } = c;
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i]) continue;
    if (initFrom(toks, i, qq, 0) || fullFrom(toks, i, qq, 0)) return true;
  }
  return false;
}

/** 一个字的读音（常用的在前）；不认得返回 undefined */
export const readingsOf = (ch: string): string[] | undefined => table().get(ch);
