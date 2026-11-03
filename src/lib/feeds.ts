// v0.39 0804 RSS 订阅进「待拾」而不是穗仓（+ 0826 RSSHub 路由模板、0847 Letterboxd 公开 RSS）。
// 订阅源和待拾条目放在独立的 IndexedDB `glean-feed`（不是主库的 schema 变更，不同步、不进备份）：
// 待拾只有标题和一行摘要；丢掉 = 记下不再出现；拾 = 必须写一句为什么或至少一个标签，才成为穗仓里的一穗。
// 每天最多自动拉一次（App 打开、空闲时；没有订阅就不加载这个模块），也可以在设置里「现在拉」。
import Dexie, { type Table } from 'dexie';
import { getFetch } from './ai';
import { assertPlug } from './plugs';
import { decodeEntities, htmlText } from './snapshot';

export interface Feed {
  id?: number;
  url: string;
  title: string;
  addedAt: number;
  lastAt?: number;
  lastErr?: string;
}
export interface Entry {
  id?: number;
  /** 源地址 + guid / 链接：同一条只进一次 */
  key: string;
  feedId: number;
  title: string;
  link: string;
  summary: string;
  /** 发布时间（读不出就用拉取时间） */
  at: number;
  got: number;
  state: 'new' | 'kept' | 'dropped';
}

class FeedDB extends Dexie {
  feeds!: Table<Feed, number>;
  entries!: Table<Entry, number>;
  constructor(name = 'glean-feed') {
    super(name);
    this.version(1).stores({ feeds: '++id, &url', entries: '++id, &key, feedId, state, at' });
  }
}
let _db: FeedDB | null = null;
export const fdb = () => (_db ||= new FeedDB());

export const FEEDS_N = 'glean.feeds.n';
export const FEEDS_NEW = 'glean.feeds.new';
export const FEEDS_LAST = 'glean.feeds.last';
const PER_FEED = 30;

