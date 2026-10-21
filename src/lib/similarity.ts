import type { Item } from './types';

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function itemText(it: Item): string {
  return [it.title, it.creator, it.year, it.content, it.why, it.caption, it.tags.join(' ')].filter(Boolean).join(' ');
}

/** character bigram + tag tokens, for offline similarity */
export function tokens(it: Item): Set<string> {
  const s = new Set<string>();
  for (const t of it.tags) s.add('#' + t.toLowerCase());
  s.add('@' + it.type);
  if (it.creator) s.add('c:' + it.creator.toLowerCase());
  const txt = itemText(it).toLowerCase().replace(/\s+/g, ' ');
  const words = txt.match(/[a-z0-9]+/g) || [];
  for (const w of words) if (w.length > 2) s.add('w:' + w);
  const han = txt.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < han.length - 1; i++) s.add(han.slice(i, i + 2));
  return s;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** similarity in [0,1] */
export function similarity(a: Item, b: Item): number {
  if (a.embedding && b.embedding && a.embedModel === b.embedModel && a.embedding.length === b.embedding.length) {
    return Math.max(0, Math.min(1, cosine(a.embedding, b.embedding)));
  }
  // offline proxy, scaled so typical values spread over 0..1
  const j = jaccard(tokens(a), tokens(b));
  return Math.min(1, j * 3 + (a.type === b.type ? 0.15 : 0));
}

export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function daySeed(d = new Date()): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Pick n items. jump in [0,1]: 0 = close neighbours, 1 = as far apart as possible.
 * Greedy: random seed item, then each next item minimises |avgSim - target| among the rest,
 * choosing randomly among the 3 best to keep it fresh.
 */
export function pickItems(items: Item[], n: number, jump: number, rand: () => number = Math.random): Item[] {
  const pool = items.filter((i) => i.id != null);
  if (pool.length <= n) return [...pool];
  const isEmb = pool.filter((i) => i.embedding).length >= pool.length * 0.6;
  // target similarity: embeddings live roughly in 0.2..0.9, proxy in 0..0.8
  const hi = isEmb ? 0.85 : 0.7;
  const lo = isEmb ? 0.15 : 0.0;
  const target = hi - (hi - lo) * Math.max(0, Math.min(1, jump));
  const chosen: Item[] = [pool[Math.floor(rand() * pool.length)]];
  while (chosen.length < n) {
    const rest = pool.filter((p) => !chosen.includes(p));
    const scored = rest.map((r) => {
      const avg = chosen.reduce((s, c) => s + similarity(r, c), 0) / chosen.length;
      const typeBonus = jump > 0.5 && chosen.some((c) => c.type === r.type) ? 0.08 : 0;
      return { r, d: Math.abs(avg - target) + typeBonus };
    });
    scored.sort((a, b) => a.d - b.d);
    const top = scored.slice(0, Math.min(3, scored.length));
    chosen.push(top[Math.floor(rand() * top.length)].r);
  }
  return chosen;
}
