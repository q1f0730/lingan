// v0.22 正在播放：只做平台探测（首包只带这一点；读歌、解析、来源表都在 lib/nowplaying.ts，点按钮时才加载）
import { isTauriEnv } from './desktop';

export function nowPlayingSupport(w: unknown = typeof window === 'undefined' ? undefined : window): 'android' | 'windows' | null {
  const b = (w as { LinganNowPlaying?: { read?: unknown } } | undefined)?.LinganNowPlaying;
  if (b && typeof b.read === 'function') return 'android';
  if (isTauriEnv(w) && typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent || '')) return 'windows';
  return null;
}
