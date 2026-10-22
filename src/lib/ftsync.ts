// v0.17 秒搜：把全文索引和数据库绑在一起。
// - 打开 App：先把 ftidx 表读进内存倒排表（不切词），再在空闲时分批补齐 / 更新过期的行（旧数据后台建索引）。
// - 增删改穗 / 新枝：Dexie 钩子记下改了哪几行，事务提交后只重切这几行（增量）。
// - 搜索期间索引还没补完也不怕：searchDocs 会把没进索引的文档直接扫一遍。
import type { LinganDB } from './db';
import { SearchIndex, branchFields, itemFields, signature, tokenize, type SearchField } from './search';
import type { Development, FtRow, Item } from './types';

export interface FtStatus {
  ready: boolean;
  /** 库里的穗 + 新枝 */
  total: number;
  /** 其中索引是最新的 */
  indexed: number;
  /** 这次打开后新切词的行数（含增量） */
  built: number;
  rows: number;
  loadMs: number;
  buildMs: number;
  /** 最近一次搜索的计算耗时（不含渲染） */
  lastMs: number;
  lastQuery: string;
  lastHits: number;
}

declare global {
  interface Window {
    __gleanSearch?: FtStatus;
  }
}

const ITEM_KEYS = new Set(['title', 'creator', 'year', 'content', 'why', 'tags', 'caption', 'url']);
const DEV_KEYS = new Set(['idea', 'theme']);

type Yield = () => Promise<void>;
const noYield: Yield = () => Promise.resolve();

function rowOf(kind: 'i' | 'b', id: number, fields: SearchField[], sig = signature(fields)): FtRow {
  return { key: `${kind}:${id}`, kind, ref: id, sig, tok: tokenize(fields) };
}

export class FtSync {
  readonly index = new SearchIndex();
  readonly status: FtStatus = { ready: false, total: 0, indexed: 0, built: 0, rows: 0, loadMs: 0, buildMs: 0, lastMs: 0, lastQuery: '', lastHits: 0 };
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private loaded = false;
  private attached = false;

