import { normalizeTags } from './db';
import { cleanUrl, parseShareCode } from './cleanurl';
import { extractUrl, guessType } from './linkmeta';
import { TYPE_ORDER, type Item, type ItemType } from './types';

export type QuickDraft = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;

const QUOTE = /^[「“"『].+[」”"』]$/s;

/** v0.28 0024 行内语法 /歌 /影 /文 /链接 /想：强制类型（/图 不收：没图的图片穗没意义） */
const FORCE: Record<string, ItemType> = { 歌: 'music', 音乐: 'music', 影: 'film', 电影: 'film', 剧: 'film', 文: 'text', 摘抄: 'text', 链接: 'link', 想: 'idea', 念头: 'idea' };
const BOOK = /^《([^《》]{1,60})》\s*(?:[（(]?((?:18|19|20)\d{2})[)）]?)?$/;

/**
 * Turn one line of free text into an item draft. `#标签` words become tags.
 * v0.28 0024 行内语法：`> 为什么`（> 后面到结尾都是为什么）、`@作者`、整句是《片名》→ 电影、`/歌` 这类强制类型。
 * 0023 链接去追踪参数；0019 平台口令文案抽出真实链接和标题。
 */
export function parseQuick(raw: string): QuickDraft | null {
  let text = raw.replace(/\r/g, '').trim();
  if (!text) return null;
  const tags: string[] = [];
  let force: ItemType | null = null;
  let creator = '';
  let why = '';
  text = text
    .replace(/(^|\s)#([^\s#]{1,24})(?=\s|$)/g, (_, pre: string, t: string) => {
      tags.push(t);
      return pre;
    })
    .replace(/(^|\s)[/／](歌|音乐|影|电影|剧|文|摘抄|链接|想|念头)(?=\s|$)/, (_, pre: string, k: string) => {
      force = FORCE[k];
      return pre;
    });
  // > 为什么：行首或空格后的 >，后面到结尾都算（链接里不会有 >）
  const wm = text.match(/(^|\s)[>＞]\s*(\S[\s\S]*)$/);
  if (wm && wm.index != null) {
    why = wm[2].trim().slice(0, 1000);
    text = text.slice(0, wm.index + wm[1].length);
  }
  // @作者：行首或空格后（邮箱、链接里的 @ 不算）
  text = text
    .replace(/(^|\s)[@＠]([^\s@＠#/]{1,24})(?=\s|$)/, (_, pre: string, c: string) => {
      creator = c;
      return pre;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const base = { creator, year: '', why, tags: normalizeTags(tags) };
  const found = extractUrl(text);
  if (found) {
    const url = cleanUrl(found);
    const code = parseShareCode(text, found);
    const rest = code ? code.title : text.replace(found, '').trim();
    const type: ItemType = force || code?.type || guessType(url);
    return { ...base, creator: code ? code.creator || (/QQ音乐|网易云|豆瓣|App$/i.test(creator) ? '' : creator) : creator, type, title: (rest || url).slice(0, 120), url, content: '', ...(code?.source ? { source: code.source } : {}) };
  }
  if (!text) return null;
  const bk = text.match(BOOK);
  if (bk) return { ...base, type: force || 'film', title: bk[1].trim(), year: bk[2] || '', content: '', url: '' };
  const firstLine = text.split('\n')[0];
  if (force === 'text' || (!force && (QUOTE.test(text) || text.length > 60))) {
    // a quote or a long passage → 文案 with the passage as content
    const body = text.replace(/^[「“"『]+|[」”"』]+$/g, '');
    return { ...base, type: 'text', title: body.slice(0, 18), content: body, url: '' };
  }
  const multi = text.includes('\n');
  return { ...base, type: force || 'idea', title: firstLine.slice(0, 120), content: multi ? text : '', url: '' };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Human time stamp: 今天 22:18 / 昨天 09:01 / 10/19 / 2025/10/19 */
export function formatWhen(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const day0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= day0 && ts < day0 + 86400000) return `今天 ${hm}`;
  if (ts >= day0 - 86400000 && ts < day0) return `昨天 ${hm}`;
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** value for <input type="datetime-local"> in local time */
export function toLocalInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Simple stable hash for remembering which clipboard text we already offered. */
export function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** v0.33 0018 / 0514：验证码、像密码的一串不提示收（剪贴板守望 / 安卓粘贴拾） */
export function looksSensitive(text: string): boolean {
  const s = text.trim();
  if (/^\d{4,8}$/.test(s)) return true;
  if (s.length < 200 && /验证码|校验码|动态码|动态密码|verification code|\bOTP\b/i.test(s) && /(^|\D)\d{4,8}(\D|$)/.test(s)) return true;
  return s.length >= 8 && s.length <= 64 && !/[\s/\u3000-\u9fff]/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9]/.test(s);
}

/** Should we offer this clipboard text? Not empty, not huge, not already offered, not already in the library. */
export function shouldOffer(text: string | null | undefined, lastHash: string | null, existing: Array<Pick<Item, 'title' | 'url' | 'content'>>): boolean {
  const t = (text || '').trim();
  if (t.length < 2 || t.length > 2000 || looksSensitive(t)) return false;
  if (lastHash && hashText(t) === lastHash) return false;
  const url = extractUrl(t);
  return !existing.some((i) => (url && i.url === url) || i.title === t || (i.content && i.content === t));
}

const CLIP_KEY = 'lingan.clip.last';
export const clipMemory = {
  get: (): string | null => {
    try {
      return localStorage.getItem(CLIP_KEY);
    } catch {
      return null;
    }
  },
  set: (text: string) => {
    try {
      localStorage.setItem(CLIP_KEY, hashText(text.trim()));
    } catch {
      /* ignore */
    }
  },
};

export async function readClipboard(): Promise<string | null> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    try {
      // v0.36 直接调插件命令：插件的 JS 包会连带整个 Image 类（约 1.3KB），这里只要读文字
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('plugin:clipboard-manager|read_text');
    } catch {
      return null;
    }
  }
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/** v0.27 0412：速记时识别出的类型小标，点一下换下一种（只换这一穗） */
export function nextType(t: ItemType): ItemType {
  return TYPE_ORDER[(TYPE_ORDER.indexOf(t) + 1) % TYPE_ORDER.length];
}
