// v0.34 分享出去 · 隐私边界（懒加载，分享面板 / 花园 / 明信片共用）
// - 0899 分享时逐项勾选要带的字段，默认只带标题和正文；预览的就是要发出去的那段字
// - 0909 分享 / 花园 / 明信片生成前本地扫一遍：手机号、身份证号、邮箱 + 设置里自填的敏感词（真名、学校、宿舍地址…），命中先拦下确认
// - 0901 公开名默认 Q1f730；0916 新枝溯源穗可「显示 / 只显示类型和标题 / 不带」
// 分享设置只存本机 localStorage（敏感词本身就是隐私，不进同步、不进备份）。
import { cleanUrl } from './cleanurl';
import { exitOpen } from './privacy';
import { TYPE_LABEL, type Item } from './types';

export type ShareField = 'title' | 'content' | 'why' | 'time' | 'url' | 'tags' | 'source';
export const FIELD_LABEL: Record<ShareField, string> = { title: '标题', content: '正文', why: '为什么', time: '时间', url: '来源链接', tags: '标签', source: '来自哪个 App' };
export const FIELD_ORDER: ShareField[] = ['title', 'content', 'why', 'time', 'url', 'tags', 'source'];
export const DEFAULT_FIELDS: ShareField[] = ['title', 'content'];
export type SprigMode = 'show' | 'plain' | 'none';
export const SPRIG_LABEL: Record<SprigMode, string> = { show: '显示', plain: '只写类型和标题', none: '不带' };

export interface SharePrefs {
  /** 公开名：分享署名、花园作者、明信片落款 */
  name: string;
  /** 自填敏感词（真名、学校、宿舍地址…），一行一个 */
  words: string[];
  /** 花园页带上「为什么」 */
  gardenWhy?: boolean;
}
const KEY = 'glean.share.v1';
export const PUBLIC_NAME = 'Q1f730';

export function readSharePrefs(): SharePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 40) : PUBLIC_NAME, words: Array.isArray(v.words) ? v.words.filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, 50) : [], gardenWhy: !!v.gardenWhy };
  } catch {
    return { name: PUBLIC_NAME, words: [] };
  }
}
export function writeSharePrefs(p: SharePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ name: p.name.trim().slice(0, 40) || PUBLIC_NAME, words: p.words.map((w) => w.trim()).filter(Boolean).slice(0, 50), gardenWhy: !!p.gardenWhy }));
  } catch {
    /* ignore */
  }
}

// ——— 0909 个人信息扫描 ———
export interface Hit {
  kind: string;
  text: string;
}
const RULES: Array<[string, RegExp]> = [
  ['手机号', /(?<![\d])(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g],
  ['身份证号', /(?<![\d])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dXx])/g],
  ['邮箱', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
];
/** 扫一段要发出去的字：返回命中的个人信息（去重，最多 12 条） */
export function scanPersonal(text: string, words: string[] = []): Hit[] {
  const out: Hit[] = [];
  const seen = new Set<string>();
  const push = (kind: string, t: string) => {
    const k = kind + t;
    if (seen.has(k) || out.length >= 12) return;
    seen.add(k);
    out.push({ kind, text: t });
  };
  for (const [kind, re] of RULES) for (const m of text.matchAll(re)) push(kind, m[0]);
  const low = text.toLowerCase();
  for (const w of words) if (w.trim().length >= 2 && low.includes(w.trim().toLowerCase())) push('敏感词', w.trim());
  return out;
}
/** 给人看的打码：138****5678、张**、q***@qq.com（确认框里不再把整条个人信息念一遍） */
export function maskHit(h: Hit): string {
  const t = h.text.replace(/[-\s]/g, '');
  if (h.kind === '邮箱') return t.replace(/^(.)[^@]*@/, '$1***@');
  if (h.kind === '手机号' || h.kind === '身份证号') return t.slice(0, 3) + '****' + t.slice(-(h.kind === '手机号' ? 4 : 2));
  return t[0] + '*'.repeat(Math.max(1, t.length - 1));
}

// ——— 0899 拼要发出去的字 ———
const day = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** 一穗按勾选的字段拼成纯文字（预览 = 复制 / 分享出去的就是这段） */
export function itemShareText(it: Item, fields: ShareField[]): string {
  const f = new Set(fields);
  const head = [it.title, it.creator, it.year].filter(Boolean).join(' · ');
  const lines = [
    f.has('title') ? (it.type === 'film' ? `《${it.title.replace(/^《|》$/g, '')}》${it.creator ? ' · ' + it.creator : ''}` : head) : '',
    f.has('content') && it.content && it.content !== it.title ? it.content : '',
    f.has('why') && it.why ? `为什么：${it.why}` : '',
    f.has('url') && it.url ? cleanUrl(it.url) : '',
    f.has('tags') && it.tags.length ? it.tags.map((t) => '#' + t).join(' ') : '',
    f.has('time') ? `拾于 ${day(it.createdAt)}` : '',
    f.has('source') && it.source ? `来自 ${it.source}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** 「递一穗」链接：对方装了拾穗，点开（或粘进速记条）就进他的 待理 · 递来的。只带勾选的字段 */
export function handLink(it: Item, fields: ShareField[], from: string): string {
  const f = new Set(fields);
  const p = new URLSearchParams();
  if (f.has('title')) p.set('title', it.title.slice(0, 120));
  const text = f.has('content') ? it.content || (f.has('title') ? '' : it.title) : '';
  if (text) p.set('text', text.slice(0, 1500));
  if (f.has('url') && it.url) p.set('url', cleanUrl(it.url));
  if (f.has('tags') && it.tags.length) p.set('tags', it.tags.slice(0, 8).join(','));
  if (!p.get('text') && !p.get('url')) p.set('text', it.title.slice(0, 120));
  p.set('from', from.slice(0, 40));
  return 'glean://capture?' + p.toString().replace(/\+/g, '%20');
}

export interface BranchLike {
  title: string;
  idea: string;
  form?: string;
  experiment?: string;
}
/** 溯源穗一行：显示 = 类型 · 标题 · 作者；只写类型和标题 = 不带作者 / 年份 */
export function sprigLine(it: Item, mode: SprigMode): string {
  const t = it.title.replace(/^《|》$/g, '').slice(0, 40);
  return mode === 'show' ? [TYPE_LABEL[it.type], t, it.creator].filter(Boolean).join(' · ') : `${TYPE_LABEL[it.type]} · ${t}`;
}
/** 一根新枝的分享文字；私密穗永远只写「一穗私密的」 */
export function branchShareText(b: BranchLike, items: Item[], mode: SprigMode, name: string): string {
  // v0.39 0907 上锁的穗连「一穗私密的」都不写
  const src = mode === 'none' ? [] : items.filter((it) => exitOpen(it, 'share')).map((it) => (it.private ? '一穗私密的' : sprigLine(it, mode)));
  return [
    `《${b.title.replace(/^《|》$/g, '')}》`,
    b.idea,
    b.form ? `形式：${b.form}` : '',
    b.experiment ? `20 分钟小实验：${b.experiment}` : '',
    src.length ? `因为这几穗：\n${src.map((s) => '· ' + s).join('\n')}` : '',
    `—— ${name} · 拾穗 Glean`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
