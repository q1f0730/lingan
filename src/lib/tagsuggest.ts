/**
 * v0.27 0413 #标签输入自动补全（速记条、补一句、速记小窗、详情加标签、编辑表单的标签栏共用）。
 * - hash 模式：光标前紧挨着的 `#词` 是查询（可以是空的 `#`，给最常用的几个）
 * - bare 模式：标签栏本身（空格 / 逗号分隔），光标所在的那个词是查询
 */
export interface TagQuery {
  start: number;
  end: number;
  q: string;
  hash: boolean;
}

const SEP = /[\s,，、]/;

export function tagQueryAt(text: string, caret: number, bare = false): TagQuery | null {
  const c = Math.max(0, Math.min(caret, text.length));
  let i = c;
  while (i > 0 && !SEP.test(text[i - 1]) && text[i - 1] !== '#') i--;
  // 光标后面还连着的字也算这个词（在词中间补全时整个替换）
  let e = c;
  while (e < text.length && !SEP.test(text[e]) && text[e] !== '#') e++;
  if (i > 0 && text[i - 1] === '#') {
    // `#` 前面必须是开头或空白，免得把网址里的锚点当标签
    if (i - 1 > 0 && !SEP.test(text[i - 2])) return null;
    return { start: i - 1, end: e, q: text.slice(i, c), hash: true };
  }
  if (!bare) return null;
  return { start: i, end: e, q: text.slice(i, c), hash: false };
}

/** 按「前缀命中 > 包含」再按用过的次数排；已经填过的不再给 */
export function suggestTags(q: string, counts: ReadonlyMap<string, number>, exclude: readonly string[] = [], limit = 6): string[] {
  const k = q.trim().toLowerCase();
  const ex = new Set(exclude.map((x) => x.toLowerCase()));
  const rows: Array<[string, number, number]> = [];
  for (const [t, n] of counts) {
    const lt = t.toLowerCase();
    if (ex.has(lt) || lt === k) continue;
    if (!k) rows.push([t, 2, n]);
    else if (lt.startsWith(k)) rows.push([t, 0, n]);
    else if (lt.includes(k)) rows.push([t, 1, n]);
  }
  rows.sort((a, b) => a[1] - b[1] || b[2] - a[2] || a[0].length - b[0].length || a[0].localeCompare(b[0]));
  return rows.slice(0, limit).map((r) => r[0]);
}

/** 把选中的标签填回去，返回新文本与光标位置（后面补一个空格，接着打下一个） */
export function applyTag(text: string, qr: TagQuery, tag: string): { text: string; caret: number } {
  const ins = (qr.hash ? '#' : '') + tag;
  const after = text.slice(qr.end);
  const pad = after.startsWith(' ') ? '' : ' ';
  const next = text.slice(0, qr.start) + ins + pad + after;
  return { text: next, caret: qr.start + ins.length + 1 };
}

export function existingTags(text: string, bare: boolean): string[] {
  if (bare) return text.split(/[\s,，、]+/).filter(Boolean);
  return Array.from(text.matchAll(/(^|\s)#([^\s#]{1,24})/g), (m) => m[2]);
}

// 标签用量：只读索引键，很便宜；缓存 1.5 秒只为了连打几个字时不重复读
let cache: { at: number; map: Map<string, number> } | null = null;
export function countTags(items: Array<{ tags?: string[]; deletedAt?: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) if (!it.deletedAt) for (const t of it.tags || []) m.set(t, (m.get(t) || 0) + 1);
  return m;
}
export async function loadTagCounts(now = Date.now()): Promise<Map<string, number>> {
  if (cache && now - cache.at < 1500) return cache.map;
  const { db } = await import('./db');
  // 只读多值索引的键（每个「穗×标签」一条），不把穗本身（含缩略图）读进内存；回收站里的也算，影响可忽略
  const map = new Map<string, number>();
  for (const k of (await db.items.orderBy('tags').keys()) as unknown[]) if (typeof k === 'string') map.set(k, (map.get(k) || 0) + 1);
  cache = { at: now, map };
  return map;
}
export function dropTagCache() {
  cache = null;
}
