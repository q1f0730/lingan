// v0.25 自动更新（0511 0751）
// - Windows：tauri-plugin-updater 读 GitHub Releases 的 latest.json（CI 用私钥签名，公钥在 tauri.conf.json），
//   后台下载好再提示「重启更新」。
// - 安卓：读同一份 latest.json 比版本号，有新版就提示，点了用系统浏览器下载 APK（系统安装器装，签名链不变）。
// 隐私：只 GET 一个静态文件，不带任何设备参数；自动检查每天最多一次，设置里可关。

import { isTauriEnv } from './desktop';

export const REPO = 'q1f0730/lingan';
export const LATEST_JSON = `https://github.com/${REPO}/releases/latest/download/latest.json`;
export const RELEASES = `https://github.com/${REPO}/releases`;
export const UPDATE_KEY = 'glean.update.v1';
export const DAY = 86400000;

export interface UpdatePrefs {
  /** 自动检查（默认开） */
  auto: boolean;
  lastCheck: number;
}

export function readUpdatePrefs(s: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): UpdatePrefs {
  try {
    const o = JSON.parse(s?.getItem(UPDATE_KEY) || '{}') || {};
    return { auto: o.auto !== false, lastCheck: Number(o.lastCheck) || 0 };
  } catch {
    return { auto: true, lastCheck: 0 };
  }
}
export function writeUpdatePrefs(p: UpdatePrefs) {
  try {
    localStorage.setItem(UPDATE_KEY, JSON.stringify({ auto: !!p.auto, lastCheck: p.lastCheck || 0 }));
  } catch {
    /* ignore */
  }
}

/** 0751：每天最多自动查一次 */
export function dueForCheck(p: UpdatePrefs, now = Date.now()): boolean {
  return p.auto && (now - p.lastCheck >= DAY || p.lastCheck > now + DAY);
}

/** 1.2.10 > 1.2.9；忽略 v 前缀与 -beta 之类的后缀 */
export function cmpVer(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split(/[-+]/)[0].split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[-+]/)[0].split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface Latest {
  version: string;
  notes: string;
  pubDate?: string;
  apkUrl: string;
  pageUrl: string;
}

export function apkUrl(v: string) {
  const x = v.replace(/^v/i, '');
  return `https://github.com/${REPO}/releases/download/v${x}/Glean_${x}_android.apk`;
}

/** tauri updater 的 latest.json → 我们要的几样（不合法返回 null） */
export function parseLatest(raw: unknown): Latest | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const v = String(o.version || '').replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+/.test(v)) return null;
  return { version: v, notes: String(o.notes || '').slice(0, 4000), pubDate: o.pub_date ? String(o.pub_date) : undefined, apkUrl: apkUrl(v), pageUrl: `${RELEASES}/tag/v${v}` };
}

export type Platform = 'windows' | 'android' | 'web';
export function updatePlatform(): Platform {
  if (!isTauriEnv()) return 'web';
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) ? 'android' : 'windows';
}

export type CheckResult = { kind: 'none'; current: string } | { kind: 'android'; latest: Latest } | { kind: 'desktop'; version: string; notes: string; ready: boolean } | { kind: 'error'; message: string };

/** 安卓：读 latest.json（走 tauri http 插件，不受页面 CSP 限制） */
async function fetchLatest(): Promise<Latest | null> {
  const { fetch } = await import('@tauri-apps/plugin-http');
  const r = await fetch(LATEST_JSON, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseLatest(await r.json());
}

type DesktopUpdate = { version: string; body?: string; download: (cb?: (e: unknown) => void) => Promise<void>; install: () => Promise<void> };
let pending: DesktopUpdate | null = null;
let downloaded = false;

export async function checkForUpdate(current: string, opts: { download?: boolean } = {}): Promise<CheckResult> {
  const plat = updatePlatform();
  try {
    if (plat === 'android') {
      const l = await fetchLatest();
      if (l && cmpVer(l.version, current) > 0) return { kind: 'android', latest: l };
      return { kind: 'none', current };
    }
    if (plat === 'windows') {
      const { check } = await import('@tauri-apps/plugin-updater');
      const u = (await check()) as DesktopUpdate | null;
      if (!u) return { kind: 'none', current };
      if (!pending || pending.version !== u.version) {
        pending = u;
        downloaded = false;
      }
      if (opts.download && !downloaded) {
        await pending.download();
        downloaded = true;
      }
      return { kind: 'desktop', version: u.version, notes: (u.body || '').slice(0, 4000), ready: downloaded };
    }
    return { kind: 'error', message: '网页版不需要更新：刷新页面就是最新' };
  } catch (e) {
    return { kind: 'error', message: (e as Error)?.message || String(e) };
  }
}

/** Windows：装上已下载的更新并重启（passive 安装器，界面只显示进度） */
export async function installAndRestart(): Promise<void> {
  if (!pending) throw new Error('没有待装的更新');
  if (!downloaded) {
    await pending.download();
    downloaded = true;
  }
  await pending.install();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/** 安卓：用系统浏览器打开下载链接（只放行本仓库的 Release 地址） */
export function openDownload(url: string): boolean {
  if (!url.startsWith(`https://github.com/${REPO}/releases/`)) return false;
  const b = (window as unknown as { LinganShare?: { openUrl?: (u: string) => boolean } }).LinganShare;
  if (b?.openUrl) return !!b.openUrl(url);
  window.open(url, '_blank', 'noopener');
  return true;
}
