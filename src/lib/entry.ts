// v0.33 系统入口（桌面版）：热键 / 开机静默启动 / 剪贴板标记与图片。命令在 src-tauri/src/entry.rs。
// 只由设置页、速记小窗、ClipOffer 在桌面版里动态 import，网页版和首屏不加载。
import { invoke } from '@tauri-apps/api/core';

export interface Hotkeys {
  quick: string;
  excerpt: string;
  grab: boolean;
  /** v0.36 0005 框选截图热键（空 = 关） */
  shot: string;
}
export interface EntryState {
  keys: Hotkeys;
  errors: [string, string][];
  autostart: boolean;
}

export const getEntry = () => invoke<EntryState>('entry_get');
export const setKeys = (keys: Hotkeys) => invoke<EntryState>('entry_set_keys', { keys });
export const setAutostart = (on: boolean) => invoke<boolean>('entry_autostart', { on });
/** v0.36 0005 现在就框选截图（托盘同款） */
export const shotNow = () => invoke('shot_now');


/** 安卓也是 Tauri，但这些命令只有桌面版有 */
export const isDesktopApp = () => !('LinganShare' in window);

interface Peek {
  seq: number;
  private: boolean;
  image: boolean;
}
const peek = () => invoke<Peek>('clip_peek');

/** 0018：密码管理器 / 系统标了「别记录」的剪贴板内容 */
export async function clipPrivate(): Promise<boolean> {
  try {
    return isDesktopApp() && (await peek()).private;
  } catch {
    return false;
  }
}

const SEEN = 'glean.clipimg';
/** 0003：剪贴板里有一张没提示过的图 → 交给速记小窗 */
export async function clipImageOffer(): Promise<{ file: File; url: string } | null> {
  if (!isDesktopApp()) return null;
  const p = await peek();
  if (!p.image || p.private || sessionStorage.getItem(SEEN) === String(p.seq)) return null;
  sessionStorage.setItem(SEEN, String(p.seq));
  const buf = await invoke<ArrayBuffer>('clip_image');
  if (!buf?.byteLength) return null;
  const file = new File([buf], '剪贴板图片.png', { type: 'image/png' });
  return { file, url: URL.createObjectURL(file) };
}

/** 设置里显示用：ctrl+shift+l → Ctrl+Shift+L */
export function prettyKey(a: string): string {
  return a
    .split('+')
    .filter(Boolean)
    .map((x) => (x.length === 1 ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1).toLowerCase()))
    .join('+');
}

/** 按键事件 → 热键串（只按修饰键时返回空） */
export function keyFromEvent(e: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'key' | 'code'>): string {
  const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d{1,2}$/.test(e.code) ? e.code : '';
  if (!k) return '';
  return [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'super', k.toLowerCase()].filter(Boolean).join('+');
}
