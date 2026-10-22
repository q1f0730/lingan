// v0.19 我的套路墙。
// 依据：Gemini「负向约束与陈词滥调禁令」（先让模型穷举套路，再把它们设为物理禁区）；
// Perplexity Prompt template 的 FORBIDDEN 段（未落地的词与框架一律禁用）。
// 做法：每次嫁接时模型列出的套路（cliches）自动沉淀到 cliches 表；用户也能手动加讨厌的词 / 梗、划掉误伤的。
// 以后每次嫁接：① 墙上的条目全部写进 prompt 的 FORBIDDEN；② 生成后本地逐根校验，撞墙的那根先让模型重写一次，
// 仍撞就用没用上的种子在本地重长一根，最后兜底把撞到的字删掉——保证新枝里一定不出现墙上的东西。离线同样遵守。
import type { Idea } from './types';

/** 内置禁用词（v0.11 起就在 prompt 里），不上墙、不能划掉，但本地校验同样执行 */
export const BUILTIN_FORBIDDEN = ['沉浸式', '旅程', '交织', '融合', '碰撞出火花', '灵魂', '治愈', '氛围感', '赋能', '打破边界', '时光的', '岁月的', '独一无二'];

/** 墙上一条 */
export interface Cliche {
  id?: number;
  /** 归一化后的键（去空白标点、小写），唯一 */
  key: string;
  /** 给人看的原文 */
  text: string;
  /** ai = 模型在某次嫁接里列出的；user = 我自己加的 */
  source: 'ai' | 'user';
  /** 1 = 被我划掉（误伤），不再禁用，模型再列出也不会自动恢复 */
  struck: 0 | 1;
  /** 被模型列出的次数 */
  listed: number;
  /** 在新枝里被本地校验拦下的次数 */
  blocked: number;
  createdAt: number;
  lastAt: number;
}

export const MAX_CLICHE_LEN = 40;
/** 写进 prompt 的墙上条目最多这么多条（我加的优先，其余按次数 / 最近），防止 prompt 无限变长 */
export const PROMPT_WALL_LIMIT = 80;

