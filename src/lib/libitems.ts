/**
 * v0.30 冷启动：穗仓的「全部穗」查询提前到渲染之前开跑。
 *
 * 以前 Library 用 useLiveQuery 查 1000 穗：它在 useEffect 里才订阅，而 useEffect 要等外壳第一帧画完才跑，
 * 于是「读库」被排在「画空外壳」后面串行（profile：q:items:start 比 Library 第一次渲染晚 60–100ms）。
 * 现在 main.tsx 在 root.render 之前就 prime（读库和渲染外壳并行），Library 用 useSyncExternalStore 读同一个订阅：
 * 订阅前结果已到就在提交时直接补渲染；库变了照常实时刷新（同一个 liveQuery，不会查两遍）。
 * 没人看（离开穗仓、prime 5 秒内没人接）就退订并清掉结果，回来重新查，不拿旧结果（v0.28 篮子误清的教训）。
 */
import { liveQuery } from 'dexie';
import { useSyncExternalStore } from 'react';
import { db } from './db';
import type { Item } from './types';

type Listener = () => void;
let value: Item[] | undefined;
let error: unknown = null;
let sub: { unsubscribe(): void } | null = null;
let hold = 0;
const listeners = new Set<Listener>();
let firstWaiters: Array<() => void> = [];

export const libraryQuery = () => db.items.orderBy('createdAt').reverse().toArray().then((a) => a.filter((x) => !x.deletedAt));

function emit() {
  const w = firstWaiters;
  firstWaiters = [];
  for (const f of w) f();
  for (const l of [...listeners]) l();
}
function ensure() {
  if (sub) return;
  sub = liveQuery(libraryQuery).subscribe({
    next: (v) => {
      value = v;
      error = null;
      emit();
    },
    error: (e) => {
      error = e;
      emit();
    },
  });
}
function release() {
  if (listeners.size || hold || !sub) return;
  sub.unsubscribe();
  sub = null;
  value = undefined;
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

/** Library 用：和 useLiveQuery 一样，没查完是 undefined */
export function useLibraryItems(): Item[] | undefined {
  const v = useSyncExternalStore(subscribe, snap, snap);
  if (error) throw error;
  return v;
}

/** 测试用：当前订阅状态 */
export function _libState() {
  return { subscribed: !!sub, listeners: listeners.size, hold, hasValue: value !== undefined };
}
