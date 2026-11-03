// v0.33 0510 glean:// 深链接（懒加载）。入口：桌面版单实例 / 冷启动参数（entry.rs）、安卓 intent（MainActivity）、页面里的 glean:link 事件。
//   glean://capture?text=…&url=…&why=…&title=…&tags=a,b   直接拾一穗（进待理）
//     带 &from=名字（v0.34 0900 别人递来的）：不进穗仓，先放进 待理 · 递来的
//   glean://quick?text=…                                   打开速记小窗并填好
//     v0.36 浏览器扩展：&img=图片地址（0042 拾这张图，App 里下载）、&clip=1（0009 视频当前帧已放进剪贴板，桌面版带上）
//   glean://item/<uid>                                     打开这一穗
//   glean://graft?ids=<uid>,<uid>                          拿这几穗去嫁接
//   glean://search?q=…                                     秒搜
//   glean://go/daily|library|settings|search               去某一页
import { db, alive } from './db';
import { parseQuick } from './quick';
import type { Item } from './types';
import type { Settings } from './settings';

export type Link =
  | { k: 'capture'; text: string; url: string; why: string; title: string; tags: string[]; from: string; img: string; clip: boolean }
  | { k: 'quick'; text: string }
  | { k: 'item'; uid: string }
  | { k: 'graft'; uids: string[] }
  | { k: 'search'; q: string }
  | { k: 'go'; v: string };

const MAX = 4000;

export function parseLink(raw: string): Link | null {
  const m = /^glean:\/\/([^?#]*)(?:\?([^#]*))?/i.exec((raw || '').trim());
  if (!m || raw.length > 8192) return null;
  let path: string[];
  try {
    path = m[1].split('/').filter(Boolean).map((x) => decodeURIComponent(x));
  } catch {
    return null;
  }
  const p = new URLSearchParams(m[2] || '');
  const s = (k: string) => (p.get(k) || '').trim().slice(0, MAX);
  const head = (path[0] || '').toLowerCase();
  if (head === 'capture') {
    const url = /^https?:\/\//i.test(s('url')) ? s('url') : '';
    const img = /^https?:\/\//i.test(s('img')) ? s('img') : '';
    const text = s('text');
    if (!text && !url && !img) return null;
    const tags = s('tags')
      .split(/[,，\s]+/)
      .map((t) => t.replace(/^#/, '').slice(0, 20))
      .filter(Boolean)
      .slice(0, 8);
    return { k: 'capture', text, url, why: s('why'), title: s('title').slice(0, 120), tags, from: s('from').slice(0, 40), img, clip: s('clip') === '1' };
  }
  if (head === 'quick' || head === 'new') return { k: 'quick', text: s('text') };
  if (head === 'item' && /^[0-9A-Za-z]{10,40}$/.test(path[1] || '')) return { k: 'item', uid: path[1] };
  if (head === 'graft') {
    const uids = s('ids')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => /^[0-9A-Za-z]{10,40}$/.test(x))
      .slice(0, 12);
    return uids.length ? { k: 'graft', uids } : null;
  }
  if (head === 'search') return { k: 'search', q: s('q').slice(0, 200) };
  if (head === 'go' && /^(daily|library|settings|search)$/.test(path[1] || '')) return { k: 'go', v: path[1] };
  return null;
}

export function itemLink(uid: string): string {
  return 'glean://item/' + uid;
}

export interface LinkCtx {
  openItem: (it: Item, list?: number[], opts?: { full?: boolean }) => void;
  developFrom: (ids: number[]) => void;
  toast: (m: string, kind?: 'ok' | 'err') => void;
  settings: Settings;
  goTo: (v: string) => void;
  quick: (text: string) => void;
}

async function byUids(uids: string[]): Promise<Item[]> {
  const rows = await db.items.where('uid').anyOf(uids).toArray();
  return rows.filter(alive);
}

async function linkImage(l: { img: string; clip: boolean }): Promise<string | undefined> {
  try {
    if (l.img) return await (await import('./linkmeta')).fetchImageData(l.img);
    if (l.clip) {
      const c = await (await import('./entry')).clipImageOffer();
      if (c) return await (await import('./image')).compressImage(c.file);
    }
  } catch {
    /* 图拿不到就只存文字和链接 */
  }
  return undefined;
}

export async function routeLink(raw: string, c: LinkCtx): Promise<void> {
  const l = parseLink(raw);
  if (!l) return void c.toast('认不出这个 glean:// 链接', 'err');
  if (l.k === 'go') return c.goTo(l.v);
  if (l.k === 'quick') return c.quick(l.text);
  if (l.k === 'search') {
    c.goTo('search');
    // 秒搜是懒加载的：等输入框出来（最多 3 秒）再填词
    for (let n = 0; l.q && n < 30; n++) {
      await new Promise((r) => setTimeout(r, 100));
      const i = document.querySelector<HTMLInputElement>('.search-view input');
      if (!i) continue;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(i, l.q);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      break;
    }
    return;
  }
  if (l.k === 'item') {
    const [it] = await byUids([l.uid]);
    return it ? c.openItem(it, undefined, { full: true }) : c.toast('这一穗不在这台设备上', 'err');
  }
  if (l.k === 'graft') {
    const its = await byUids(l.uids);
    if (!its.length) return c.toast('这几穗不在这台设备上', 'err');
    return c.developFrom(its.map((x) => x.id!));
  }
  if (l.from) {
    const { addHanded } = await import('./handed');
    addHanded({ from: l.from, title: l.title || (l.text || l.url).slice(0, 60), text: l.text, url: l.url, tags: l.tags });
    return c.toast(`${l.from} 递来一穗，在 待理 · 递来的`);
  }
  const d = parseQuick([l.text, l.url && !l.text.includes(l.url) ? l.url : ''].filter(Boolean).join(' ') || l.title || '图片');
  if (!d) return;
  // v0.36 扩展带来的图：网页里的图片地址（App 里下载，不受跨域限制）或剪贴板里的视频帧（桌面版）
  const image = await linkImage(l);
  if (image) Object.assign(d, { type: 'image', image });
  if (l.title) d.title = l.title;
  if (l.why) d.why = l.why;
  d.tags = Array.from(new Set([...d.tags, ...l.tags])).slice(0, 12);
  const { quickAdd } = await import('../components/QuickBar');
  await quickAdd(d, c.settings, (m) => c.toast(m, 'err'));
  c.toast(`从链接拾进「${d.title.slice(0, 16)}」`);
}
