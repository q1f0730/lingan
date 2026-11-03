// v0.22「正在播放一键拾」：安卓读媒体会话（MainActivity 的 LinganNowPlaying 桥，需要「通知使用权」），
// Windows 读系统媒体传输控件 SMTC（Rust 命令 now_playing，无需权限）。浏览器里不支持。

import { isTauriEnv } from './desktop';
import { cleanSource, sourceName } from './sources';
import type { QuickDraft } from './quick';

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  /** 来源 App 显示名（可空） */
  app: string;
  /** 封面 data URL（可空） */
  image?: string;
}

export type NowPlayingResult = { ok: true; np: NowPlaying } | { ok: false; reason: 'no-access' | 'nothing' | 'unsupported' | 'error' };

interface NPBridge {
  status(): string;
  read(): string;
  openAccess(): boolean;
}

function bridge(w: unknown = typeof window === 'undefined' ? undefined : window): NPBridge | null {
  const b = (w as { LinganNowPlaying?: NPBridge } | undefined)?.LinganNowPlaying;
  return b && typeof b.read === 'function' ? b : null;
}

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent || '');
}

/** 这台设备能不能读正在播放：android（要权限）/ windows / null */
export function nowPlayingSupport(w?: unknown): 'android' | 'windows' | null {
  if (bridge(w)) return 'android';
  if (isTauriEnv(w) && isWindows()) return 'windows';
  return null;
}

/** 安卓：通知使用权有没有给 */
export function nowPlayingAccess(): boolean {
  const b = bridge();
  if (!b) return true;
  try {
    return b.status() === 'ok';
  } catch {
    return false;
  }
}

export function openNowPlayingAccess(): boolean {
  try {
    return !!bridge()?.openAccess();
  } catch {
    return false;
  }
}

/** 原生返回的 JSON（安卓）或对象（Windows）→ NowPlaying；没有标题 = 没在放 */
export function parseNowPlaying(raw: unknown): NowPlaying | null {
  let o: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  } else if (raw && typeof raw === 'object') o = raw as Record<string, unknown>;
  if (!o) return null;
  const s = (k: string) => (typeof o![k] === 'string' ? (o![k] as string).trim() : '');
  const title = s('title').slice(0, 200);
  if (!title) return null;
  const image = s('image');
  return {
    title,
    artist: s('artist').slice(0, 200),
    album: s('album').slice(0, 200),
    app: sourceName(s('app')) || sourceName(s('pkg')) || (/\.exe$|!/i.test(s('app')) ? '' : cleanSource(s('app'))),
    image: /^data:image\//.test(image) ? image : undefined,
  };
}

export async function readNowPlaying(): Promise<NowPlayingResult> {
  const b = bridge();
  if (b) {
    try {
      if (b.status() !== 'ok') return { ok: false, reason: 'no-access' };
      const raw = b.read();
      if (raw && raw.includes('"error"')) {
        const err = JSON.parse(raw).error;
        return { ok: false, reason: err === 'no-access' ? 'no-access' : 'error' };
      }
      const np = parseNowPlaying(raw);
      return np ? { ok: true, np } : { ok: false, reason: 'nothing' };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }
  if (nowPlayingSupport() === 'windows') {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const r = await invoke<Record<string, unknown> | null>('now_playing');
      if (r && typeof r.app === 'string') r.app = sourceName(r.app) || '';
      const np = parseNowPlaying(r);
      return np ? { ok: true, np } : { ok: false, reason: 'nothing' };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }
  return { ok: false, reason: 'unsupported' };
}

/** 正在播放 → 音乐穗草稿 */
export function nowPlayingDraft(np: NowPlaying): QuickDraft {
  const d: QuickDraft = {
    type: 'music',
    title: np.title,
    creator: np.artist,
    year: '',
    url: '',
    content: np.album ? `专辑《${np.album}》` : '',
    why: '',
    tags: ['正在听'],
  };
  if (np.app) d.source = np.app;
  if (np.image) d.image = np.image;
  return d;
}

export const NP_REASON: Record<Exclude<NowPlayingResult, { ok: true }>['reason'], string> = {
  'no-access': '还没给拾穗「通知使用权」',
  nothing: '现在没有在放的歌',
  unsupported: '这台设备读不到正在播放',
  error: '没读到正在播放的歌',
};

export const NP_ACCESS_WHY = '要读到正在播放的歌，需要在系统里给拾穗打开「通知使用权」。拾穗只读歌名、歌手、专辑和封面，不读、不存任何通知内容。';
