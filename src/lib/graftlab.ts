// v0.42 嫁接成绩 · 配方：新枝怎么样（意外程度 / 采用信号 / 证据覆盖 / 三枝差异）、高产穗、变形法胜率、
// 嫁接配方、时间差嫁接、标签对撞。全离线，只读穗仓与新枝，不加 Dexie 索引。
import { drawForMode } from './modes';
import { textSimilarity, transformName } from './graft';
import { sourceIds } from './provenance';
import type { Development, Item } from './types';
import type { GraftMode } from './modes';

const DAY = 86400000;

// ——— 0238 采用信号 ———
/** 这根新枝被「用上」了没有：留下 / 推进到试过·做成 / 附了结果 / 复制·分享过 / 追问·再嫁接过。放弃的不算。 */
export function adopted(d: Development, kids: Set<string> = new Set()): boolean {
  if (d.status === 'dropped') return false;
  return !!(d.starred || d.status === 'tried' || d.status === 'done' || d.resultUids?.length || d.out || d.followups?.length || (d.uid && kids.has(d.uid)));
}
/** 有子枝的父枝 uid */
export const parentsOf = (devs: Development[]) => new Set(devs.map((d) => d.parentUid).filter(Boolean) as string[]);

// ——— ROADMAP v0.32 嫁接成绩 + 0239 高产穗 + 0240 变形法胜率 ———
export interface GraftScore {
  n: number;
  /** 证据覆盖：证据扎实（≥3 穗）的比例（早先长的不算进分母） */
  evidence: number | null;
  /** 三枝差异：每一批里两两最像的那一对，1 − 相似度，再平均 */
  diff: number | null;
  /** 平均意外（1–5），rated = 评过几根 */
  surprise: number | null;
  rated: number;
  /** 采用率 */
  adoption: number | null;
  /** 高产穗：被「用上了」的新枝引用最多的穗（id → 次数） */
  seeds: Array<{ id: number; n: number }>;
  /** 每种变形法：长了几根、用上了几根 */
  transforms: Array<{ t: string; name: string; n: number; won: number }>;
}

export function graftScore(all: Development[]): GraftScore {
  const devs = all.filter((d) => !d.deletedAt);
  const kids = parentsOf(devs);
  const n = devs.length;
  const ev = devs.filter((d) => (d.idea.evidence || d.evidence) && (d.idea.evidence || d.evidence) !== 'legacy');
  const evidence = ev.length ? ev.filter((d) => (d.idea.evidence || d.evidence) === 'ok').length / ev.length : null;
  const batches = new Map<string, Development[]>();
  for (const d of devs) if (d.batch?.id && !d.parentUid) batches.set(d.batch.id, [...(batches.get(d.batch.id) || []), d]);
  const diffs: number[] = [];
  for (const b of batches.values()) {
    if (b.length < 2) continue;
    const txt = b.map((d) => `${d.idea.title} ${d.idea.idea}`);
    let mx = 0;
    for (let i = 0; i < txt.length; i++) for (let j = i + 1; j < txt.length; j++) mx = Math.max(mx, textSimilarity(txt[i], txt[j]));
    diffs.push(1 - mx);
  }
  const rated = devs.filter((d) => d.surprise! >= 1);
  const used = devs.filter((d) => adopted(d, kids));
  const cite = new Map<number, number>();
  for (const d of used) for (const id of sourceIds(d, d.idea)) cite.set(id, (cite.get(id) || 0) + 1);
  const tm = new Map<string, { n: number; won: number }>();
  for (const d of devs) {
    const t = d.idea.transform;
    if (!t) continue;
    const x = tm.get(t) || { n: 0, won: 0 };
    x.n++;
    if (adopted(d, kids)) x.won++;
    tm.set(t, x);
  }
  return {
    n,
    evidence,
    diff: diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : null,
    surprise: rated.length ? rated.reduce((s, d) => s + d.surprise!, 0) / rated.length : null,
    rated: rated.length,
    adoption: n ? used.length / n : null,
    seeds: [...cite].map(([id, c]) => ({ id, n: c })).sort((a, b) => b.n - a.n || a.id - b.id).slice(0, 5),
    transforms: [...tm].map(([t, x]) => ({ t, name: transformName(t), ...x })).sort((a, b) => b.won / b.n - a.won / a.n || b.n - a.n),
  };
}

/** 0240 收拢时偏向哪几种变形法：至少 12 根带变形法的新枝；每种至少 3 根；平滑后的胜率比整体高 10 个百分点以上，最多 2 种 */
export function preferTransforms(all: Development[]): string[] {
  const s = graftScore(all);
  const tot = s.transforms.reduce((a, x) => a + x.n, 0);
  const won = s.transforms.reduce((a, x) => a + x.won, 0);
  if (tot < 12 || !won) return [];
  const base = won / tot;
  return s.transforms
    .filter((x) => x.n >= 3 && (x.won + base) / (x.n + 1) > base + 0.1)
    .slice(0, 2)
    .map((x) => x.t);
}

