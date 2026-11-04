// v0.38 穗与穗之间的关系（只被详情页懒加载）：
// - 0104 作品实体：同一部电影 / 专辑 / 书的几穗（剧照、台词、影评链接）按「作品名 + 作者」归成一个作品；
//   Item.work 可手动改：'' = 拆出来不归入，写名字 = 归到那一部（没加索引，随同步）。0153 同曲不同平台：名字去掉版本括号、繁简标点、大小写再比。
// - 0105 穗间连线：像 / 反着 / 引出 / 回应。两头各存一条（Item.links，存对方 uid；r=1 是被连的那一头），换设备也不断。
// - 0151 一起被嫁接过：从新枝的素材里数共现。
import { db } from './db';
import { similarity } from './similarity';
import type { Development, Item, ItemLink, LinkKind } from './types';

export const LINK_LABEL: Record<LinkKind, [string, string]> = { like: ['像', '像'], anti: ['反着', '反着'], lead: ['引出', '由它引出'], reply: ['回应', '被回应'] };
export const LINK_KINDS = Object.keys(LINK_LABEL) as LinkKind[];

/** 作品名规范化：全角半角、大小写、空白标点、（Live）/ (2019 Remaster) / 【4K】这类版本括号都不算 */
export function normWork(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[(（[【][^)）\]】]*[)）\]】]/g, '')
    .replace(/\s*[-–—]\s*(live|remaster(ed)?|\d{4} remaster(ed)?|伴奏|现场版|翻唱).*$/i, '')
    .replace(/[\s·・.,，。:：!！?？'"“”‘’《》「」『』~～\-–—_/]+/g, '');
}

/** 这一穗属于哪部作品（显示用的名字）；'' = 不属于 */
export function workName(it: Pick<Item, 'type' | 'title' | 'work'>): string {
  if (it.work !== undefined) return it.work.trim();
  const m = /《([^》]{1,60})》/.exec(it.title || '');
  if (m) return m[1].trim();
  return it.type === 'film' || it.type === 'music' || it.type === 'text' ? (it.title || '').trim().replace(/^《|》$/g, '') : '';
}

const who = (it: Pick<Item, 'creator'>) => normWork(it.creator || '');

/** 同一作品的其它穗：名字规范化后相同，且作者不冲突（有一边没写作者也算） */
export function sameWork(it: Item, all: Item[]): Item[] {
  const k = normWork(workName(it));
  if (!k) return [];
  const c = who(it);
  return all.filter((x) => x.id !== it.id && !x.deletedAt && normWork(workName(x)) === k && (!c || !who(x) || who(x) === c));
}

/** 连线 a → b：两头各加一条（同一对之间只留一条，换种类就覆盖） */
export function withLink(links: ItemLink[] | undefined, to: string, k: LinkKind, r?: 1): ItemLink[] {
  return [...(links || []).filter((l) => l.to !== to), { to, k, at: Date.now(), ...(r ? { r } : {}) }];
}
export function withoutLink(links: ItemLink[] | undefined, to: string): ItemLink[] | undefined {
  const out = (links || []).filter((l) => l.to !== to);
  return out.length ? out : undefined;
}

/** 0151 常和它一起被嫁接的穗：id → 次数，前 n 个 */
export function coGrafted(devs: Development[], id: number, n = 5): Array<[number, number]> {
  const m = new Map<number, number>();
  for (const d of devs) if (!d.deletedAt && d.itemIds.includes(id)) for (const x of new Set(d.itemIds)) if (x !== id) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, n);
}

/**
 * v0.41 0132 随机漫步：从这一穗跳到和它最相关、这一趟还没走过的一穗。
 * 优先级：连线（两头都算）> 同一部作品 > 一起被嫁接过 > 相近（有向量用向量，没有用字面 + 同类型）；都走过了就随便挑一穗没走过的。
 */
export interface WalkStep {
  x: Item;
  why: string;
}
export function walkNext(it: Item, all: Item[], devs: Development[], seen: Set<number>, rand: () => number = Math.random): WalkStep | null {
  const pool = all.filter((x) => x.id != null && x.id !== it.id && !x.deletedAt && !x.down && !seen.has(x.id));
  if (!pool.length) return null;
  const byUid = new Map(pool.map((x) => [x.uid, x]));
  for (const l of it.links || []) {
    const x = byUid.get(l.to);
    if (x) return { x, why: '连线 · ' + LINK_LABEL[l.k][l.r ? 1 : 0] };
  }
  for (const x of pool) if (it.uid && (x.links || []).some((l) => l.to === it.uid)) return { x, why: '连线' };
  const mate = sameWork(it, pool)[0];
  if (mate) return { x: mate, why: '同一部作品' };
  const ids = new Set(pool.map((x) => x.id));
  const co = it.id != null ? coGrafted(devs, it.id, 20).find(([id]) => ids.has(id)) : undefined;
  if (co) return { x: pool.find((x) => x.id === co[0])!, why: `一起被嫁接过 ${co[1]} 次` };
  let best: Item | null = null;
  let bs = 0.08;
  for (const x of pool) {
    const v = similarity(it, x);
    if (v > bs) (bs = v), (best = x);
  }
  if (best) return { x: best, why: '相近' };
  return { x: pool[Math.floor(rand() * pool.length)], why: '随便走走' };
}
export const WALK_KEY = 'glean.walk';

// ── 写入（仓储层规则：视图不直接写库）──
export const setWork = async (id: number, work: string | undefined) => void (await db.items.update(id, { work }));

/** a → b 连一条（两头在同一个事务里写）；off = 拆掉 */
export async function linkItems(a: Item, b: Item, k: LinkKind | null) {
  if (!a.uid || !b.uid || a.id == null || b.id == null || a.id === b.id) return;
  await db.transaction('rw', db.items, async () => {
    const [x, y] = await db.items.bulkGet([a.id!, b.id!]);
    if (!x || !y) return;
    await db.items.update(a.id!, { links: k ? withLink(x.links, b.uid!, k) : withoutLink(x.links, b.uid!) });
    await db.items.update(b.id!, { links: k ? withLink(y.links, a.uid!, k, 1) : withoutLink(y.links, a.uid!) });
  });
}
