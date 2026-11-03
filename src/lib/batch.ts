// v0.23 一次整理一把（ROADMAP v0.40）+ 标签合并（0103）+ 补为什么 / AI 新词确认：写库的整理动作。
import { db, normalizeTags, type LinganDB } from './db';
import { rewriteTags } from './organize';
import { addAliases, loadAliases, saveAliases } from './tagalias';
import type { Item, ItemType } from './types';

const ids_ = (ids: number[]) => [...new Set(ids.filter((x) => x > 0))];

/** 给一批穗加标签（已有的不重复，最多 12 个）。返回改了几件 */
export async function addTagsTo(ids: number[], tags: string[], d: LinganDB = db): Promise<number> {
  const list = ids_(ids);
  const add = normalizeTags(tags);
  if (!list.length || !add.length) return 0;
  let n = 0;
  await d.transaction('rw', d.items, async () => {
    n = await d.items
      .where(':id')
      .anyOf(list)
      .modify((it: Item) => {
        const next = normalizeTags([...it.tags, ...add]);
        if (next.join('\u0001') !== it.tags.join('\u0001')) it.tags = next;
      });
  });
  return n;
}

/** 从一批穗上去掉某个标签 */
export async function removeTagFrom(ids: number[], tag: string, d: LinganDB = db): Promise<number> {
  const list = ids_(ids);
  if (!list.length) return 0;
  let n = 0;
  await d.transaction('rw', d.items, async () => {
    n = await d.items
      .where(':id')
      .anyOf(list)
      .modify((it: Item) => {
        if (it.tags.includes(tag)) it.tags = it.tags.filter((t) => t !== tag);
      });
  });
  return n;
}

/** 一批穗改类型 */
export async function setTypeOf(ids: number[], type: ItemType, d: LinganDB = db): Promise<Array<{ id: number; type: ItemType }>> {
  const list = ids_(ids);
  const before: Array<{ id: number; type: ItemType }> = [];
  if (!list.length) return before;
  await d.transaction('rw', d.items, async () => {
    await d.items
      .where(':id')
      .anyOf(list)
      .modify((it: Item) => {
        if (it.type !== type) {
          before.push({ id: it.id!, type: it.type });
          it.type = type;
        }
      });
  });
  return before;
}
/** 撤销改类型 */
export async function restoreTypes(prev: Array<{ id: number; type: ItemType }>, d: LinganDB = db) {
  if (!prev.length) return;
  await d.transaction('rw', d.items, async () => {
    for (const p of prev) await d.items.update(p.id, { type: p.type });
  });
}

/** 0103 合并标签：所有穗上的 from 改写成 to，并记成别名（以后输入别名也自动写成 to） */
export async function mergeTags(from: string[], to: string, d: LinganDB = db): Promise<number> {
  const target = normalizeTags([to])[0] || to.trim();
  const src = [...new Set(from.filter((x) => x && x !== target))];
  if (!target || !src.length) return 0;
  // 先记别名（改写时 normalizeTags 已经会把别名换成正名）
  saveAliases(addAliases(src, target, loadAliases()));
  let n = 0;
  await d.transaction('rw', d.items, async () => {
    n = await d.items
      .where('tags')
      .anyOf(src)
      .distinct()
      .modify((it: Item) => {
        const next = rewriteTags(it.tags, src, target);
        if (next) it.tags = next;
      });
  });
  return n;
}

/** 补一句为什么（补完也算整理过：出待理） */
export async function setWhy(id: number, why: string, d: LinganDB = db) {
  const w = why.trim();
  if (!w) return;
  await d.items.update(id, { why: w });
  const it = await d.items.get(id);
  if (it?.inbox) await d.items.where(':id').equals(id).modify((x: Item) => void delete x.inbox);
}

/** 0110 AI 想加的新词：点头 = 加进标签；摇头 = 不要了 */
export async function acceptSugg(id: number, tag: string, d: LinganDB = db) {
  const it = await d.items.get(id);
  if (!it) return;
  await d.items.update(id, { tags: normalizeTags([...it.tags, tag]), tagSugg: (it.tagSugg || []).filter((t) => t !== tag) });
}
export async function dropSugg(id: number, tag?: string, d: LinganDB = db) {
  const it = await d.items.get(id);
  if (!it) return;
  const rest = tag ? (it.tagSugg || []).filter((t) => t !== tag) : [];
  await d.items.where(':id').equals(id).modify((x: Item) => {
    if (rest.length) x.tagSugg = rest;
    else delete x.tagSugg;
  });
}
