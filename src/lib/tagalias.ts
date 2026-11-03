// v0.23 标签别名（0103）：把「夜晚」「night」合并进「夜」以后，再输入别名也自动写成「夜」。
// 存本机 localStorage（同步读，normalizeTags 是同步函数）；不依赖任何模块，db.ts 可以放心引用。

export const ALIAS_KEY = 'glean.tagalias.v1';

let cache: Record<string, string> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 别名表：别名 → 正名（键一律小写） */
export function loadAliases(): Record<string, string> {
  if (cache) return cache;
  const s = storage();
  let out: Record<string, string> = {};
  try {
    const v = s ? JSON.parse(s.getItem(ALIAS_KEY) || '{}') : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) out = Object.fromEntries(Object.entries(v).filter(([k, x]) => typeof k === 'string' && typeof x === 'string' && k && x)) as Record<string, string>;
  } catch {
    out = {};
  }
  cache = out;
  return out;
}

export function saveAliases(m: Record<string, string>) {
  cache = { ...m };
  try {
    storage()?.setItem(ALIAS_KEY, JSON.stringify(cache));
  } catch {
    /* 隐私模式 */
  }
}

/** 测试用 */
export function _resetAliasCache() {
  cache = null;
}

/** 一个标签按别名表换成正名（链式别名最多追 5 层，防环） */
export function resolveTag(t: string, m: Record<string, string> = loadAliases()): string {
  let cur = t;
  for (let i = 0; i < 5; i++) {
    const nx = m[cur.toLowerCase()];
    if (!nx || nx === cur) break;
    cur = nx;
  }
  return cur;
}

/** 把 from 里的标签都记成 to 的别名（to 自己若曾是别名则先解除）。返回新表 */
export function addAliases(from: string[], to: string, m: Record<string, string> = loadAliases()): Record<string, string> {
  const out = { ...m };
  delete out[to.toLowerCase()];
  for (const f of from) {
    if (!f || f === to) continue;
    out[f.toLowerCase()] = to;
  }
  // 以前指向 from 的别名，改指 to
  for (const [k, v] of Object.entries(out)) if (from.includes(v)) out[k] = to;
  return out;
}
