import Dexie, { type Table } from 'dexie';
import type { Development, Item } from './types';

export class LinganDB extends Dexie {
  items!: Table<Item, number>;
  developments!: Table<Development, number>;
  constructor(name = 'lingan') {
    super(name);
    this.version(1).stores({
      items: '++id, type, createdAt, updatedAt, *tags',
      developments: '++id, createdAt, starred',
    });
  }
}

export const db = new LinganDB();

export function normalizeTags(input: string | string[]): string[] {
  const arr = Array.isArray(input) ? input : input.split(/[,，、\s#]+/);
  const out: string[] = [];
  for (const t of arr) {
    const s = t.trim().replace(/^#/, '');
    if (s && !out.includes(s) && s.length <= 24) out.push(s);
  }
  return out.slice(0, 12);
}

export async function addItem(data: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>, d: LinganDB = db): Promise<number> {
  const now = Date.now();
  return d.items.add({ ...data, tags: normalizeTags(data.tags), createdAt: now, updatedAt: now });
}

export async function updateItem(id: number, patch: Partial<Item>, d: LinganDB = db) {
  const p: Partial<Item> = { ...patch, updatedAt: Date.now() };
  if (patch.tags) p.tags = normalizeTags(patch.tags);
  await d.items.update(id, p);
}

export interface Backup {
  app: 'lingan';
  version: 1;
  exportedAt: number;
  items: Item[];
  developments: Development[];
}

export async function exportAll(d: LinganDB = db): Promise<Backup> {
  const items = await d.items.toArray();
  const developments = await d.developments.toArray();
  return { app: 'lingan', version: 1, exportedAt: Date.now(), items, developments };
}

/** Merge import: items are re-added with new ids; developments are remapped. Returns counts. */
export async function importAll(b: unknown, d: LinganDB = db): Promise<{ items: number; developments: number }> {
  if (!b || typeof b !== 'object' || (b as Backup).app !== 'lingan' || !Array.isArray((b as Backup).items)) {
    throw new Error('不是灵感暗房的备份文件');
  }
  const bk = b as Backup;
  const map = new Map<number, number>();
  let n = 0;
  let m = 0;
  await d.transaction('rw', d.items, d.developments, async () => {
    for (const it of bk.items) {
      if (!it || typeof it.title !== 'string' || !it.type) continue;
      const { id, ...rest } = it;
      const nid = await d.items.add({ ...rest, tags: normalizeTags(rest.tags || []), createdAt: rest.createdAt || Date.now(), updatedAt: Date.now() });
      if (typeof id === 'number') map.set(id, nid);
      n++;
    }
    for (const dv of bk.developments || []) {
      if (!dv || !dv.idea) continue;
      const { id: _id, ...rest } = dv;
      void _id;
      await d.developments.add({ ...rest, itemIds: (rest.itemIds || []).map((x) => map.get(x) ?? -1).filter((x) => x > 0) });
      m++;
    }
  });
  return { items: n, developments: m };
}