  readonly d: LinganDB;
  constructor(d: LinganDB) {
    this.d = d;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getRev = () => this.index.rev;
  private emit() {
    this.listeners.forEach((f) => f());
  }

  /** 挂 Dexie 钩子：任何写穗 / 新枝的地方（新增、编辑、删除、导入、撤销、补图片描述……）都会被记下 */
  attach() {
    if (this.attached) return;
    this.attached = true;
    const mark = (key: string) => {
      this.dirty.add(key);
      if (this.timer) clearTimeout(this.timer);
      // 写事务提交之后再读（IndexedDB 会把读排在写后面）
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 30);
    };
    const changed = (mods: object, keys: Set<string>) => Object.keys(mods).some((k) => keys.has(k.split('.')[0]));
    this.d.items.hook('creating', function () {
      this.onsuccess = (pk) => mark(`i:${pk}`);
    });
    this.d.items.hook('updating', (mods, pk) => {
      if (changed(mods, ITEM_KEYS)) mark(`i:${pk}`);
    });
    this.d.items.hook('deleting', (pk) => mark(`i:${pk}`));
    this.d.developments.hook('creating', function () {
      this.onsuccess = (pk) => mark(`b:${pk}`);
    });
    this.d.developments.hook('updating', (mods, pk) => {
      if (changed(mods, DEV_KEYS)) mark(`b:${pk}`);
    });
    this.d.developments.hook('deleting', (pk) => mark(`b:${pk}`));
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** 把已存的索引读进内存（不切词） */
  load(): Promise<void> {
    return this.serial(async () => {
      if (this.loaded) return;
      const t0 = performance.now();
      const rows = await this.d.ftidx.toArray();
      for (const r of rows) if (r && r.key && Array.isArray(r.tok)) this.index.set(r.key, r.tok, r.sig);
      this.loaded = true;
      this.status.rows = rows.length;
      this.status.loadMs = Math.round(performance.now() - t0);
      this.emit();
    });
  }

  /** 全量对账：缺的、过期的重切，已删的去掉。分批写，每批之间让出主线程 */
  reconcile(yieldFn: Yield = noYield, batch = 150): Promise<void> {
    return this.serial(async () => {
      const t0 = performance.now();
      const items = (await this.d.items.toArray()) as Item[];
      const devs = (await this.d.developments.toArray()) as Development[];
      const live = new Set<string>();
      const todo: Array<{ kind: 'i' | 'b'; id: number; fields: SearchField[]; sig: string }> = [];
      for (const it of items) {
        if (it.id == null) continue;
        const f = itemFields(it);
        const sig = signature(f);
        live.add(`i:${it.id}`);
        if (this.index.sigOf(`i:${it.id}`) !== sig) todo.push({ kind: 'i', id: it.id, fields: f, sig });
      }
      for (const dv of devs) {
        if (dv.id == null || !dv.idea) continue;
        const f = branchFields(dv);
        const sig = signature(f);
        live.add(`b:${dv.id}`);
        if (this.index.sigOf(`b:${dv.id}`) !== sig) todo.push({ kind: 'b', id: dv.id, fields: f, sig });
      }
      const gone = [...this.index.keys()].filter((k) => !live.has(k));
      this.status.total = live.size;
      this.status.indexed = live.size - todo.length;
      if (gone.length) {
        await this.d.ftidx.bulkDelete(gone);
        for (const k of gone) this.index.remove(k);
      }
      for (let i = 0; i < todo.length; i += batch) {
        const rows = todo.slice(i, i + batch).map((x) => rowOf(x.kind, x.id, x.fields, x.sig));
        await this.d.ftidx.bulkPut(rows);
        for (const r of rows) this.index.set(r.key, r.tok, r.sig);
        this.status.built += rows.length;
        this.status.indexed += rows.length;
        this.emit();
        if (i + batch < todo.length) await yieldFn();
      }
      this.status.rows = this.index.size;
      this.status.buildMs = Math.round(performance.now() - t0);
      this.status.ready = true;
      this.emit();
    });
  }

  /** 增量：只处理钩子记下的那几行 */
  flush(): Promise<void> {
    return this.serial(async () => {
      if (!this.dirty.size) return;
      const keys = [...this.dirty];
      this.dirty.clear();
      const iIds = keys.filter((k) => k.startsWith('i:')).map((k) => Number(k.slice(2)));
      const bIds = keys.filter((k) => k.startsWith('b:')).map((k) => Number(k.slice(2)));
      const its = iIds.length ? await this.d.items.bulkGet(iIds) : [];
      const dvs = bIds.length ? await this.d.developments.bulkGet(bIds) : [];
      const puts: FtRow[] = [];
      const dels: string[] = [];
      iIds.forEach((id, n) => {
        const it = its[n];
        if (!it) dels.push(`i:${id}`);
        else {
          const f = itemFields(it);
          const sig = signature(f);
          if (this.index.sigOf(`i:${id}`) !== sig) puts.push(rowOf('i', id, f, sig));
        }
      });
      bIds.forEach((id, n) => {
        const dv = dvs[n];
        if (!dv || !dv.idea) dels.push(`b:${id}`);
        else {
          const f = branchFields(dv);
          const sig = signature(f);
          if (this.index.sigOf(`b:${id}`) !== sig) puts.push(rowOf('b', id, f, sig));
        }
      });
      if (!puts.length && !dels.length) return;
      await this.d.transaction('rw', this.d.ftidx, async () => {
        if (dels.length) await this.d.ftidx.bulkDelete(dels);
        if (puts.length) await this.d.ftidx.bulkPut(puts);
      });
      for (const k of dels) this.index.remove(k);
      for (const r of puts) this.index.set(r.key, r.tok, r.sig);
      this.status.built += puts.length;
      this.status.rows = this.index.size;
      this.emit();
    });
  }

  /** 等所有排队的增量写完（测试用） */
  async settle(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

function idle(): Promise<void> {
  return new Promise((res) => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => res(), { timeout: 200 });
    else setTimeout(res, 16);
  });
}

let shared: FtSync | null = null;
/** App 里唯一的索引（绑在默认库上） */
export function ftShared(d?: LinganDB): FtSync {
  if (!shared) {
    if (!d) throw new Error('ftShared: no db');
    shared = new FtSync(d);
    shared.attach();
    if (typeof window !== 'undefined') window.__gleanSearch = shared.status;
  }
  return shared;
}

let started = false;
/** 首屏之后：读索引 → 空闲时分批补齐旧数据 */
export function startSearchIndex(d: LinganDB, delay = 600) {
  const ft = ftShared(d);
  if (started) return ft;
  started = true;
  setTimeout(() => {
    void idle()
      .then(() => ft.load())
      .then(() => ft.reconcile(idle))
      .catch((e) => console.warn('[glean] search index', e));
  }, delay);
  return ft;
}
