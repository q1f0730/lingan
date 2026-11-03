/**
 * v0.28 0107 穗束（合集）：一穗可以属于好几个束，如「毕业设计参考」「想写的歌」。
 * 0108 束可以直接当嫁接池。存在穗自己的 `bundles` 字段里（没加索引 → 不是 Dexie schema 变更；
 * 1000 穗全表扫一遍 <1ms），备份 / 导入原样带着。
 */
import type { Item } from './types';

export const BUNDLE_MAX_LEN = 24;
/** 详情里点「束 · X」：穗仓按这个束筛（事件 + sessionStorage 兜底，穗仓还没挂上时也能接住） */
export const BUNDLE_EVENT = 'glean:bundle';
export const BUNDLE_OPEN_KEY = 'glean.bundle.open';
export const BUNDLES_PER_ITEM = 12;

export function normBundle(s: string): string {
  return (s || '').replace(/[\s\u3000]+/g, ' ').replace(/^[#＃\s]+|\s+$/g, '').slice(0, BUNDLE_MAX_LEN);
}

/** 「毕业设计参考，想写的歌」→ 两个束名（逗号 / 顿号 / 分号分隔，去重） */
export function splitBundles(s: string): string[] {
  const out: string[] = [];
  for (const p of (s || '').split(/[,，、;；\n]+/)) {
    const n = normBundle(p);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export function withBundles(cur: string[] | undefined, add: string[]): string[] {
  const out = [...(cur || [])];
  for (const b of add.map(normBundle)) if (b && !out.includes(b)) out.push(b);
  return out.slice(0, BUNDLES_PER_ITEM);
}

/** 每个束有几穗（按穗数多到少，同数按名字） */
export function bundleCounts(items: Array<Pick<Item, 'bundles' | 'deletedAt'>>): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (it.deletedAt || !it.bundles) continue;
    for (const b of it.bundles) m.set(b, (m.get(b) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
}

export function inBundle(it: Pick<Item, 'bundles'>, name: string): boolean {
  return !!it.bundles && it.bundles.includes(name);
}

/** 0108 嫁接池：从穗仓 / 详情点「从这一束里嫁接」→ 嫁接页只在这个束里抽 */
export const POOL_KEY = 'glean.graft.pool';
export function graftFromBundle(name: string, go: (v: 'develop') => void) {
  try {
    sessionStorage.setItem(POOL_KEY, name);
  } catch {
    /* 隐私模式 */
  }
  go('develop');
}
export function takePool(): string | null {
  try {
    const b = sessionStorage.getItem(POOL_KEY);
    if (b) sessionStorage.removeItem(POOL_KEY);
    return b || null;
  } catch {
    return null;
  }
}
