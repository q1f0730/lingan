import { createContext, useContext } from 'react';
import type { Settings } from './settings';
import type { Item } from './types';

export interface AppCtx {
  settings: Settings;
  setSettings: (s: Settings) => void;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  openItem: (it: Item) => void;
  openCapture: () => void;
  go: (v: View) => void;
  developFrom: (ids: number[]) => void;
}
export type View = 'library' | 'develop' | 'taste' | 'settings';
export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('no ctx');
  return c;
}
