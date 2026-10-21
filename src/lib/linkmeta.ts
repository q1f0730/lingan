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

const MUSIC_HOSTS = ['music.163.com', 'y.qq.com', 'open.spotify.com', 'music.apple.com', 'soundcloud.com', 'bandcamp.com', 'kugou.com', 'kuwo.cn', 'music.douban.com', 'xiami.com', 'music.youtube.com'];
const FILM_HOSTS = ['movie.douban.com', 'imdb.com', 'letterboxd.com', 'themoviedb.org', 'mubi.com'];
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
export async function fetchLinkMeta(url: string): Promise<LinkMeta & { imageData?: string }> {
  const f = await getFetch();
  if (IMAGE_EXT.test(url)) {
    const imageData = await fetchImageData(url).catch(() => undefined);
    return { url, type: 'image', imageData, title: decodeURIComponent(url.split('/').pop()?.split('?')[0] || '图片') };
  }
  const res = await withTimeout((signal) => f(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal }), 12000);
  if (!res.ok) throw new Error(`网页返回 ${res.status}`);
  const html = await res.text();
  const m = parseHtmlMeta(html, url);
  let imageData: string | undefined;
  if (m.image) imageData = await fetchImageData(m.image).catch(() => undefined);
  return { ...m, imageData };
}

async function fetchImageData(url: string): Promise<string> {
  const f = await getFetch();
  const res = await withTimeout((signal) => f(url, { headers: { 'User-Agent': UA }, signal }), 12000);
  if (!res.ok) throw new Error('img ' + res.status);
  const blob = await res.blob();
  if (blob.size > 15_000_000) throw new Error('too big');
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  return compressImage(new File([blob], 'cover', { type }), 1000, 0.8);
}
