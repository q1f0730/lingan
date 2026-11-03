// v0.23 待理与补为什么：整理用的纯函数（可单测）。
// 标签词汇 / AI 新词分拣（0110）、共现推荐（0148）、标签健康检查（0147）、合并改写（0103）、
// 缺为什么（0102）、提示问题（0146）、整理度（0160）、三秒整理的今日计数（0115）。
import { BUILTIN_FORBIDDEN, clicheKey } from './wall';
import type { Item, ItemType } from './types';
import { lacksWhy } from './why';
export { lacksWhy };

type Tagged = Pick<Item, 'tags'>;

/** 你的标签词汇（出现过的所有标签） */
export function tagVocab(items: Tagged[]): Set<string> {
  const s = new Set<string>();
  for (const it of items) for (const t of it.tags || []) s.add(t);
  return s;
}

const lower = (s: string) => s.normalize('NFKC').toLowerCase();

/** AI 给的标签分两拨：已在词汇里的直接用；新词（且不是套路墙上的泛词）留给你点头 */
export function splitSuggested(tags: string[], vocab: Iterable<string>, wallKeys: string[] = []): { known: string[]; fresh: string[] } {
  const byLower = new Map<string, string>();
  for (const v of vocab) byLower.set(lower(v), v);
  const banned = new Set([...BUILTIN_FORBIDDEN, ...wallKeys].map((w) => clicheKey(w)));
  const known: string[] = [];
  const fresh: string[] = [];
  for (const t of tags) {
    const hit = byLower.get(lower(t));
    if (hit) {
      if (!known.includes(hit)) known.push(hit);
    } else if (!banned.has(clicheKey(t)) && !fresh.includes(t)) fresh.push(t);
  }
  return { known, fresh: fresh.slice(0, 5) };
}

/** 打了这些标签之后，常和它们一起出现的标签（不含已打的），多→少 */
export function cooccur(items: Tagged[], tags: string[], n = 3): string[] {
  if (!tags.length) return [];
  const have = new Set(tags);
  const m = new Map<string, number>();
  for (const it of items) {
    const ts = it.tags || [];
    if (!ts.some((t) => have.has(t))) continue;
    for (const t of ts) if (!have.has(t)) m.set(t, (m.get(t) || 0) + 1);
  }
  return [...m.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([t]) => t);
}

/** 编辑距离（只用来判断 ≤1，短字符串） */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export interface TagStat {
  tag: string;
  n: number;
  firstAt: number;
  lastAt: number;
}
export function tagStats(items: Array<Pick<Item, 'tags' | 'createdAt'>>): TagStat[] {
  const m = new Map<string, TagStat>();
  for (const it of items)
    for (const t of it.tags || []) {
      const x = m.get(t);
      if (x) {
        x.n++;
        x.firstAt = Math.min(x.firstAt, it.createdAt);
        x.lastAt = Math.max(x.lastAt, it.createdAt);
      } else m.set(t, { tag: t, n: 1, firstAt: it.createdAt, lastAt: it.createdAt });
    }
  return [...m.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

export interface TagHealth {
  /** 只用过一次 */
  once: string[];
  /** 写法很近的一对（差一个字、大小写 / 全半角不同、一个包含另一个），前一个用得多 */
  near: Array<[string, string]>;
  /** 半年没用过 */
  stale: string[];
}
const HALF_YEAR = 182 * 86400000;
/** 0147 标签健康检查 */
export function tagHealth(items: Array<Pick<Item, 'tags' | 'createdAt'>>, now = Date.now()): TagHealth {
  const st = tagStats(items);
  const once = st.filter((s) => s.n === 1).map((s) => s.tag);
  const stale = st.filter((s) => s.n > 1 && s.lastAt < now - HALF_YEAR).map((s) => s.tag);
  const near: Array<[string, string]> = [];
  const list = st.slice(0, 400);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].tag;
      const b = list[j].tag;
      const la = lower(a);
      const lb = lower(b);
      const short = Math.min(la.length, lb.length);
      const diff = Math.abs(la.length - lb.length);
      const contains = la.includes(lb) || lb.includes(la);
      // 夜 / 夜晚：一个包含另一个只差一个字；长一点的允许差两个字；拉丁字母差一个字母
      const close = la === lb || (contains && (diff <= 1 || (short >= 2 && diff <= 2))) || (short >= 3 && editDistance(la, lb) <= 1);
      if (close) near.push([a, b]);
      if (near.length >= 12) break;
    }
  return { once: once.slice(0, 40), near, stale: stale.slice(0, 20) };
}

