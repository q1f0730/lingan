// v0.26 0605 写入失败兜底：新穗写不进 IndexedDB（空间满 QuotaExceeded、事务被中止、库被关掉……）时，
// 不丢：把这一穗（文字、链接、标签；原图太大就只留文字）暂存进 localStorage 的待写队列，提示用户，
// 下次打开（或空间腾出来后）自动按原来的时间和 uid 补进库，重复补也只算一次。
import { ulid } from './ulid';

export const PENDING_KEY = 'glean.pending.v1';
/** 原图 data URL 超过这个就不放进 localStorage（它一共才 5MB 左右） */
export const PENDING_IMAGE_MAX = 1_200_000;

export interface PendingEntry {
  uid: string;
  createdAt: number;
  inbox?: boolean;
  imageDropped?: boolean;
  data: Record<string, unknown>;
}

const STORAGE_ERRORS = /QuotaExceeded|AbortError|DatabaseClosed|InvalidState|UnknownError|OpenFailed|TransactionInactive|ReadOnly/i;
/** 是存储层的问题（而不是数据本身不合法） */
export function isStorageError(e: unknown): boolean {
  if (!e) return false;
  const x = e as { name?: string; inner?: { name?: string }; message?: string };
  if (/Constraint|DataError|DataClone/i.test(x.name || '')) return false;
  return STORAGE_ERRORS.test(x.name || '') || STORAGE_ERRORS.test(x.inner?.name || '') || /quota/i.test(x.message || '');
}

export class PendingWriteError extends Error {
  entry: PendingEntry;
  constructor(entry: PendingEntry, cause: unknown) {
    const why = /quota/i.test(String((cause as { name?: string })?.name || (cause as Error)?.message || '')) ? '存储空间不够' : '数据库暂时写不进去';
    super(`${why}：这一穗已暂存在本机${entry.imageDropped ? '（图太大没能暂存，只留了文字）' : ''}，下次打开自动补进穗仓`);
    this.name = 'PendingWriteError';
    this.entry = entry;
  }
}

type S = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const ls = (): S | null => (typeof localStorage === 'undefined' ? null : localStorage);

export function readPending(s: S | null = ls()): PendingEntry[] {
  try {
    const a = JSON.parse(s?.getItem(PENDING_KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => x && typeof x.uid === 'string' && x.data && typeof x.data === 'object') : [];
  } catch {
    return [];
  }
}
function writePending(list: PendingEntry[], s: S | null = ls()) {
  if (!s) throw new Error('no storage');
  if (!list.length) s.removeItem(PENDING_KEY);
  else s.setItem(PENDING_KEY, JSON.stringify(list));
}

/** 把一穗放进待写队列；localStorage 也满了就抛出去（调用方报原错误） */
export function enqueuePending(data: Record<string, unknown>, at: { createdAt?: number; uid?: string; inbox?: boolean } = {}, s: S | null = ls()): PendingEntry {
  const now = Date.now();
  const createdAt = at.createdAt && at.createdAt > 0 ? at.createdAt : now;
  const d = { ...data };
  let imageDropped = false;
  if (typeof d.image === 'string' && d.image.length > PENDING_IMAGE_MAX) {
    delete d.image;
    imageDropped = true;
  }
  // Blob（缩略图之类）放不进 JSON
  for (const k of Object.keys(d)) if (typeof Blob !== 'undefined' && d[k] instanceof Blob) delete d[k];
  const entry: PendingEntry = { uid: at.uid || ulid(createdAt), createdAt, inbox: at.inbox || undefined, imageDropped: imageDropped || undefined, data: d };
  const list = readPending(s);
  list.push(entry);
  writePending(list, s);
  return entry;
}

export function pendingCount(s: S | null = ls()): number {
  try {
    return s?.getItem(PENDING_KEY) ? readPending(s).length : 0;
  } catch {
    return 0;
  }
}

/**
 * 重放：逐条补进库（已在库里的 uid 直接从队列去掉），遇到还写不进去的就停下、剩下的留着下次。
 * add / has 由调用方给（db.ts 里接 addItem 与 uid 索引），这样这里不依赖 Dexie，好测。
 */
export async function replayPending(add: (e: PendingEntry) => Promise<unknown>, has: (uid: string) => Promise<boolean>, s: S | null = ls()): Promise<{ done: number; left: number }> {
  const list = readPending(s);
  if (!list.length) return { done: 0, left: 0 };
  let done = 0;
  const left: PendingEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    try {
      if (!(await has(e.uid))) await add(e);
      done++;
    } catch {
      left.push(...list.slice(i));
      break;
    }
  }
  writePending(left, s);
  return { done, left: left.length };
}
