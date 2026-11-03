// v0.24 三枝不撞车（ROADMAP，原 v0.20）+ 0241 新颖度。
// 依据 Perplexity pipeline 第 5 步「Measure redundancy… reject near-duplicates」。
// 三根新枝长出来后两两比相似度：有向量（设置里配了向量模型、调用成功）用余弦，没有就用字面相似度；
// 太像的那根用没用上的种子重长，界面提示「换掉了一根太像的」。阈值在设置里可调。
import type { Idea } from './types';

/** 比较用的文字：标题 + 正文（嫁接点是种子原句，离线时已在正文开头，AI 时只是出发点，不参与比较）。去掉素材名（《…》，三根本来就用同一批穗）和离线句式里固定的那几句 */
export function branchCore(b: Pick<Idea, 'title' | 'bridge' | 'idea'>): string {
  const body = [b.title, b.idea].filter(Boolean).join('。');
  return body
    .replace(/《[^》]{0,40}》/g, '')
    .replace(/做成[^。]*?[：:][^。]*。/g, '')
    .replace(/这一根的变形是「[^」]*」[^。]*。/g, '')
    .replace(/接法「[^」]*」[^。]*。/g, '')
    .replace(/约束[：:][^。]*。/g, '')
    .replace(/方向[：:][^。]*。/g, '');
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/[\s，。、《》「」『』“”"'：:；;！!？?,.\-—…·（）()[\]【】]/g, '').toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function jaccard(A: Set<string>, B: Set<string>): number {
  if (!A.size || !B.size) return 0;
  let n = 0;
  const [s, l] = A.size < B.size ? [A, B] : [B, A];
  for (const x of s) if (l.has(x)) n++;
  return n / (A.size + B.size - n);
}
/** 两根新枝的字面相似度（0–1） */
export function textSim(a: Pick<Idea, 'title' | 'bridge' | 'idea'>, b: Pick<Idea, 'title' | 'bridge' | 'idea'>): number {
  return jaccard(bigrams(branchCore(a)), bigrams(branchCore(b)));
}
export function cosine(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let d = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

export type SimMethod = 'text' | 'vector';
export interface DistinctOpts {
  /** 阈值：相似度 ≥ 它就算撞车 */
  threshold: number;
  method?: SimMethod;
  /** 向量：每根新枝（和每个候选）的向量；没有就用字面 */
  vec?: (b: Idea) => number[] | undefined;
}
export interface DistinctReport {
  /** 换掉了几根 */
  replaced: number;
  /** 最后两两最大相似度 */
  maxSim: number;
  method: SimMethod;
  /** 比较前两两最大相似度 */
  before: number;
}

function simOf(a: Idea, b: Idea, o: DistinctOpts): number {
  if (o.method === 'vector' && o.vec) {
    const va = o.vec(a);
    const vb = o.vec(b);
    if (va && vb) return cosine(va, vb);
  }
  return textSim(a, b);
}
/** 两两最大相似度 */
export function maxPairSim(list: Idea[], o: DistinctOpts): number {
  let m = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) m = Math.max(m, simOf(list[i], list[j], o));
  return m;
}

/**
 * 不撞车：从前往后，和前面留下的任何一根相似度 ≥ 阈值的就换掉——换成候选池里变形法不和其他两根重复、
 * 和留下的几根最不像（且低于阈值）的那根；候选都不够格就挑最不像的那根（尽量拉开）。被换上的标 distinct = 'replaced'。
 */
export function enforceDistinct(branches: Idea[], pool: () => Idea[], o: DistinctOpts): { branches: Idea[]; report: DistinctReport } {
  const method: SimMethod = o.method === 'vector' && o.vec ? 'vector' : 'text';
  const opts = { ...o, method };
  const before = maxPairSim(branches, opts);
  const out: Idea[] = [];
  let replaced = 0;
  let cands: Idea[] | null = null;
  const used = new Set<string>();
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    const bSim = Math.max(0, ...out.map((k) => simOf(b, k, opts)));
    if (bSim < o.threshold) {
      out.push(b);
      continue;
    }
    cands ??= pool();
    const later = branches.slice(i + 1);
    const taken = new Set([...out, ...later].map((x) => x.transform || ''));
    let best: Idea | null = null;
    let bestScore = Infinity;
    for (const c of cands) {
      const key = c.title + '|' + c.idea;
      if (used.has(key)) continue;
      if (c.transform && taken.has(c.transform)) continue;
      const score = Math.max(0, ...[...out, ...later].map((k) => simOf(c, k, opts)));
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best && bestScore < bSim) {
      used.add(best.title + '|' + best.idea);
      out.push({ ...best, distinct: 'replaced', cliches: b.cliches });
      replaced++;
    } else out.push(b);
  }
  return { branches: out, report: { replaced, maxSim: +maxPairSim(out, opts).toFixed(3), method, before: +before.toFixed(3) } };
}

/** 0241 新颖度：这一根和穗仓里已有新枝的最大字面相似度，以及最像的那根的标题 */
export function nearestOld(b: Idea, old: Array<Pick<Idea, 'title' | 'bridge' | 'idea'>>): { sim: number; title?: string } {
  const A = bigrams(branchCore(b));
  let sim = 0;
  let title: string | undefined;
  for (const o of old) {
    const s = jaccard(A, bigrams(branchCore(o)));
    if (s > sim) {
      sim = s;
      title = o.title;
    }
  }
  return { sim: +sim.toFixed(3), title };
}

/** 新颖度角标的文案：越低越新 */
export function noveltyLabel(sim: number): string {
  const pct = Math.round(sim * 100);
  if (sim < 0.15) return `很新 · 和旧枝最像 ${pct}%`;
  if (sim < 0.35) return `和旧枝最像 ${pct}%`;
  return `有点眼熟 · 和旧枝最像 ${pct}%`;
}