/** 0103 合并标签：把 from 里的标签换成 to（去重，顺序不变）。没变返回 null */
export function rewriteTags(tags: string[], from: string[], to: string): string[] | null {
  const f = new Set(from);
  if (!tags.some((t) => f.has(t))) return null;
  const out: string[] = [];
  for (const t of tags) {
    const x = f.has(t) ? to : t;
    if (x && !out.includes(x)) out.push(x);
  }
  return out;
}

// ——— 0102 缺为什么 ———
export const WHY_BATCH = 5;
type WhyItem = Pick<Item, 'id' | 'why' | 'sample' | 'deletedAt' | 'createdAt'>;
/** 没写为什么的穗，最近收的在前；跳过的排到最后（全跳过了就从头再来） */
export function whyQueue<T extends WhyItem>(items: T[], skipped: Set<number> = new Set()): T[] {
  const all = items.filter(lacksWhy).sort((a, b) => b.createdAt - a.createdAt);
  const fresh = all.filter((x) => !skipped.has(x.id!));
  return fresh.length ? [...fresh, ...all.filter((x) => skipped.has(x.id!))] : all;
}

/** 0146 提示问题：不替你写，只问一句（按类型轮换，本地文案）。点一下 = 把后面的半句放进补写框当开头 */
export interface WhyPrompt {
  q: string;
  s: string;
}
const P = (q: string, s: string): WhyPrompt => ({ q, s });
export const WHY_PROMPTS: Record<ItemType, WhyPrompt[]> = {
  music: [P('哪一段让你停下来？', '停在那一段：'), P('它让你想到谁？', '想到'), P('适合什么时候听？', '适合在'), P('是旋律、声音还是词？', '打动我的是')],
  film: [P('哪个镜头还记得？', '记得那个镜头：'), P('哪句台词？', '那句台词：'), P('它是什么颜色的？', '它的颜色是'), P('看完那一刻在想什么？', '看完的时候在想')],
  image: [P('先看到的是哪个细节？', '先看到的是'), P('像哪部电影里的画面？', '像'), P('是光、颜色还是构图？', '是因为'), P('想拿它做什么？', '想拿它')],
  text: [P('这句话说中了什么？', '说中了'), P('想把它送给谁？', '想送给'), P('它让你想起哪件事？', '想起'), P('哪几个字最重？', '最重的是')],
  link: [P('打开它是想找什么？', '想找'), P('以后什么时候用得上？', '以后'), P('和你在做的什么有关？', '和'), P('里面最想记住哪一点？', '最想记住')],
  idea: [P('它从哪儿冒出来的？', '冒出来是因为'), P('第一步能做什么？', '第一步'), P('像你收过的哪一穗？', '像'), P('只能留一句，留哪句？', '')],
};
export function whyPrompts(type: ItemType, seed = 0): WhyPrompt[] {
  const list = WHY_PROMPTS[type] || WHY_PROMPTS.idea;
  const k = Math.abs(seed) % list.length;
  return [...list.slice(k), ...list.slice(0, k)].slice(0, 3);
}

// ——— 0160 整理度 ———
export interface OrganizeStats {
  total: number;
  withWhy: number;
  withTags: number;
  inbox: number;
}
export function organizeStats(items: Array<Pick<Item, 'why' | 'tags' | 'sample' | 'deletedAt' | 'inbox'>>): OrganizeStats {
  const own = items.filter((i) => !i.sample && !i.deletedAt);
  return {
    total: own.length,
    withWhy: own.filter((i) => (i.why || '').trim()).length,
    withTags: own.filter((i) => i.tags?.length).length,
    inbox: own.filter((i) => i.inbox).length,
  };
}

// ——— 0115 今天理了几穗（本机，按日期） ———
const DONE_KEY = 'glean.sorted.v1';
function today(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function sortedToday(now = Date.now()): number {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_KEY) || '{}');
    return v && v.day === today(now) && typeof v.n === 'number' ? v.n : 0;
  } catch {
    return 0;
  }
}
export function bumpSorted(by = 1, now = Date.now()): number {
  const n = sortedToday(now) + by;
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify({ day: today(now), n }));
  } catch {
    /* ignore */
  }
  return n;
}
