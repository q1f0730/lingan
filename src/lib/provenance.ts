// v0.12 新枝溯源：每根新枝都能点回它的穗。
// 依据 research/perplexity_report_raw_part2.md pipeline 第 7 步「Return provenance… Reject any idea that cannot identify its evidence」
// 与 Product principles「Source-visible AI」。
import type { Development, Idea, Item } from './types';

/** 一根新枝至少要能点回几穗 */
export const MIN_EVIDENCE = 3;
/** 「因为这几穗」最多展示几穗 */
export const MAX_SOURCES = 5;

export type Evidence = 'ok' | 'weak' | 'legacy';

/** 这次嫁接要求的最少引用数：素材不够 3 件时退到素材数 */
export function minEvidence(n: number): number {
  return Math.max(1, Math.min(MIN_EVIDENCE, n));
}

/** 给模型看的素材 ID：用穗在库里的真实 id（没有 id 时退回序号） */
export function evidenceIds(items: Pick<Item, 'id'>[]): number[] {
  return items.map((it, i) => (typeof it.id === 'number' ? it.id : i + 1));
}

export interface RefCheck {
  /** 有效引用：转换成嫁接素材里的位置（1 起），去重、保持顺序 */
  refs: number[];
  /** 引用了不存在的 ID（或写不出数字）的次数 */
  invalid: number;
  /** 模型根本没写 refs */
  missing: boolean;
}

/** 把模型给的 refs（素材 ID）对照这次嫁接的素材 ID 表，转成位置；不存在的 ID 计入 invalid，绝不悄悄补默认值 */
export function checkRefs(v: unknown, ids: number[]): RefCheck {
  const arr = Array.isArray(v) ? v : typeof v === 'string' || typeof v === 'number' ? String(v).split(/[,，、\s]+/) : [];
  const refs: number[] = [];
  let invalid = 0;
  for (const x of arr) {
    if (x === '' || x == null) continue;
    const k = typeof x === 'number' ? x : parseInt(String(x).replace(/[^\d]/g, ''), 10);
    const pos = Number.isInteger(k) ? ids.indexOf(k) + 1 : 0;
    if (pos > 0) {
      if (!refs.includes(pos)) refs.push(pos);
    } else invalid++;
  }
  return { refs, invalid, missing: arr.filter((x) => x !== '' && x != null).length === 0 };
}

/** 一根 AI 新枝的证据是否站得住：有效引用 ≥ k 且没有编造的 ID */
export function evidenceClean(c: RefCheck, k: number): boolean {
  return c.refs.length >= k && c.invalid === 0;
}

export function weakNote(c: RefCheck, k: number): string {
  if (c.missing) return '模型没说它从哪几穗长出来';
  if (c.invalid > 0 && c.refs.length < k) return `只认得出 ${c.refs.length} 穗，另有 ${c.invalid} 处引用了不存在的穗`;
  if (c.invalid > 0) return `引用了 ${c.invalid} 件不存在的穗`;
  return `只认得出 ${c.refs.length} 穗，不够 ${k} 穗`;
}

/** 把引用补到至少 k 件（只给离线 / 本地收拢用：那些正文本来就是拿这几穗拼出来的） */
export function padRefs(refs: number[], n: number, k = minEvidence(n)): number[] {
  const out = refs.filter((r) => r >= 1 && r <= n);
  for (let i = 1; out.length < k && i <= n; i++) if (!out.includes(i)) out.push(i);
  return out;
}

/** 新枝对应的穗 id（按引用顺序，最多 MAX_SOURCES 件）；没有 refs 的旧枝退回整组素材 */
export function sourceIds(dev: Pick<Development, 'itemIds'>, idea: Pick<Idea, 'refs'>): number[] {
  const all = dev.itemIds || [];
  const fromRefs = (idea.refs || []).map((r) => all[r - 1]).filter((x): x is number => typeof x === 'number' && x > 0);
  const ids = idea.refs ? fromRefs : all.filter((x) => x > 0);
  return Array.from(new Set(ids)).slice(0, MAX_SOURCES);
}

/** 新枝的证据状态（旧数据没有标记时一律算「早先的」） */
export function evidenceOf(dev: Pick<Development, 'evidence'>, idea: Pick<Idea, 'evidence'>): Evidence {
  return idea.evidence || dev.evidence || 'legacy';
}

/**
 * 旧新枝迁移（Dexie version 2 与导入旧备份共用）：
 * - 没有 refs 的：指向整组素材
 * - refs 越界的：丢掉越界的，丢光了就退回整组
 * - 标记 evidence = 'legacy'（早先长的，不知道模型当时是否真引用了），已有标记的保持不变
 * 返回是否改动过。直接修改传入对象（Dexie modify 要求）。
 */
export function migrateDevelopment(d: Development): boolean {
  if (!d || !d.idea) return false;
  let changed = false;
  const n = Array.isArray(d.itemIds) ? d.itemIds.length : 0;
  if (!Array.isArray(d.itemIds)) {
    d.itemIds = [];
    changed = true;
  }
  const refs = Array.isArray(d.idea.refs) ? d.idea.refs.filter((r) => Number.isInteger(r) && r >= 1 && r <= n) : [];
  const fixed = refs.length ? Array.from(new Set(refs)) : Array.from({ length: n }, (_, i) => i + 1);
  if (!Array.isArray(d.idea.refs) || fixed.join(',') !== d.idea.refs.join(',')) {
    d.idea = { ...d.idea, refs: fixed };
    changed = true;
  }
  if (!Array.isArray(d.idea.cliches)) {
    d.idea = { ...d.idea, cliches: [] };
    changed = true;
  }
  const ev: Evidence = d.idea.evidence || d.evidence || 'legacy';
  if (d.evidence !== ev) {
    d.evidence = ev;
    changed = true;
  }
  return changed;
}

// ——— 正文里提到的穗：悬停 / 长按时高亮对应那一穗 ———
export interface Segment {
  text: string;
  /** 这段文字指向的穗 id */
  id?: number;
}

/** 一件穗在正文里可能被叫到的名字：标题（去书名号）、作者 */
export function namesOf(it: Pick<Item, 'title' | 'creator'>): string[] {
  const out: string[] = [];
  const t = (it.title || '').replace(/^《|》$/g, '').trim();
  if (t.length >= 2) out.push(t);
  const c = (it.creator || '').trim();
  if (c.length >= 2 && c !== t) out.push(c);
  return out;
}

/** 把正文切成段，命中穗名字（最长优先、不重叠）的段带上穗 id */
export function splitMentions(text: string, sources: Array<Pick<Item, 'id' | 'title' | 'creator'>>): Segment[] {
  const pats: Array<{ name: string; id: number }> = [];
  for (const s of sources) if (typeof s.id === 'number') for (const name of namesOf(s)) pats.push({ name, id: s.id });
  if (!text || !pats.length) return [{ text }];
  pats.sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  const hits: Array<{ start: number; end: number; id: number }> = [];
  for (const p of pats) {
    const needle = p.name.toLowerCase();
    let from = 0;
    for (;;) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      const end = i + needle.length;
      if (!hits.some((h) => i < h.end && end > h.start)) hits.push({ start: i, end, id: p.id });
      from = end;
    }
  }
  if (!hits.length) return [{ text }];
  hits.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const h of hits) {
    // 书名号一起包进去，看起来更完整
    let s = h.start;
    let e = h.end;
    if (text[s - 1] === '《' && text[e] === '》') {
      s--;
      e++;
    }
    if (s < at) s = at;
    if (s > at) out.push({ text: text.slice(at, s) });
    out.push({ text: text.slice(s, e), id: h.id });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
