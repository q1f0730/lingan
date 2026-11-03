// v0.21 数据地基：这台设备的 id（首次启动生成，ULID）。每次改穗 / 新枝 / 套路都盖上它，
// 以后同步时用来分辨「谁最后改的」。主存 localStorage（同步可读，Dexie 钩子里要用），库里 meta 表留一份备份。
import { ulid } from './ulid';

const KEY = 'glean.device.v1';
let cached: string | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getDeviceId(): string {
  if (cached) return cached;
  const ls = storage();
  let id = '';
  try {
    id = ls?.getItem(KEY) || '';
  } catch {
    id = '';
  }
  if (!/^[0-9A-Z]{26}$/.test(id)) {
    id = ulid();
    try {
      ls?.setItem(KEY, id);
    } catch {
      /* 存不下也照常用（只在本次运行内一致） */
    }
  }
  cached = id;
  return id;
}

/** 库里 meta 表记的 id 和本机的不一致时（例如浏览器清了 localStorage 但库还在）：沿用库里的 */
export function adoptDeviceId(id: string) {
  if (!/^[0-9A-Z]{26}$/.test(id)) return;
  cached = id;
  try {
    storage()?.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

/** 测试用 */
export function _resetDeviceId() {
  cached = null;
}
