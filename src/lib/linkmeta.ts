import type { ItemType } from './types';

export interface LinkMeta {
  url: string;
  title?: string;
  description?: string;
  image?: string; // absolute URL
  siteName?: string;
  type: ItemType;
  creator?: string;
  year?: string;
}

const MUSIC_HOSTS = ['music.163.com', 'y.qq.com', 'open.spotify.com', 'music.apple.com', 'soundcloud.com', 'bandcamp.com', 'kugou.com', 'kuwo.cn', 'music.douban.com', 'xiami.com', 'music.youtube.com', '163cn.tv'];
const FILM_HOSTS = ['movie.douban.com', 'imdb.com', 'letterboxd.com', 'themoviedb.org', 'mubi.com', 'maoyan.com', 'tmdb.org'];
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)(\?|#|$)/i;

export function guessType(url: string): ItemType {
  let host = '';
  try {
    host = new URL(url).host.replace(/^www\./, '');
  } catch {
    return 'link';
  }
  if (IMAGE_EXT.test(url)) return 'image';
  if (MUSIC_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return 'music';
  if (FILM_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return 'film';
  // v0.35 0063 / 0064 / 0803：豆瓣移动版按路径、B 站视频算影像
  const m = /^(?:m\.douban\.com\/(movie|music)|(?:[\w-]+\.)?bilibili\.com\/video)\//.exec(host + new URL(url).pathname);
  if (m) return m[1] === 'music' ? 'music' : 'film';
  return 'link';
}

export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"'，。！？、）)】]+/i);
  return m ? m[0] : null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html: string, keys: string[]): string | undefined {
  for (const k of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decode(m[1]);
  }
  return undefined;
}

export function parseHtmlMeta(html: string, url: string): LinkMeta {
  const head = html.slice(0, 200000);
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = meta(head, ['og:title', 'twitter:title']) || (titleTag ? decode(titleTag[1]) : undefined);
  const description = meta(head, ['og:description', 'description', 'twitter:description']);
  let image = meta(head, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
  const siteName = meta(head, ['og:site_name', 'application-name']);
  if (image) {
    try {
      image = new URL(image, url).href;
    } catch {
      image = undefined;
    }
  }
  let type = guessType(url);
  const ogType = meta(head, ['og:type']) || '';
  if (type === 'link') {
    if (/music|song|album/i.test(ogType)) type = 'music';
    else if (/video\.movie|movie/i.test(ogType)) type = 'film';
  }
  // strip site suffix like " - 网易云音乐" / " (豆瓣)"
  if (title) title = title.replace(/\s*[-|_–—]\s*(网易云音乐|QQ音乐|豆瓣|IMDb|Spotify|YouTube|哔哩哔哩.*|bilibili.*)$/i, '').replace(/\s*\((豆瓣)\)$/, '').trim();
  let year: string | undefined;
  const ym = (title || '').match(/[（(](\d{4})[)）]/);
  if (ym) {
    year = ym[1];
    title = (title || '').replace(ym[0], '').trim();
  }
  return { url, title: title?.slice(0, 120), description: description?.slice(0, 400), image, siteName, type, year };
}

import { getFetch } from './ai';
import { compressImage } from './image';
import { cleanUrl } from './cleanurl';

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await p(c.signal);
  } finally {
    clearTimeout(t);
  }
}

/** Fetch a page and return its metadata plus a compressed cover image data URL (if any). */
/** v0.20：App 里 http 只放本机 / 局域网，公网的 http 链接改走 https 抓（网页本身照原样保存） */
export function fetchableUrl(url: string): string {
  const m = /^http:\/\/([^/:?#]+)/i.exec(url);
  if (!m) return url;
  const h = m[1].toLowerCase();
  const local = h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d/.test(h);
  return local ? url : 'https://' + url.slice(7);
}

export async function fetchLinkMeta(rawUrl: string): Promise<LinkMeta & { imageData?: string }> {
  const f = await getFetch();
  const inApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const url = inApp ? fetchableUrl(rawUrl) : rawUrl;
  if (IMAGE_EXT.test(url)) {
    const imageData = await fetchImageData(url).catch(() => undefined);
    return { url: rawUrl, type: 'image', imageData, title: decodeURIComponent(url.split('/').pop()?.split('?')[0] || '图片') };
  }
  // v0.30 0906 出站记录：抓链接只发了链接本身（v0.35 短链跳转、B 站接口各记一条）
  const rf = async (u: string, init?: RequestInit) => {
    const rec = (ok: boolean) => void import('./outbound').then((o) => o.recordOutbound({ at: Date.now(), host: o.hostOf(u), kind: 'link', fields: ['链接'], bytes: u.length, ok }));
    try {
      const r = await withTimeout((signal) => f(u, { ...init, signal, maxRedirections: 5 } as RequestInit), 12000);
      rec(r.ok);
      return r;
    } catch (e) {
      rec(false);
      throw e;
    }
  };
  // v0.35 0012 短链先跟着跳到真实地址（存展开后的链接）；0803 B 站视频走公开接口
  const P = await import('./platforms');
  const hdr = { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } };
  let target = url;
  let expanded: string | undefined;
  let res: Response | undefined;
  if (!P.biliId(url)) {
    res = await rf(url, hdr);
    const fin = res.url;
    if (fin && fin !== url && /^https?:/.test(fin)) {
      target = fin;
      if (P.isShort(url)) expanded = cleanUrl(fin);
    }
  }
  const out = expanded || rawUrl;
  const bid = P.biliId(target);
  const bm = bid ? await P.biliMeta(bid, target, rf) : null;
  let m: LinkMeta;
  if (bm) m = bm;
  else {
    res ||= await rf(target, hdr);
    if (!res.ok) throw new Error(`网页返回 ${res.status}`);
    m = parseHtmlMeta(await res.text(), target);
  }
  let imageData: string | undefined;
  if (m.image) imageData = await fetchImageData(m.image).catch(() => undefined);
  return { ...m, url: out, imageData };
}

export async function fetchImageData(url: string): Promise<string> {
  const f = await getFetch();
  const res = await withTimeout((signal) => f(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? fetchableUrl(url) : url, { headers: { 'User-Agent': UA }, signal }), 12000);
  if (!res.ok) throw new Error('img ' + res.status);
  const blob = await res.blob();
  if (blob.size > 15_000_000) throw new Error('too big');
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  return compressImage(new File([blob], 'cover', { type }), 1000, 0.8);
}
