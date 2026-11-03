// v0.25 自动更新（0511 0751）
// - Windows：tauri-plugin-updater 读 GitHub Releases 的 latest.json（CI 用私钥签名，公钥在 tauri.conf.json），
//   后台下载好再提示「重启更新」。
// - 安卓：读同一份 latest.json 比版本号，有新版就提示。v0.26（0512 0732）起在 App 里下载 APK（原生 LinganUpdate 桥，
//   边下边算 SHA-256，必须和 Release 里 SHA256SUMS.txt 一致，签名证书必须和当前装的拾穗一致），再交给系统安装器；
//   没有桥的老壳退回用浏览器下载。
// - 0513 0750：装之前先自动备份（autobackup.backupBeforeUpdate），失败要用户点头才继续。
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

// ───────── v0.26 安卓应用内下载 + 安装（0512 0732）─────────

export function sumsUrl(v: string) {
  const x = v.replace(/^v/i, '');
  return `https://github.com/${REPO}/releases/download/v${x}/SHA256SUMS.txt`;
}
/** SHA256SUMS.txt（sha256sum 格式）里找某个文件的哈希 */
export function parseSums(text: string, file: string): string | null {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === file) return m[1].toLowerCase();
  }
  return null;
}
export function apkName(v: string) {
  const x = v.replace(/^v/i, '');
  return `Glean_${x}_android.apk`;
}

interface UpdateBridge {
  download(url: string, sha256: string, version: string): boolean;
  progress(): string;
  install(): string;
  canInstall(): boolean;
}
export function androidUpdater(): UpdateBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { LinganUpdate?: UpdateBridge }).LinganUpdate;
  return b && typeof b.download === 'function' ? b : null;
}
export interface ApkProgress {
  state: 'idle' | 'downloading' | 'ready' | 'error';
  done: number;
  total: number;
  error: string;
}
export type ApkStep = { step: 'sums' } | { step: 'download'; done: number; total: number } | { step: 'backup' } | { step: 'install' };

async function fetchSha(v: string): Promise<string> {
  const { fetch } = await import('@tauri-apps/plugin-http');
  const r = await fetch(sumsUrl(v), { method: 'GET' });
  if (!r.ok) throw new Error(r.status === 404 ? '新版还在发布中（校验文件没出来），过几分钟再试' : `取校验文件失败 HTTP ${r.status}`);
  const sha = parseSums(await r.text(), apkName(v));
  if (!sha) throw new Error('校验文件里没有安卓安装包');
  return sha;
}

/**
 * 下载 → 校验 → 更新前备份 → 调起系统安装器。返回 'installing'（系统安装界面已打开）、'need-permission'（先去允许「安装未知应用」，
 * 回来再点一次）或 'browser'（老壳没有桥，改用浏览器下载）。
 */
export async function installAndroidUpdate(l: Latest, opts: { onStep?: (s: ApkStep) => void; beforeInstall?: () => Promise<boolean>; poll?: number } = {}): Promise<'installing' | 'need-permission' | 'browser' | 'cancelled'> {
  const b = androidUpdater();
  if (!b) {
    openDownload(l.apkUrl);
    return 'browser';
  }
  let p = JSON.parse(b.progress() || '{}') as ApkProgress;
  if (p.state !== 'ready') {
    opts.onStep?.({ step: 'sums' });
    const sha = await fetchSha(l.version);
    if (!b.download(l.apkUrl, sha, l.version)) throw new Error('下载没能开始');
    for (;;) {
      await new Promise((r) => setTimeout(r, opts.poll ?? 400));
      p = JSON.parse(b.progress() || '{}') as ApkProgress;
      if (p.state === 'downloading') opts.onStep?.({ step: 'download', done: p.done, total: p.total });
      else break;
    }
    if (p.state !== 'ready') throw new Error(p.error || '下载失败');
  }
  if (opts.beforeInstall) {
    opts.onStep?.({ step: 'backup' });
    if (!(await opts.beforeInstall())) return 'cancelled';
  }
  opts.onStep?.({ step: 'install' });
  const r = b.install();
  if (r === 'need-permission') return 'need-permission';
  if (r !== 'ok') throw new Error(r === 'no-file' ? '安装包不在了，请重新下载' : `打不开系统安装器（${r}）`);
  return 'installing';
}
