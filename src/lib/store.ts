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
}
export interface AppCtx {
  settings: Settings;
  setSettings: (s: Settings) => void;
  toast: (msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }) => void;
  /** 确认弹层（替代系统 confirm）：resolve(true) = 确认 */
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  openItem: (it: Item) => void;
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
