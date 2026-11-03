import { createContext, useContext } from 'react';
import type { Settings } from './settings';
import type { Item } from './types';
import type { Theme } from './theme';

export interface ConfirmOpts {
  title: string;
  body?: string;
  ok: string;
  cancel?: string;
  danger?: boolean;
  /** v0.24 0212 可选理由：一排快捷理由 + 自定义（不选也能确认）。确认时 onPick(理由 id 或 null, 自定义原话) */
  reasons?: { options: Array<{ id: string; label: string }>; custom?: string; onPick: (id: string | null, text?: string) => void };
}
export interface AppCtx {
  settings: Settings;
  setSettings: (s: Settings) => void;
  toast: (msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }) => void;
  /** 确认弹层（替代系统 confirm）：resolve(true) = 确认 */
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  /** seq：当前视图里的穗 id 顺序（详情页 上一穗 / 下一穗 按它翻，0113） */
  /** v0.28 0402：≥1500px 的穗仓里默认在右栏预览；full = 直接整页 */
  openItem: (it: Item, seq?: number[], opts?: { full?: boolean }) => void;
  openCapture: () => void;
  go: (v: View) => void;
  developFrom: (ids: number[]) => void;
  theme: Theme;
  /** ≥1024px：桌面多栏布局 */
  desktop: boolean;
}
export type View = 'library' | 'develop' | 'branches' | 'taste' | 'settings';
export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('no ctx');
  return c;
}