// ——— 解析（RSS 2.0 / RSS 1.0 RDF / Atom），纯正则，单测在 node 里跑 ———
const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
function tag(block: string, names: string[]): string {
  for (const n of names) {
    const m = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i').exec(block);
    if (m && m[1].trim()) return cdata(m[1]).trim();
  }
  return '';
}
function atomLink(block: string): string {
  const links = block.match(/<link\b[^>]*>/gi) || [];
  const alt = links.find((l) => /rel=["']alternate["']/i.test(l)) || links.find((l) => !/rel=/i.test(l)) || links[0] || '';
  return decodeEntities(/href=["']([^"']+)["']/i.exec(alt)?.[1] || '');
}
const when = (s: string) => {
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : 0;
};
const oneLine = (html: string, n = 140) => {
  const t = htmlText(decodeEntities(cdata(html))).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

export interface Parsed {
  title: string;
  items: Array<{ title: string; link: string; guid: string; summary: string; at: number }>;
}
export function parseFeed(xml: string, base = ''): Parsed {
  const atom = /<feed\b[^>]*>/i.test(xml) && !/<rss\b|<rdf:RDF\b/i.test(xml);
  const head = xml.split(atom ? /<entry\b/i : /<item\b/i)[0];
  const title = oneLine(tag(head, ['title']), 80) || '订阅';
  const items: Parsed['items'] = [];
  const re = atom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const b = m[1];
    let link = atom ? atomLink(b) : decodeEntities(tag(b, ['link'])) || (/<link\b[^>]*href=["']([^"']+)/i.exec(b)?.[1] ?? '');
    const guid = decodeEntities(tag(b, atom ? ['id'] : ['guid'])) || link;
    if (!link && /^https?:\/\//.test(guid)) link = guid;
    try {
      if (link) link = new URL(link, base || undefined).href;
    } catch {
      /* keep */
    }
    const t = oneLine(tag(b, ['title']), 120);
    if (!t && !link) continue;
    items.push({ title: t || link, link, guid, summary: oneLine(tag(b, atom ? ['summary', 'content'] : ['description', 'content:encoded', 'summary'])), at: when(tag(b, atom ? ['published', 'updated'] : ['pubDate', 'dc:date', 'published', 'updated'])) });
  }
  return { title, items };
}

// ——— RSSHub 路由模板（0826）+ Letterboxd（0847） ———
export const RSSHUB_KEY = 'glean.rsshub';
export const RSSHUB_DEFAULT = 'https://rsshub.app';
export interface Tpl {
  id: string;
  name: string;
  hint: string;
  /** {x} 换成用户填的；rsshub = 走 RSSHub 实例 */
  path: string;
  rsshub: boolean;
}
export const TEMPLATES: Tpl[] = [
  { id: 'bili', name: 'B 站 UP 主投稿', hint: 'UP 主 UID（空间链接里的数字）', path: '/bilibili/user/video/{x}', rsshub: true },
  { id: 'weibo', name: '微博博主', hint: '微博 UID', path: '/weibo/user/{x}', rsshub: true },
  { id: 'xyz', name: '小宇宙播客', hint: '播客 ID（链接 podcast/ 后面那串）', path: '/xiaoyuzhou/podcast/{x}', rsshub: true },
  { id: 'douban', name: '豆瓣用户广播', hint: '豆瓣用户 ID', path: '/douban/people/{x}/status', rsshub: true },
  { id: 'zhihu', name: '知乎专栏', hint: '专栏 ID（zhuanlan.zhihu.com/ 后面）', path: '/zhihu/zhuanlan/{x}', rsshub: true },
  { id: 'lbxd', name: 'Letterboxd 观影日记', hint: 'Letterboxd 用户名', path: 'https://letterboxd.com/{x}/rss/', rsshub: false },
];
export function rsshubBase(): string {
  try {
    return (localStorage.getItem(RSSHUB_KEY) || RSSHUB_DEFAULT).replace(/\/+$/, '');
  } catch {
    return RSSHUB_DEFAULT;
  }
}
export function tplUrl(t: Tpl, x: string, base = rsshubBase()): string {
  const v = encodeURIComponent(x.trim().replace(/^@/, ''));
  const p = t.path.replace('{x}', v);
  return t.rsshub ? base.replace(/\/+$/, '') + p : p;
}

// ——— 存取 ———
function bump() {
  void fdb()
    .entries.where('state')
    .equals('new')
    .count()
    .then((n) => {
      try {
        localStorage.setItem(FEEDS_NEW, String(n));
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event('glean:feeds'));
    });
}
async function countFeeds() {
  const n = await fdb().feeds.count();
  try {
    if (n) localStorage.setItem(FEEDS_N, String(n));
    else localStorage.removeItem(FEEDS_N);
  } catch {
    /* ignore */
  }
}

/** 订阅源只许连它自己的域名（0805）：拉一个源时声明的就是这个源的 host */
async function fetchFeed(url: string): Promise<string> {
  assertPlug('feeds', url, [new URL(url).hostname]);
  const f = await getFetch();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await f(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`返回 ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

export async function addFeed(url0: string): Promise<{ feed: Feed; added: number }> {
  const url = url0.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('要 http(s) 开头的订阅地址');
  if (await fdb().feeds.where('url').equals(url).count()) throw new Error('已经订阅过了');
  const xml = await fetchFeed(url);
  const p = parseFeed(xml, url);
  if (!p.items.length && !/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('这个地址不像 RSS / Atom 订阅');
  const feed: Feed = { url, title: p.title, addedAt: Date.now(), lastAt: Date.now() };
  feed.id = await fdb().feeds.add(feed);
  const added = await store(feed, p);
  await countFeeds();
  bump();
  return { feed, added };
}

async function store(feed: Feed, p: Parsed): Promise<number> {
  const now = Date.now();
  const rows: Entry[] = p.items.slice(0, PER_FEED).map((x) => ({ key: `${feed.url}|${x.guid || x.link}`, feedId: feed.id!, title: x.title, link: x.link, summary: x.summary, at: x.at || now, got: now, state: 'new' }));
  const have = new Set((await fdb().entries.where('key').anyOf(rows.map((r) => r.key)).toArray()).map((r) => r.key));
  const fresh = rows.filter((r) => !have.has(r.key));
  if (fresh.length) await fdb().entries.bulkAdd(fresh);
  return fresh.length;
}

export async function removeFeed(id: number): Promise<void> {
  await fdb().transaction('rw', fdb().feeds, fdb().entries, async () => {
    await fdb().feeds.delete(id);
    await fdb().entries.where('feedId').equals(id).delete();
  });
  await countFeeds();
  bump();
}

/** 拉全部订阅；返回新进待拾几条 */
export async function pullAll(): Promise<{ added: number; failed: number }> {
  let added = 0, failed = 0;
  for (const feed of await fdb().feeds.toArray()) {
    try {
      added += await store(feed, parseFeed(await fetchFeed(feed.url), feed.url));
      await fdb().feeds.update(feed.id!, { lastAt: Date.now(), lastErr: undefined });
    } catch (e) {
      failed++;
      await fdb().feeds.update(feed.id!, { lastErr: e instanceof Error ? e.message : String(e) });
    }
  }
  // 丢掉 / 拾过的只留 90 天（够认出「又来一遍」就行）
  await fdb().entries.where('at').below(Date.now() - 90 * 86400000).and((e) => e.state !== 'new').delete();
  try {
    localStorage.setItem(FEEDS_LAST, String(Date.now()));
  } catch {
    /* ignore */
  }
  bump();
  return { added, failed };
}

/** 每天最多自动拉一次 */
export async function dailyPull(now = Date.now()): Promise<void> {
  const last = +(localStorage.getItem(FEEDS_LAST) || 0);
  if (now - last < 20 * 3600000) return;
  if (!(await fdb().feeds.count())) return;
  await pullAll();
}

export async function setState(ids: number[], state: Entry['state']): Promise<void> {
  await fdb().entries.where('id').anyOf(ids).modify({ state });
  bump();
}

/** 拾：必须有一句为什么或至少一个标签（0804 的核心：待拾不是穗，你给了理由它才是） */
export function pickReady(why: string, tags: string[]): boolean {
  return !!why.trim() || tags.length > 0;
}
