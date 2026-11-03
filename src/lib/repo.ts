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
export const setFollowups = (id: number, followups: Development['followups']) => db.developments.update(id, { followups });
/** 挂一穗结果：做过了（tried 保持 tried） */
export async function attachResult(id: number, uid: string | undefined) {
  const fresh = await db.developments.get(id);
  if (!fresh) return;
  await db.developments.update(id, { resultUids: [...(fresh.resultUids || []), uid].filter(Boolean) as string[], status: fresh.status === 'tried' ? 'tried' : 'done', statusAt: Date.now() });
}
