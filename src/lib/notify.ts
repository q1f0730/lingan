// v0.22 常驻通知「随手拾一穗」（安卓，MainActivity 的 LinganNotify 桥）。
// 0556：通知权限只在第一次打开这个开关时请求，请求前先说清楚理由；被拒后给「去系统设置」。

export type NotifyPerm = 'granted' | 'ask' | 'blocked';
export interface NotifyStatus {
  perm: NotifyPerm;
  on: boolean;
  /** 最近一次系统权限框的结果（request() 时清空） */
  last: '' | 'granted' | 'denied';
}

interface NotifyBridge {
  status(): string;
  request(): boolean;
  setOn(on: boolean): boolean;
  openSettings(): boolean;
}

export function notifyBridge(w: unknown = typeof window === 'undefined' ? undefined : window): NotifyBridge | null {
  const b = (w as { LinganNotify?: NotifyBridge } | undefined)?.LinganNotify;
  return b && typeof b.status === 'function' ? b : null;
}

export function readNotify(b: NotifyBridge | null = notifyBridge()): NotifyStatus | null {
  if (!b) return null;
  try {
    const o = JSON.parse(b.status());
    const perm: NotifyPerm = o.perm === 'granted' || o.perm === 'blocked' ? o.perm : 'ask';
    return { perm, on: !!o.on, last: o.last === 'granted' || o.last === 'denied' ? o.last : '' };
  } catch {
    return null;
  }
}

export type AskResult = 'granted' | 'denied' | 'blocked' | 'timeout';

/** 弹系统权限框，轮询原生记下的结果（onRequestPermissionsResult 写 last）。最多等 timeoutMs */
export async function requestNotify(b: NotifyBridge | null = notifyBridge(), timeoutMs = 60000, stepMs = 300): Promise<AskResult> {
  if (!b) return 'blocked';
  const before = readNotify(b);
  if (before?.perm === 'granted') return 'granted';
  if (before?.perm === 'blocked') return 'blocked';
  try {
    if (!b.request()) return readNotify(b)?.perm === 'granted' ? 'granted' : 'blocked';
  } catch {
    return 'blocked';
  }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
    const s = readNotify(b);
    if (s?.last === 'granted' || s?.perm === 'granted') return 'granted';
    if (s?.last === 'denied') return s.perm === 'blocked' ? 'blocked' : 'denied';
  }
  return 'timeout';
}

export const NOTIFY_WHY = '拾穗会在通知栏放一条常驻通知：下拉就能直接打字存一穗，或一键拾正在播放的歌。安卓 13 起要先允许拾穗发通知；只用这一条常驻通知，不推送任何消息。';
