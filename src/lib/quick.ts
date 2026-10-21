import { normalizeTags } from './db';
import { extractUrl, guessType } from './linkmeta';
import type { Item, ItemType } from './types';

export type QuickDraft = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;

const QUOTE = /^[「“"『].+[」”"』]$/s;

/** Turn one line of free text into an item draft. `#标签` words become tags. */
export function parseQuick(raw: string): QuickDraft | null {
  let text = raw.replace(/\r/g, '').trim();
  if (!text) return null;
  const tags: string[] = [];
  text = text
    .replace(/(^|\s)#([^\s#]{1,24})(?=\s|$)/g, (_, pre: string, t: string) => {
      tags.push(t);
      return pre;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  const url = extractUrl(text);
  if (url) {
    const rest = text.replace(url, '').trim();
    const type: ItemType = guessType(url);
    return { type, title: (rest || url).slice(0, 120), url, content: '', creator: '', year: '', why: '', tags: normalizeTags(tags) };
  }
  if (!text) return null;
  const firstLine = text.split('\n')[0];
  if (QUOTE.test(text) || text.length > 60) {
    // a quote or a long passage → 文案 with the passage as content
    const body = text.replace(/^[「“"『]+|[」”"』]+$/g, '');
    return { type: 'text', title: body.slice(0, 18), content: body, creator: '', year: '', url: '', why: '', tags: normalizeTags(tags) };
  }
  const multi = text.includes('\n');
  return { type: 'idea', title: firstLine.slice(0, 120), content: multi ? text : '', creator: '', year: '', url: '', why: '', tags: normalizeTags(tags) };
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

/** Should we offer this clipboard text? Not empty, not huge, not already offered, not already in the library. */
export function shouldOffer(text: string | null | undefined, lastHash: string | null, existing: Array<Pick<Item, 'title' | 'url' | 'content'>>): boolean {
  const t = (text || '').trim();
  if (t.length < 2 || t.length > 2000) return false;
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
      const mod = await import('@tauri-apps/plugin-clipboard-manager');
      return await mod.readText();
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