const PUNCT = /[\s\p{P}\p{S}]+/gu;
const QUOTES = /^[\s"'“”‘’「」『』《》〈〉【】()（）[\]<>]+|[\s"'“”‘’「」『』《》〈〉【】()（）[\]<>。，、；;：:！!？?,.]+$/gu;

/** 去掉两头的引号 / 括号 / 句末标点，合并空白 */
export function cleanText(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(QUOTES, '')
    .trim()
    .slice(0, MAX_CLICHE_LEN);
}

/** 归一化键：去掉所有空白、标点、符号，小写 */
export function clicheKey(raw: unknown): string {
  return cleanText(raw).toLowerCase().replace(PUNCT, '');
}

/** 能不能上墙：至少 2 个字；纯拉丁 / 数字至少 3 个字符（防止 "ai" 这种误伤一大片） */
export function validKey(key: string): boolean {
  if (!key) return false;
  if (/^[a-z0-9]+$/.test(key)) return key.length >= 3;
  return [...key].length >= 2;
}

const reCache = new Map<string, RegExp | null>();
/** 键 → 在原文里找它的正则：字与字之间允许夹空白和标点（「氛围 感」「氛围·感」都算）；拉丁词两头要是词边界 */
export function clicheRegex(key: string): RegExp | null {
  if (reCache.has(key)) return reCache.get(key)!;
  let re: RegExp | null = null;
  if (validKey(key)) {
    const chars = [...key].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const body = chars.join('[\\s\\p{P}\\p{S}]*');
    const head = /^[a-z0-9]/.test(key) ? '(?<![a-z0-9])' : '';
    const tail = /[a-z0-9]$/.test(key) ? '(?![a-z0-9])' : '';
    try {
      re = new RegExp(head + body + tail, 'giu');
    } catch {
      re = null;
    }
  }
  if (reCache.size > 2000) reCache.clear();
  reCache.set(key, re);
  return re;
}

/** 文本里出现了哪些（键） */
export function findHits(text: string | undefined, keys: string[]): string[] {
  if (!text) return [];
  const t = text.normalize('NFKC');
  const out: string[] = [];
  for (const k of keys) {
    const re = clicheRegex(k);
    if (!re) continue;
    re.lastIndex = 0;
    if (re.test(t)) out.push(k);
  }
  return out;
}

/** 新枝里要校验的字段（「避开的套路」那一栏本来就是套路清单，不算） */
const FIELDS = ['title', 'idea', 'bridge', 'form', 'unlike', 'experiment', 'firstStep', 'oblique'] as const;
type Field = (typeof FIELDS)[number];

export function branchText(b: Idea): string {
  return FIELDS.map((f) => b[f] || '').filter(Boolean).join('\n');
}

/** 一根新枝撞了哪些墙 */
export function branchHits(b: Idea, keys: string[]): string[] {
  const out = new Set<string>();
  for (const f of FIELDS) for (const k of findHits(b[f], keys)) out.add(k);
  return [...out];
}

/** 把撞到的字从一段文字里删掉，顺手收拾删出来的空书名号、重复标点 */
export function scrubText(text: string, keys: string[]): string {
  let t = text.normalize('NFKC');
  for (const k of keys) {
    const re = clicheRegex(k);
    if (re) t = t.replace(re, '');
  }
  return t
    .replace(/《\s*》|「\s*」|“\s*”|『\s*』|（\s*）|\(\s*\)/g, '')
    .replace(/([，、；。])\s*[，、；]+/g, '$1')
    .replace(/^[，、；。\s]+/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const FALLBACK: Partial<Record<Field, string[]>> = {
  title: ['新枝', '无题', '一根新枝', '这一根'],
  idea: ['（这一根的原话撞了套路墙，被删掉了，只留下结构：看下面这几穗，自己接着长。）', '（原话被删掉了：看下面这几穗，自己接着长。）', '（删掉了。）', '……'],
};
function fallbackFor(f: Field, keys: string[]): string | undefined {
  const list = FALLBACK[f];
  if (!list) return undefined;
  return list.find((x) => !findHits(x, keys).length) || '……';
}

/** 兜底：把一根新枝里撞墙的字全部删掉（删到空的字段换一句中性话） */
export function scrubBranch(b: Idea, keys: string[]): Idea {
  const out: Idea = { ...b };
  for (const f of FIELDS) {
    const v = b[f as Field];
    if (!v) continue;
    // 删完之后可能拼出新的命中（「氛围X感」删 X 不会，但多轮删除更稳妥）
    let s = v;
    for (let i = 0; i < 3 && findHits(s, keys).length; i++) s = scrubText(s, keys);
    if (findHits(s, keys).length) s = '';
    (out as unknown as Record<string, string | undefined>)[f] = s || fallbackFor(f, keys);
  }
  return out;
}

/** 这次嫁接要禁用的全部键：内置 + 墙上没划掉的 + 本次模型新列出的（三根都承诺避开） */
export function enforcedKeys(wall: Array<Pick<Cliche, 'key' | 'struck'>>, extra: string[] = []): string[] {
  const struck = new Set(wall.filter((c) => c.struck).map((c) => c.key));
  const keys = new Set<string>();
  for (const w of BUILTIN_FORBIDDEN) keys.add(clicheKey(w));
  for (const c of wall) if (!c.struck && validKey(c.key)) keys.add(c.key);
  for (const e of extra) {
    const k = clicheKey(e);
    if (validKey(k) && !struck.has(k)) keys.add(k);
  }
  // 长的先删，免得短的先删把长的拆碎
  return [...keys].filter(validKey).sort((a, b) => b.length - a.length);
}

/** 墙上要写进 prompt 的条目（原文）：我加的优先，再按被列出次数、最近时间；最多 PROMPT_WALL_LIMIT 条 */
export function promptWall(wall: Cliche[], limit = PROMPT_WALL_LIMIT): string[] {
  return wall
    .filter((c) => !c.struck && validKey(c.key))
    .sort((a, b) => (a.source === b.source ? 0 : a.source === 'user' ? -1 : 1) || b.listed + b.blocked - (a.listed + a.blocked) || b.lastAt - a.lastAt)
    .slice(0, limit)
    .map((c) => c.text);
}

/** prompt 里的 FORBIDDEN 段 */
export function forbiddenBlock(wallTexts: string[]): string {
  const lines = [`FORBIDDEN — 禁用词与框架：${BUILTIN_FORBIDDEN.join('、')}；以及任何素材里没有依据的说法。`];
  if (wallTexts.length) {
    lines.push(
      `FORBIDDEN — 我的套路墙（之前列出过的套路、我讨厌的词和梗，共 ${wallTexts.length} 条）：${wallTexts.map((t) => `「${t}」`).join('')}。`,
      '新枝的标题、正文、形式、小实验里都不许出现上面任何一条，也不许换个说法用同一个梗；新列出的套路不要和墙上重复。',
    );
  }
  return lines.join('\n');
}

/** 墙的展示顺序：最近的在前 */
export function sortWall(wall: Cliche[]): Cliche[] {
  return [...wall].sort((a, b) => b.lastAt - a.lastAt || (b.id || 0) - (a.id || 0));
}

/** 从模型列出的套路里取能上墙的（去重、去空） */
export function wallCandidates(list: unknown): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(list) ? list : []) {
    const text = cleanText(x);
    const key = clicheKey(text);
    if (!validKey(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text });
  }
  return out;
}

/** 嫁接时套路墙的统计（给提示用） */
export interface WallReport {
  /** 校验时撞墙的根数（重写 / 替换 / 删字前） */
  hit: number;
  /** 让模型重写了一次 */
  retried?: boolean;
  /** 本地用别的种子重长的根数 */
  replaced: number;
  /** 兜底删字的根数 */
  scrubbed: number;
  /** 撞到的键（用于给墙上条目记「拦下」次数） */
  keys: string[];
}

export const emptyReport = (): WallReport => ({ hit: 0, replaced: 0, scrubbed: 0, keys: [] });

/**
 * 保证一组新枝都不含 keys：撞墙的那根依次试 candidates（另起的新枝，变形法不和其余几根撞），
 * 候选也撞墙就跳过；都不行就删字兜底。
 */
export function enforceWall(
  branches: Idea[],
  keys: string[],
  candidates: () => Idea[],
  report: WallReport = emptyReport(),
  countHit = true,
): { branches: Idea[]; report: WallReport } {
  if (!keys.length) return { branches, report };
  const out = [...branches];
  let pool: Idea[] | null = null;
  const used = new Set<number>();
  const seenKeys = new Set(report.keys);
  for (let i = 0; i < out.length; i++) {
    const hits = branchHits(out[i], keys);
    if (!hits.length) continue;
    if (countHit) report.hit++;
    hits.forEach((k) => seenKeys.add(k));
    pool ||= candidates();
    const others = new Set(out.filter((_, j) => j !== i).map((b) => b.transform || ''));
    const ci = pool.findIndex((c, j) => !used.has(j) && !others.has(c.transform || '') && !branchHits(c, keys).length);
    if (ci >= 0) {
      used.add(ci);
      out[i] = { ...pool[ci], cliches: out[i].cliches, wall: 'replaced' };
      report.replaced++;
    } else {
      out[i] = { ...scrubBranch(out[i], keys), wall: 'scrubbed' };
      report.scrubbed++;
    }
  }
  report.keys = [...seenKeys];
  return { branches: out, report };
}
