import type { Development, GraftBatch } from './types';

export interface BranchGroup {
  key: string;
  devs: Development[];
  /** 带张力 / 种子的那一条（batch.index 0） */
  batch?: GraftBatch;
}

/** 把新枝按「同一次嫁接」收成一捆：同 batch.id 的放一起、按 index 排；旧版单根新枝各自一组。保持输入的先后顺序。 */
export function groupBranches(devs: Development[]): BranchGroup[] {
  const out: BranchGroup[] = [];
  const byBatch = new Map<string, BranchGroup>();
  for (const d of devs) {
    const bid = d.batch?.id;
    if (!bid) {
      out.push({ key: `d${d.id}`, devs: [d] });
      continue;
    }
    let g = byBatch.get(bid);
    if (!g) {
      g = { key: bid, devs: [] };
      byBatch.set(bid, g);
      out.push(g);
    }
    g.devs.push(d);
    if (d.batch && (d.batch.tensions || d.batch.seeds)) g.batch = d.batch;
  }
  for (const g of byBatch.values()) g.devs.sort((a, b) => (a.batch?.index ?? 0) - (b.batch?.index ?? 0));
  return out;
}
