// v0.36 0519 统一系统通知：手机和电脑都走 tauri-plugin-notification（直接 invoke 插件命令，不引 npm 包，省体积）。
// 不在这里弹权限框：安卓的通知权限仍在 设置 → 极速采集 第一次打开常驻通知时说明再请求（0556），没权限就静默不发。
// 网页版 / e2e 没有 Tauri，什么都不做。懒加载。
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from './desktop';

/** graft = 嫁接在后台完成（0527） */
export type NotifyKind = 'graft';

export const NOTIFY_OFF_KEY = 'glean.sysnotify.off';

export function notifyOff(kind: NotifyKind): boolean {
  return (localStorage.getItem(NOTIFY_OFF_KEY) || '').split(',').includes(kind);
}

/** 窗口不在前台才值得发（在前台时页面里的提示就够了） */
export function inBackground(d: Pick<Document, 'visibilityState' | 'hasFocus'> = document): boolean {
  return d.visibilityState === 'hidden' || !d.hasFocus();
}

export async function notify(kind: NotifyKind, title: string, body: string): Promise<boolean> {
  if (!isTauriEnv() || notifyOff(kind)) return false;
  try {
    const ok = await invoke<boolean | null>('plugin:notification|is_permission_granted');
    if (!ok) return false;
    await invoke('plugin:notification|notify', { options: { title: title.slice(0, 60), body: body.slice(0, 200) } });
    return true;
  } catch {
    return false;
  }
}
