// v0.37 0709 仓储层：视图和组件不直接写库，所有写入都经这里（或 db.ts / 各 lib 里已有的写函数）。
// - 统一盖章：HLC / deviceId / 字段时间由 db.ts 的 Dexie 钩子在任何写入上做，全文索引增量由 ftsync 钩子做——这两件不会漏；
// - 这一层负责「改了这个字段要连带什么」：updatedAt / touchedAt、为什么变了向量作废、状态变了记时间。
// src/__tests__/repo.test.ts 扫 src/views、src/components、App.tsx 的源码：出现 db.<表>.add / put / update / delete / modify … 就失败。
import { db, updateItem } from './db';
import type { Development, Item } from './types';

export { addItem, updateItem, trashItems, untrashItems, deleteItem, restoreItem, keepItems, mergeInto } from './db';

/** 后台补全（链接标题 / 封面信息）：不算「用户碰过」（不记 touchedAt；updatedAt / HLC 照常由钩子盖） */
export const fillItem = (id: number, patch: Partial<Item>) => db.items.update(id, patch);

/** 补一句为什么 / 标签：内容变了，旧向量作废，等后台重算 */
export const amendItem = (id: number, patch: Pick<Item, 'why' | 'tags'>) =>
  db.items.update(id, { ...patch, updatedAt: Date.now(), embedding: undefined, embedModel: undefined });

export const clearPolarity = (id: number) => db.items.update(id, { polarity: undefined });

/** 花园：放进 / 拿出（私密穗的过滤在调用方） */
export const setGarden = (ids: number[], on: boolean) =>
  db.items.where(':id').anyOf(ids).modify((x: Item) => void (on ? (x.garden = 1) : delete x.garden));

/** v0.39 0934 按标签批量开 / 关某个出口；返回改了几穗（经 updateItem，随同步） */
export async function shutByTag(tag: string, exit: string, close: boolean): Promise<number> {
  const rows = (await db.items.where('tags').equals(tag).toArray()).filter((x) => !x.deletedAt && !!x.shut?.includes(exit) !== close);
  for (const r of rows) {
    const shut = close ? [...(r.shut || []), exit] : (r.shut || []).filter((x) => x !== exit);
    await updateItem(r.id!, { shut: shut.length ? shut : undefined });
  }
  return rows.length;
}

// ── 新枝 ──
export const addDevelopment = (dev: Development) => db.developments.add(dev);
export const addDevelopments = (devs: Development[]) => db.developments.bulkAdd(devs, { allKeys: true }) as Promise<number[]>;
export const setStar = (ids: number | number[], on: boolean) =>
  db.developments.bulkUpdate((Array.isArray(ids) ? ids : [ids]).map((key) => ({ key, changes: { starred: on } })));
export const setDevStatus = (id: number, status: Development['status']) => db.developments.update(id, { status, statusAt: Date.now() });
/** v0.42 ROADMAP v0.32 意外程度（再点同一格 = 取消） */
export const setSurprise = (id: number, n: number | undefined) => db.developments.update(id, { surprise: n && n >= 1 && n <= 5 ? Math.round(n) : undefined });
/** v0.42 0238 复制 / 分享出去了（采用信号） */
export const markOut = (id: number) => db.developments.update(id, { out: Date.now() });
export const setFollowups = (id: number, followups: Development['followups']) => db.developments.update(id, { followups });
/** 挂一穗结果：做过了（tried 保持 tried） */
export async function attachResult(id: number, uid: string | undefined) {
  const fresh = await db.developments.get(id);
  if (!fresh) return;
  await db.developments.update(id, { resultUids: [...(fresh.resultUids || []), uid].filter(Boolean) as string[], status: fresh.status === 'tried' ? 'tried' : 'done', statusAt: Date.now() });
}

// ── v0.40 时间与回看 ──
/** 0131 / 0915 再看一句（y = 满一年时的「现在的为什么」）：只追加，不改原来的为什么 */
export const addRevisit = (id: number, prev: Item['revisits'], text: string, y?: boolean) =>
  db.items.update(id, { revisits: [...(prev || []), { text, at: Date.now(), ...(y ? { y: 1 as const } : {}) }], touchedAt: Date.now() });
/** 0938 放下 / 拿回来；0925「留着」= 记一次碰过 */
export const setDown = (ids: number[], on: boolean) =>
  db.items.where(':id').anyOf(ids).modify((x: Item) => void (on ? (x.down = Date.now()) : delete x.down));
export const keepAround = (ids: number[]) => db.items.where(':id').anyOf(ids).modify({ touchedAt: Date.now() });

// ── v0.45 0924 封存到某天 ──
/** 封存到 at（那天 0 点）：之前不在穗仓 / 搜索 / 每日一穗 / 嫁接里出现 */
export const sealItem = (id: number, at: number) => db.items.update(id, { sealUntil: at, sealAt: Date.now() });
/** 拆开：回到穗仓，记一次碰过 */
export const unsealItem = (id: number) =>
  db.items.where(':id').equals(id).modify((x: Item) => void (delete x.sealUntil, delete x.sealAt, (x.touchedAt = Date.now())));
