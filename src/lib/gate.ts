// v0.34 0905 出站总开关：关掉后所有往外网发的请求（模型、向量、看图、抓链接、网盘同步、检查更新）都在 getFetch 这一层被拦下，
// Agent 写入也停；本机 / 局域网地址照常（本地模型、局域网直连只在家里转）。存本机 localStorage，不进同步。
import { isLocalHost } from './privacy';

export const GATE_KEY = 'glean.outbound.off';
export const GATE_MSG = '出站已关：设置 → 出站 里打开总开关';

export function outboundOff(): boolean {
  try {
    return localStorage.getItem(GATE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setOutboundOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(GATE_KEY, '1');
    else localStorage.removeItem(GATE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('glean:gate'));
}

/** 这个地址现在能不能发：总开关开着都能；关着只放本机 / 局域网 */
export function mayReach(url: string): boolean {
  if (!outboundOff()) return true;
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
export function assertReach(url: string): void {
  if (!mayReach(url)) throw new Error(GATE_MSG);
}
