// v0.39 0015 / 0801 网易云歌单整单拾进：粘贴歌单链接 → 公开接口读全部曲目（歌名 / 歌手 / 专辑 / 封面）→ 预览勾选 →
// 每首一穗（标签带歌单名、为什么留空待补）或整单一穗。只读公开歌单，不登录；「我喜欢的音乐」只有设成公开时才读得到。
// 只连 music.163.com（+ 封面图床 *.music.126.net、短链 163cn.tv），由 plugs 的 netease 接入把关。网页版浏览器跨域读不了，要在 App 里用。
import { getFetch } from './ai';
import { assertPlug, NETEASE_HOSTS } from './plugs';
import type { Item } from './types';

export interface Song {
  id: number;
  name: string;
  artists: string[];
  album: string;
  cover?: string;
  /** 毫秒 */
  dur?: number;
}
export interface Playlist {
  id: string;
  name: string;
  creator?: string;
  cover?: string;
  count: number;
  songs: Song[];
}

/** 从分享文案 / 链接里认出歌单 id：music.163.com/#/playlist?id= · /playlist?id= · /m/playlist?id= · /playlist/123/ */
export function playlistId(text: string): string | null {
  const m = /music\.163\.com\/(?:#\/|m\/)?(?:my\/m\/music\/)?playlist(?:\?(?:[^#\s]*&)?id=|\/)(\d{3,})/i.exec(text) || /[?&]id=(\d{3,})[^\s]*playlist|playlist[^\s]*[?&]id=(\d{3,})/i.exec(text);
  return m ? m[1] || m[2] || null : null;
}
export function shortLink(text: string): string | null {
  const m = /https?:\/\/163cn\.tv\/[A-Za-z0-9]+/i.exec(text);
  return m ? m[0] : null;
}

type Raw = Record<string, unknown>;
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const https = (u: string) => (u ? u.replace(/^http:\/\//, 'https://') : undefined);

/** 接口里的一首（v6 playlist 的 tracks 用 ar / al；song/detail 旧接口用 artists / album） */
export function songOf(t: Raw): Song | null {
  const id = Number(t.id);
  const name = str(t.name).trim();
  if (!id || !name) return null;
  const ar = (t.ar || t.artists) as Raw[] | undefined;
  const al = (t.al || t.album) as Raw | undefined;
  return { id, name: name.slice(0, 120), artists: (ar || []).map((a) => str(a.name)).filter(Boolean), album: str(al?.name), cover: https(str(al?.picUrl)), dur: Number(t.dt || t.duration) || undefined };
}

export function parsePlaylist(j: unknown, id: string): { pl: Playlist; missing: number[] } {
  const r = (j || {}) as Raw;
  if (r.code !== 200 || !r.playlist) {
    const code = Number(r.code);
    throw new Error(code === 401 || code === 404 ? '这个歌单不公开或不存在（「我喜欢的音乐」要先在网易云里设成公开）' : `网易云返回 ${r.code ?? '异常'}`);
  }
  const p = r.playlist as Raw;
  const songs = ((p.tracks as Raw[]) || []).map(songOf).filter((x): x is Song => !!x);
  const have = new Set(songs.map((s) => s.id));
  const ids = ((p.trackIds as Raw[]) || []).map((t) => Number(t.id)).filter(Boolean);
  const missing = ids.filter((x) => !have.has(x));
  const creator = str((p.creator as Raw | undefined)?.nickname);
  return { pl: { id, name: str(p.name).trim() || `歌单 ${id}`, creator: creator || undefined, cover: https(str(p.coverImgUrl)), count: Number(p.trackCount) || ids.length || songs.length, songs }, missing };
}

const HDR = { headers: { Accept: 'application/json', Referer: 'https://music.163.com/' } };

async function getJson(url: string): Promise<unknown> {
  assertPlug('netease', url, NETEASE_HOSTS);
  const f = await getFetch();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await f(url, { ...HDR, signal: ctl.signal });
    if (!r.ok) throw new Error(`网易云返回 ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** 读整张歌单：v6 详情给前一批曲目和全部 id，剩下的按 500 首一批补 */
export async function fetchPlaylist(input: string, onPct?: (p: number) => void): Promise<Playlist> {
  let id = playlistId(input);
  const short = !id && shortLink(input);
  if (short) {
    assertPlug('netease', short, NETEASE_HOSTS);
    const r = await (await getFetch())(short, { maxRedirections: 5 } as RequestInit);
    id = playlistId(r.url || '') || playlistId(await r.text().catch(() => ''));
  }
  if (!id) throw new Error('没认出歌单链接（要 music.163.com/…playlist?id=… 这种）');
  const { pl, missing } = parsePlaylist(await getJson(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000`), id);
  for (let i = 0; i < missing.length; i += 500) {
    const batch = missing.slice(i, i + 500);
    const c = encodeURIComponent(JSON.stringify(batch.map((x) => ({ id: x }))));
    const j = (await getJson(`https://music.163.com/api/v3/song/detail?c=${c}`)) as Raw;
    const got = ((j.songs as Raw[]) || []).map(songOf).filter((x): x is Song => !!x);
    pl.songs.push(...got);
    onPct?.(Math.round(((i + batch.length) / missing.length) * 100));
  }
  return pl;
}

export const songUrl = (id: number) => `https://music.163.com/song?id=${id}`;
export const playlistUrl = (id: string) => `https://music.163.com/playlist?id=${id}`;

/** 歌单名当标签：去掉空白和 # ，最多 24 字 */
export function plTag(name: string): string {
  return name.replace(/[\s#]+/g, '').slice(0, 24) || '歌单';
}

type Draft = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;

/** 选中的歌 → 穗：each = 每首一穗（为什么留空待补）；one = 整单一穗（曲目写进内容） */
export function playlistDrafts(pl: Playlist, pick: Set<number>, mode: 'each' | 'one'): Array<{ d: Draft; cover?: string }> {
  const songs = pl.songs.filter((s) => pick.has(s.id));
  const tag = plTag(pl.name);
  const base = { year: '', why: '', tags: [tag], source: '网易云音乐' };
  if (mode === 'one') {
    const lines = songs.map((s, i) => `${i + 1}. ${s.name}${s.artists.length ? ' — ' + s.artists.join(' / ') : ''}`);
    return [{ d: { ...base, type: 'music', title: `歌单《${pl.name}》`.slice(0, 120), creator: pl.creator || '', content: lines.join('\n').slice(0, 4000), url: playlistUrl(pl.id) }, cover: pl.cover }];
  }
  return songs.map((s) => ({ d: { ...base, type: 'music' as const, title: s.name, creator: s.artists.join(' / '), content: s.album ? `专辑《${s.album}》` : '', url: songUrl(s.id) }, cover: s.cover }));
}
