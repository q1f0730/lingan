// v0.38 母题与星图（只被口味页懒加载）：
// - 0106 母题聚类：有向量（同一个模型算过 ≥80% 的穗）用向量，没有就用「标签 + 为什么 / 标题二元字」的 TF-IDF（哈希到 512 维）；
//   球面 k-means（k = √n，3–15 簇，k-means++ 固定种子，结果稳定），簇名取簇里最有区分度的标签 / 二元字（离线，不调模型）。
// - 0123 母题消长：近 60 天 vs 再往前 60 天。0124 跨媒介：簇里有 ≥3 种类型。
// - ROADMAP v0.39 星图：同一批向量 PCA 到二维。
import type { Item, ItemType } from './types';

const DAY = 86400000;
const CAP = 3000; // 只看最近 3000 穗，免得 5 万穗时口味页卡住
const STOP = /[的了是在我你他她它这那就也和与着过吗呢吧啊一个有不人们到说要会很都还没为把被让给从对]/;

export interface Motif {
  c: number;
  name: string;
  words: string[];
  ids: number[];
  types: ItemType[];
  cross: boolean;
  /** 近 60 天 − 之前 60 天 */
  trend: number;
  recent: number;
}
export interface MotifMap {
  how: 'vector' | 'text';
  motifs: Motif[];
  /** 星图用：穗 id、所属簇、向量（展开星图时才投到二维） */
  ids: number[];
  as: number[];
  vs: Float32Array[];
}
export type Star = { id: number; x: number; y: number; c: number };
/** 星图：每穗的二维坐标（-1..1）和所属簇 */
export function stars(mm: MotifMap): Star[] {
  const xy = project(mm.vs);
  return mm.ids.map((id, i) => ({ id, x: xy[i][0], y: xy[i][1], c: mm.as[i] }));
}

const bigrams = (s: string) => {
  const h = (s || '').replace(/[^\u4e00-\u9fff]/g, '');
  const out: string[] = [];
  for (let i = 0; i < h.length - 1; i++) {
    const b = h.slice(i, i + 2);
    if (!STOP.test(b)) out.push(b);
  }
  return out;
};
/** 一穗的词：标签（权重 2）+ 为什么 / 标题 / 作者的二元字 */
export function terms(it: Item): string[] {
  return [...it.tags.map((t) => '#' + t), ...new Set([...bigrams(it.why || ''), ...bigrams(it.title), ...bigrams(it.content || '').slice(0, 30)])];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const norm = (v: Float32Array) => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
};
const dot = (a: Float32Array, b: Float32Array) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
};

