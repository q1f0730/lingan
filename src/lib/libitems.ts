/**
 * v0.30 冷启动：穗仓的「全部穗」查询提前到渲染之前开跑。
 *
 * 以前 Library 用 useLiveQuery 查 1000 穗：它在 useEffect 里才订阅，而 useEffect 要等外壳第一帧画完才跑，
 * 于是「读库」被排在「画空外壳」后面串行（profile：q:items:start 比 Library 第一次渲染晚 60–100ms）。
 * 现在 main.tsx 在 root.render 之前就 prime（读库和渲染外壳并行；不等结果，外壳照常先画——等结果会让首次绘制晚很多），
 * Library 用 useSyncExternalStore 读同一个订阅：
 * 订阅前结果已到就在提交时直接补渲染；库变了照常实时刷新（同一个 liveQuery，不会查两遍）。
 * 没人看（离开穗仓、prime 5 秒内没人接）就退订并清掉结果，回来重新查，不拿旧结果（v0.28 篮子误清的教训）。
 */
import { liveQuery } from 'dexie';
import { useSyncExternalStore } from 'react';
import { db, onItemAdded } from './db';
import { afterFirstPaint } from './motion';
import type { Item } from './types';

type Listener = () => void;
let value: Item[] | undefined;
let error: unknown = null;
let sub: { unsubscribe(): void } | null = null;
let headSub: { unsubscribe(): void } | null = null;
let hold = 0;
let gen = 0;
const listeners = new Set<Listener>();
let firstWaiters: Array<() => void> = [];

/**
 * v0.37 0702 首屏只查最新 HEAD 条：库大了以后「全表 toArray」是冷启动最贵的一步（1 万穗时几百毫秒，第一帧一直等它）。
 * 先用 createdAt 索引倒序取 HEAD 条画首屏（同时数一下总数，标题的真实计数照常显示），
 * 首屏画完、主线程空闲后再订阅全表（类型筛选 / 标签云 / 待理数这些要全量的东西那时才算）。库不超过 HEAD 条时首段就是全部。
 */
export const HEAD = 60;
export const libraryQuery = () => db.items.orderBy('createdAt').reverse().toArray().then((a) => a.filter((x) => !x.deletedAt));
export const headQuery = () => db.items.orderBy('createdAt').reverse().filter((x) => !x.deletedAt).limit(HEAD).toArray();

/** 首段时的计数（全量到了以后为 null）：live = 回收站外的总数，samples = 示例数，inbox = 还在 7 天待理里的 */
export interface LibMeta {
  live: number;
  samples: number;
  inbox: number;
}
let meta: LibMeta | null = null;
export async function headMeta(now = Date.now()): Promise<LibMeta> {
  const [all, del, samples, inbox] = await Promise.all([
    db.items.count(),
    db.items.where('deletedAt').above(0).count(),
    db.items.where('sample').equals(1).filter((x) => !x.deletedAt).count(),
    db.items.where('inbox').equals(1).filter((x) => !x.deletedAt && x.createdAt > now - 7 * 864e5).count(),
  ]);
  return { live: all - del, samples, inbox };
}

function emit() {
  const w = firstWaiters;
  firstWaiters = [];
  for (const f of w) f();
  for (const l of [...listeners]) l();
}
function full() {
  if (sub) return;
  sub = liveQuery(libraryQuery).subscribe({
    next: (v) => {
      value = v;
      meta = null;
      error = null;
      headSub?.unsubscribe();
      headSub = null;
      emit();
    },
    error: (e) => {
      error = e;
      emit();
    },
  });
}
function idleThen(fn: () => void) {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  void afterFirstPaint(1500).then(() => (ric ? ric(fn, { timeout: 400 }) : setTimeout(fn, 30)));
}
function ensure() {
  if (sub || headSub) return;
  if (typeof window === 'undefined') return full();
  const g = ++gen;
  let n = -1;
  let head: Item[] | undefined;
  const settle = () => {
    if (g !== gen || head === undefined || n < 0 || sub) return;
    if (n <= HEAD) {
      // 首段就是全部：直接给出，后台接上全表订阅（结果一样，之后照常实时）
      value = head;
      meta = null;
      emit();
      full();
      return;
    }
    if (!meta) idleThen(() => g === gen && full());
    value = head;
    meta = { live: n, samples: smp, inbox: inb };
    emit();
  };
  let smp = 0, inb = 0;
  headMeta().then(
    (m) => {
      n = m.live;
      smp = m.samples;
      inb = m.inbox;
      settle();
    },
    () => g === gen && full(),
  );
  headSub = liveQuery(headQuery).subscribe({
    next: (v) => {
      head = v;
      settle();
    },
    error: () => g === gen && full(),
  });
}
/**
 * v0.37 0723 速记回车到卡片出现：liveQuery 要等提交后把全表重读一遍（1000 穗时这一步占了大半，慢机器 100ms+）。
 * 新穗一提交就单独取这一行插进当前结果（按 createdAt 倒序的位置），先画出来；全表结果随后到，照常整体替换（它是唯一真相）。
 */
onItemAdded((row, d) => {
  if (d !== db || value === undefined || row.deletedAt || value.some((x) => x.id === row.id)) return;
  const k = value.findIndex((x) => x.createdAt <= row.createdAt);
  value = k < 0 ? [...value, row] : [...value.slice(0, k), row, ...value.slice(k)];
  emit();
});

function release() {
  if (listeners.size || hold || !(sub || headSub)) return;
  sub?.unsubscribe();
  headSub?.unsubscribe();
  sub = headSub = null;
  gen++;
  value = undefined;
  meta = null;
  error = null;
}

/** 渲染前调用：先把查询跑起来；ms 内没人订阅就放掉 */
export function primeLibraryItems(ms = 5000): void {
  hold++;
  ensure();
  setTimeout(() => {
    hold--;
    release();
  }, ms);
}

/**
 * 等第一份结果（或出错），最多 ms 毫秒。main.tsx 用它把「画空外壳」省掉：结果先到就直接画带卡片的第一帧，
 * 不再「外壳布局 + 绘制一遍、卡片再布局 + 绘制一遍」（profile：IDB 结果要等外壳那一帧画完才送回主线程）。
 */
export function firstLibraryItems(ms: number): Promise<void> {
  if (value !== undefined || error) return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    firstWaiters.push(() => {
      clearTimeout(t);
      res();
    });
  });
}

function subscribe(l: Listener) {
  listeners.add(l);
  ensure();
  return () => {
    listeners.delete(l);
    // StrictMode 会先退订再订阅：下一个微任务再看还有没有人
    queueMicrotask(release);
  };
}
const snap = () => value;
const snapMeta = () => meta;

/** Library 用：和 useLiveQuery 一样，没查完是 undefined */
export function useLibraryItems(): Item[] | undefined {
  const v = useSyncExternalStore(subscribe, snap, snap);
  if (error) throw error;
  return v;
}

/** 现在就要全量（打开搜索 / 全选这些等不了空闲的操作） */
export function loadFullNow(): void {
  if (headSub && !sub) full();
}

/** 首段（只有最新 HEAD 条）时给计数；全量到了是 null */
export function useLibraryMeta(): LibMeta | null {
  return useSyncExternalStore(subscribe, snapMeta, snapMeta);
}

/** 测试用：当前订阅状态 */
export function _libState() {
  return { subscribed: !!(sub || headSub), full: !!sub, listeners: listeners.size, hold, hasValue: value !== undefined, partial: !!meta, n: value?.length ?? -1 };
}