// ——— 0214 时间差嫁接 / 0217 标签对撞 ———
export type DrawRule = 'span' | 'clash';
export const RULE_LABEL: Record<DrawRule, string> = { span: '时间差', clash: '标签对撞' };
export interface RuleDraw {
  items: Item[];
  note: string;
  ok: boolean;
}
const pick = <T,>(a: T[], rand: () => number) => a[Math.floor(rand() * a.length)];
/** 用「远距」把剩下的位置补满 */
const fill = (keep: Item[], all: Item[], n: number, rand: () => number) => drawForMode('far', all, n, { keep, rand }).items;

/** 一穗来自一年多以前，一穗来自最近 7 天，其余按远距补 */
export function drawSpan(all: Item[], n: number, rand: () => number = Math.random, now = Date.now()): RuleDraw {
  const old = all.filter((x) => x.createdAt <= now - 365 * DAY);
  const fresh = all.filter((x) => x.createdAt >= now - 7 * DAY);
  if (!old.length || !fresh.length) return { items: [], ok: false, note: !old.length ? '时间差要一穗一年以前拾的：穗仓里还没有满一年的穗。' : '时间差要一穗最近 7 天拾的：这周还没拾过。' };
  const a = pick(old, rand);
  const b = pick(fresh, rand);
  const y = Math.floor((now - a.createdAt) / (365 * DAY));
  return { items: fill([a, b], all, n, rand), ok: true, note: `时间差：「${a.title}」是 ${y} 年前拾的，「${b.title}」是这周拾的。` };
}

/** 两个从没同时出现在一穗上的标签，各抽一穗，其余按远距补。优先两边都有 ≥2 穗的标签 */
export function drawClash(all: Item[], n: number, rand: () => number = Math.random): RuleDraw {
  const by = new Map<string, Item[]>();
  for (const it of all) for (const t of it.tags) by.set(t, [...(by.get(t) || []), it]);
  // 只看最常用的 60 个标签（两两配对，标签很多时别算爆）
  const tags = [...by.keys()].sort((a, b) => by.get(b)!.length - by.get(a)!.length).slice(0, 60);
  const together = new Set<string>();
  for (const it of all) for (const a of it.tags) for (const b of it.tags) if (a < b) together.add(a + '\u0001' + b);
  const pairs: Array<[string, string, number]> = [];
  for (let i = 0; i < tags.length; i++)
    for (let j = i + 1; j < tags.length; j++) {
      const [a, b] = tags[i] < tags[j] ? [tags[i], tags[j]] : [tags[j], tags[i]];
      if (together.has(a + '\u0001' + b)) continue;
      pairs.push([a, b, Math.min(by.get(a)!.length, by.get(b)!.length)]);
    }
  if (!pairs.length) return { items: [], ok: false, note: '标签对撞要两个从没同时出现过的标签：先给穗多打几个不同的标签。' };
  const best = pairs.filter((p) => p[2] >= 2);
  const [a, b] = pick(best.length ? best : pairs, rand);
  const ia = pick(by.get(a)!, rand);
  const ib = pick(by.get(b)!.filter((x) => x !== ia), rand) || by.get(b)![0];
  return { items: fill([ia, ib], all, n, rand), ok: true, note: `标签对撞：#${a} × #${b}（从没同时出现在一穗上）。` };
}

// ——— 0213 嫁接配方（本机 localStorage，不进同步）———
export interface Recipe {
  name: string;
  mode: GraftMode;
  rule?: DrawRule;
  count: 3 | 4 | 5;
  theme?: string;
  wild?: boolean;
  pick?: boolean;
  pool?: string | null;
}
const RK = 'glean.recipes';
export const RECIPE_MAX = 8;
export function loadRecipes(): Recipe[] {
  try {
    const a = JSON.parse(localStorage.getItem(RK) || '[]');
    return Array.isArray(a) ? a.filter((r) => r && typeof r.name === 'string' && typeof r.mode === 'string') : [];
  } catch {
    return [];
  }
}
/** 同名覆盖，新的放最前，最多 8 个 */
export function saveRecipe(r: Recipe, list = loadRecipes()): Recipe[] {
  const next = [r, ...list.filter((x) => x.name !== r.name)].slice(0, RECIPE_MAX);
  try {
    localStorage.setItem(RK, JSON.stringify(next));
  } catch {
    /* 隐私模式 */
  }
  return next;
}
export function removeRecipe(name: string, list = loadRecipes()): Recipe[] {
  const next = list.filter((x) => x.name !== name);
  try {
    localStorage.setItem(RK, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
/** 配方的默认名：接法（或特别抽法）· 几穗 · 方向 · 野 */
export function recipeName(r: Omit<Recipe, 'name'>, modeLabel: string): string {
  return [r.rule ? RULE_LABEL[r.rule] : modeLabel, `${r.count} 穗`, r.theme?.trim().slice(0, 10), r.wild ? '野' : '', r.pool ? `束 ${r.pool}` : ''].filter(Boolean).join(' · ');
}

// ——— 0221 停留天数 ———
export function stayDays(d: Pick<Development, 'statusAt' | 'createdAt'>, now = Date.now()): number {
  return Math.max(0, Math.floor((now - (d.statusAt || d.createdAt)) / DAY));
}