/** 选向量：同一个模型算过 ≥80% 就用它，否则 TF-IDF */
export function vectorize(items: Item[]): { how: 'vector' | 'text'; rows: Item[]; vs: Float32Array[] } {
  const m = new Map<string, number>();
  for (const it of items) if (it.embedding?.length && it.embedModel) m.set(it.embedModel, (m.get(it.embedModel) || 0) + 1);
  const [model, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  if (n >= 8 && n >= items.length * 0.8) {
    const rows = items.filter((it) => it.embedModel === model && it.embedding?.length);
    return { how: 'vector', rows, vs: rows.map((it) => norm(Float32Array.from(it.embedding!))) };
  }
  const tl = items.map(terms);
  const df = new Map<string, number>();
  for (const t of tl) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const vs = tl.map((t) => {
    const v = new Float32Array(512);
    for (const w of t) if ((df.get(w) || 0) > 1) v[hash(w) % 512] += (w[0] === '#' ? 2 : 1) * Math.log(items.length / df.get(w)!);
    return norm(v);
  });
  return { how: 'text', rows: items, vs };
}

/** 球面 k-means，k-means++ 用固定种子（同一批穗每次分得一样） */
export function kmeans(vs: Float32Array[], k: number, iters = 12): number[] {
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const cs: Float32Array[] = [vs[Math.floor(rnd() * vs.length)].slice()];
  const best = vs.map((v) => 1 - dot(v, cs[0]));
  while (cs.length < k) {
    let sum = 0;
    for (const d of best) sum += d * d;
    let r = rnd() * sum,
      j = 0;
    while (j < vs.length - 1 && (r -= best[j] * best[j]) > 0) j++;
    cs.push(vs[j].slice());
    vs.forEach((v, i) => (best[i] = Math.min(best[i], 1 - dot(v, cs[cs.length - 1]))));
  }
  const as = new Array<number>(vs.length).fill(-1);
  for (let t = 0; t < iters; t++) {
    let moved = 0;
    vs.forEach((v, i) => {
      let b = 0,
        bs = -2;
      cs.forEach((c, j) => {
        const s = dot(v, c);
        if (s > bs) {
          bs = s;
          b = j;
        }
      });
      if (as[i] !== b) {
        moved++;
        as[i] = b;
      }
    });
    if (!moved) break;
    const acc = cs.map(() => new Float32Array(vs[0].length));
    vs.forEach((v, i) => v.forEach((x, d) => (acc[as[i]][d] += x)));
    acc.forEach((c, j) => {
      if (c.some((x) => x)) cs[j] = norm(c);
    });
  }
  return as;
}

/** PCA 到二维（幂迭代），坐标缩到 -1..1 */
export function project(vs: Float32Array[]): Array<[number, number]> {
  const D = vs[0]?.length || 0;
  const mean = new Float32Array(D);
  for (const v of vs) v.forEach((x, d) => (mean[d] += x / vs.length));
  const X = vs.map((v) => v.map((x, d) => x - mean[d]));
  const comps: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    let p = norm(Float32Array.from({ length: D }, (_, d) => Math.sin(d * 12.9898 + c * 78.233)));
    for (let t = 0; t < 15; t++) {
      const n = new Float32Array(D);
      for (const x of X) {
        const s = dot(x, p);
        x.forEach((v, d) => (n[d] += s * v));
      }
      for (const q of comps) {
        const s = dot(n, q);
        n.forEach((_, d) => (n[d] -= s * q[d]));
      }
      p = norm(n);
    }
    comps.push(p);
  }
  const xy = X.map((x) => [dot(x, comps[0]), dot(x, comps[1])] as [number, number]);
  const m = Math.max(1e-9, ...xy.map(([a, b]) => Math.max(Math.abs(a), Math.abs(b))));
  return xy.map(([a, b]) => [a / m, b / m]);
}

export function motifMap(all: Item[], now = Date.now()): MotifMap | null {
  const items = all
    .filter((x) => !x.deletedAt && x.polarity !== -1 && x.id != null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, CAP);
  if (items.length < 12) return null;
  const { how, rows, vs } = vectorize(items);
  const k = Math.min(15, Math.max(3, Math.round(Math.sqrt(rows.length))));
  const as = kmeans(vs, k);
  const df = new Map<string, number>();
  const tl = rows.map(terms);
  for (const t of tl) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const motifs: Motif[] = [];
  for (let c = 0; c < k; c++) {
    const idx = as.flatMap((a, i) => (a === c ? [i] : []));
    if (idx.length < 2) continue;
    const tf = new Map<string, number>();
    for (const i of idx) for (const w of new Set(tl[i])) tf.set(w, (tf.get(w) || 0) + 1);
    const words = [...tf.entries()]
      .filter(([w, n]) => n >= 2 && w.replace('#', '').length <= 6)
      .map(([w, n]) => [w, (n / idx.length) * Math.log(rows.length / df.get(w)!) * (w[0] === '#' ? 1.5 : 1)] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .map(([w]) => w.replace('#', ''))
      .filter((w, i, a) => a.indexOf(w) === i)
      .slice(0, 4);
    const types = [...new Set(idx.map((i) => rows[i].type))];
    const recent = idx.filter((i) => rows[i].createdAt >= now - 60 * DAY).length;
    const before = idx.filter((i) => rows[i].createdAt < now - 60 * DAY && rows[i].createdAt >= now - 120 * DAY).length;
    motifs.push({ c, name: words[0] || rows[idx[0]].tags[0] || '无名', words: words.slice(1), ids: idx.map((i) => rows[i].id!), types, cross: types.length >= 3, trend: recent - before, recent });
  }
  motifs.sort((a, b) => b.ids.length - a.ids.length);
  return { how, motifs, ids: rows.map((it) => it.id!), as, vs };
}
