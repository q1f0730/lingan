// v0.29 作品工坊的读写（works 表）。逻辑在 works.ts，这里只管拿数据、写库。
import { db as defaultDb, ensureUids, type LinganDB } from './db';
import type { Development, Item, Work, WorkForm } from './types';
import { draftWork } from './works';

const aliveItem = (x: Item | undefined): x is Item => !!x && !x.deletedAt;

/** 按 uid 取穗（保持顺序，删掉的 / 不在的跳过） */
export async function itemsByUids(uids: string[], d: LinganDB = defaultDb): Promise<Item[]> {
  const list = [...new Set(uids.filter(Boolean))];
  if (!list.length) return [];
  const rows = await d.items.where('uid').anyOf(list).toArray();
  const m = new Map(rows.filter(aliveItem).map((x) => [x.uid!, x]));
  return list.map((u) => m.get(u)).filter(aliveItem);
}

/** 库里所有活着的音乐穗（歌单只从这里挑） */
export async function libraryMusic(d: LinganDB = defaultDb): Promise<Item[]> {
  return (await d.items.where('type').equals('music').toArray()).filter((x) => !x.deletedAt && x.polarity !== -1);
}

/** 0301 立项：从几根新枝（可以没有 = 空白作品）建一件作品，返回本机 id */
export async function createWork(form: WorkForm, devIds: number[] = [], d: LinganDB = defaultDb, opts: { title?: string; itemIds?: number[]; now?: number } = {}): Promise<number> {
  await ensureUids(d);
  const devs = ((await d.developments.bulkGet(devIds)) as Array<Development | undefined>).filter((x): x is Development => !!x && !x.deletedAt);
  const ids: number[] = [];
  for (const dv of devs) for (const id of dv.itemIds || []) if (id > 0 && !ids.includes(id)) ids.push(id);
  for (const id of opts.itemIds || []) if (id > 0 && !ids.includes(id)) ids.push(id);
  const items = ((await d.items.bulkGet(ids)) as Array<Item | undefined>).filter(aliveItem);
  const music = FORM_NEEDS_MUSIC.has(form) ? await libraryMusic(d) : [];
  const w = draftWork(form, devs, items, { title: opts.title, music, now: opts.now });
  return d.works.add(w);
}
const FORM_NEEDS_MUSIC = new Set<WorkForm>(['playlist', 'podcast']);

export async function updateWork(id: number, changes: Partial<Work>, d: LinganDB = defaultDb) {
  await d.works.update(id, changes);
}

/** 0309 加素材：已经在里面就不重复 */
export async function addMaterial(id: number, uid: string, d: LinganDB = defaultDb): Promise<boolean> {
  return d.transaction('rw', d.works, async () => {
    const w = await d.works.get(id);
    if (!w || w.itemUids.includes(uid)) return false;
    await d.works.update(id, { itemUids: [...w.itemUids, uid] });
    return true;
  });
}
export async function removeMaterial(id: number, uid: string, d: LinganDB = defaultDb) {
  await d.transaction('rw', d.works, async () => {
    const w = await d.works.get(id);
    if (!w) return;
    await d.works.update(id, { itemUids: w.itemUids.filter((x) => x !== uid) });
  });
}

/** 删除作品：墓碑（备份 / 同步能跟着走），列表里看不到 */
export async function trashWork(id: number, d: LinganDB = defaultDb, now = Date.now()) {
  await d.works.update(id, { deletedAt: now });
}
export async function untrashWork(id: number, d: LinganDB = defaultDb) {
  await d.works.update(id, { deletedAt: undefined });
}
