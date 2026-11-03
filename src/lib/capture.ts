// v0.22 极速采集：把安卓原生「极速拾」收件箱里的穗收进 IndexedDB。
// 半屏面板 / 选字菜单 / 磁贴 / 常驻通知 / 小部件都不启动 WebView，只在 filesDir/glean_inbox 里写一条 JSON；
// 主界面每次回到前台时调 drainInbox()：逐条 addItem（保留原生的 uid 与按下「存」的时间），成功后才 ack 删除。
// 同一个 uid 已经在库里（上次收完没来得及 ack）就直接 ack，不会重复。

import { addItem, alive, normalizeTags, type LinganDB } from './db';
import { parseQuick, type QuickDraft } from './quick';
import { shareToDraft } from './share';
import { cleanSource, sourceName } from './sources';
import { isUlid } from './ulid';
import type { Item } from './types';

export type InboxKind = 'share' | 'quote' | 'paste' | 'music' | 'note';

export interface InboxEntry {
  v?: number;
  uid: string;
  createdAt: number;
  kind: InboxKind;
  text?: string;
  subject?: string;
  title?: string;
  artist?: string;
  album?: string;
  why?: string;
  tags?: string[];
  source?: string;
  sourcePkg?: string;
  /** 有图（另外经 bridge.image(uid) 取 data URL） */
  image?: boolean;
  mime?: string;
}

export interface InboxBridge {
  list(): string;
  image(uid: string): string;
  ack(uid: string): boolean;
  setHints?(json: string): void;
}

export function inboxBridge(w: unknown = typeof window === 'undefined' ? undefined : window): InboxBridge | null {
  const b = (w as { LinganInbox?: InboxBridge } | undefined)?.LinganInbox;
  return b && typeof b.list === 'function' && typeof b.ack === 'function' ? b : null;
}

/** 收件箱 JSON → 条目；坏行、缺 uid 的丢掉 */
export function parseInbox(raw: string | null | undefined): InboxEntry[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: InboxEntry[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const e = x as InboxEntry;
    if (!isUlid(e.uid)) continue;
    if (!['share', 'quote', 'paste', 'music', 'note'].includes(e.kind)) continue;
    out.push(e);
  }
  return out;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 一条收件箱条目 → 穗草稿（不含 uid / 时间）。image 是 data URL（可空） */
export function inboxToDraft(e: InboxEntry, image?: string): QuickDraft | null {
  const text = str(e.text, 20000);
  let d: QuickDraft | null = null;
  switch (e.kind) {
    case 'share':
      d = shareToDraft({ text, subject: str(e.subject, 500), image: image || undefined });
      break;
    case 'paste':
    case 'note':
      d = parseQuick(text);
      break;
    case 'quote': {
      // 0002 / 0057 选字菜单：一律收成摘抄（文案类型 + 摘抄标签），作者留空待补
      if (!text) return null;
      const body = text.replace(/^[「“"『]+|[」”"』]+$/g, '').trim();
      if (!body) return null;
      d = { type: 'text', title: body.slice(0, 18), content: body, creator: '', year: '', url: '', why: '', tags: ['摘抄'] };
      break;
    }
    case 'music': {
      const title = str(e.title, 200);
      if (!title) return null;
      const album = str(e.album, 200);
      d = { type: 'music', title, creator: str(e.artist, 200), year: '', url: '', content: album ? `专辑《${album}》` : '', why: '', tags: ['正在听'] };
      if (image) d.image = image;
      break;
    }
  }
  if (!d) return null;
  const why = str(e.why, 1000);
  if (why) d.why = why;
  const extra = Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string') : [];
  d.tags = normalizeTags([...(d.tags || []), ...extra]);
  const source = cleanSource(e.source) || sourceName(e.sourcePkg);
  if (source) d.source = source;
  return d;
}

/** 最近 20 穗里最常用的 3 个标签（面板上的快捷标签，0056）；「分享」「摘抄」「正在听」这类自动标签不算 */
const AUTO_TAGS = new Set(['分享', '摘抄', '正在听', '速记']);
export function recentTags(items: Array<Pick<Item, 'tags' | 'createdAt' | 'deletedAt'>>, n = 3): string[] {
  const recent = items.filter((x) => !x.deletedAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  const freq = new Map<string, { c: number; last: number }>();
  recent.forEach((it, i) => {
    for (const t of it.tags || []) {
      if (AUTO_TAGS.has(t)) continue;
      const f = freq.get(t) || { c: 0, last: i };
      f.c++;
      f.last = Math.min(f.last, i);
      freq.set(t, f);
    }
  });
  return [...freq.entries()].sort((a, b) => b[1].c - a[1].c || a[1].last - b[1].last).slice(0, n).map(([t]) => t);
}

/** 把最近标签写给原生面板（没桥就什么都不做） */
export async function pushHints(d: LinganDB, bridge: InboxBridge | null = inboxBridge()): Promise<string[]> {
  if (!bridge?.setHints) return [];
  const items = await d.items.orderBy('createdAt').reverse().limit(40).toArray();
  const tags = recentTags(items.filter(alive));
  try {
    bridge.setHints(JSON.stringify({ tags }));
  } catch {
    /* ignore */
  }
  return tags;
}

export interface DrainResult {
  added: Array<{ id: number; draft: QuickDraft }>;
  dup: number;
  bad: number;
}

/** 收完收件箱里的全部条目。并发调用时第二个直接返回空（防止 focus + visibilitychange 同时触发收两遍） */
let draining: Promise<DrainResult> | null = null;
export function drainInbox(d: LinganDB, bridge: InboxBridge | null = inboxBridge()): Promise<DrainResult> {
  if (!bridge) return Promise.resolve({ added: [], dup: 0, bad: 0 });
  if (draining) return draining.then(() => ({ added: [], dup: 0, bad: 0 }));
  draining = (async () => {
    const res: DrainResult = { added: [], dup: 0, bad: 0 };
    let entries: InboxEntry[] = [];
    try {
      entries = parseInbox(bridge.list());
    } catch {
      return res;
    }
    for (const e of entries) {
      try {
        if (await d.items.where('uid').equals(e.uid).count()) {
          res.dup++;
          bridge.ack(e.uid);
          continue;
        }
        let image = '';
        if (e.image) {
          try {
            image = bridge.image(e.uid) || '';
          } catch {
            image = '';
          }
          if (!/^data:image\//.test(image)) image = '';
        }
        const draft = inboxToDraft(e, image);
        if (!draft) {
          res.bad++;
          bridge.ack(e.uid);
          continue;
        }
        const id = await addItem(draft, d, { createdAt: e.createdAt, uid: e.uid });
        bridge.ack(e.uid);
        res.added.push({ id, draft });
      } catch {
        // 这一条没收进去：留在收件箱，下次再试
      }
    }
    if (res.added.length) await pushHints(d, bridge);
    return res;
  })().finally(() => {
    draining = null;
  });
  return draining;
}
