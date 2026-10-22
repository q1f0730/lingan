export const QUICK_EVENT = 'quick-focus';
export const QUICK_SHORTCUT = 'Ctrl+Shift+L';

export function isTauriEnv(w: unknown = typeof window === 'undefined' ? undefined : window): boolean {
  return !!w && typeof w === 'object' && '__TAURI_INTERNALS__' in (w as object);
}

/** Desktop only: the Rust side (global shortcut / tray) asks the UI to focus the quick bar. */
export async function onQuickFocus(cb: () => void): Promise<() => void> {
  if (!isTauriEnv()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen(QUICK_EVENT, cb);
  } catch {
    return () => {};
  }
}

/** v0.16 tray menu: 打开穗仓 / 今日一穗 / 设置 → the UI switches view */
export const GO_EVENT = 'glean-go';
export async function onTrayGo(cb: (view: string) => void): Promise<() => void> {
  if (!isTauriEnv()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<string>(GO_EVENT, (e) => cb(String(e.payload || '')));
  } catch {
    return () => {};
  }
}
