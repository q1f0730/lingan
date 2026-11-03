// v0.25 启动后（空闲时）的自动检查：每天最多一次；结果共享给设置 → 更新
import { checkForUpdate, dueForCheck, installAndRestart, installAndroidUpdate, readUpdatePrefs, updatePlatform, writeUpdatePrefs, type ApkStep, type CheckResult, type Latest } from './update';
import { outboundOff } from './gate';

let state: CheckResult | null = null;
const subs = new Set<(r: CheckResult | null) => void>();
export const updateState = () => state;
export function onUpdateState(fn: (r: CheckResult | null) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
function set(r: CheckResult) {
  state = r;
  for (const f of subs) f(r);
}

type Toast = (msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }) => void;
type Ask = (title: string, body: string) => Promise<boolean>;

/** 0513 0750：装更新之前先写一份完整备份。成功 / 网页版 → true；失败时有 ask 就问用户要不要照样更新，没有就提示并返回 false */
export async function backupGate(toVersion: string, appVersion: string, toast: Toast, ask?: Ask, onFailContinue?: () => void): Promise<boolean> {
  toast('更新前先备份一份…');
  const { backupBeforeUpdate } = await import('./autobackup');
  const r = await backupBeforeUpdate(toVersion, appVersion);
  if (r.ok) {
    if (r.where) toast(`已备份到 ${r.where}`);
    return true;
  }
  const body = `${r.error}。仍然更新吗？穗在本机数据库里，正常升级不会动它们；新版打开时还会再存一份升级前的副本。`;
  if (ask) return ask('更新前的备份没成功', body);
  toast(`更新前备份失败：${r.error}`, 'err', onFailContinue ? { label: '仍然更新', run: onFailContinue } : undefined);
  return false;
}

/** Windows：备份 → 装 → 重启 */
export async function desktopInstall(toVersion: string, appVersion: string, toast: Toast, ask?: Ask): Promise<void> {
  const go = () => void installAndRestart().catch((e) => toast(`更新失败：${(e as Error)?.message || e}`, 'err'));
  if (!(await backupGate(toVersion, appVersion, toast, ask, go))) return;
  await installAndRestart();
}

/** 安卓：下载（校验哈希 + 签名）→ 备份 → 系统安装器 */
export async function androidInstall(l: Latest, appVersion: string, toast: Toast, ask?: Ask, onStep?: (s: ApkStep) => void): Promise<void> {
  const r = await installAndroidUpdate(l, {
    onStep,
    beforeInstall: () => backupGate(l.version, appVersion, toast, ask),
  });
  if (r === 'need-permission') toast('先允许拾穗「安装未知应用」，回来再点一次「安装」', 'err');
  else if (r === 'browser') toast('已用浏览器打开下载，下完点开安装');
  else if (r === 'installing') toast('系统安装界面已打开：点「更新」即可，穗都还在');
}

export async function autoCheck(version: string, toast: Toast, now = Date.now()): Promise<CheckResult | null> {
  const plat = updatePlatform();
  if (plat === 'web' || outboundOff()) return null;
  const p = readUpdatePrefs();
  if (!dueForCheck(p, now)) return null;
  writeUpdatePrefs({ ...p, lastCheck: now });
  const r = await checkForUpdate(version, { download: plat === 'windows' });
  set(r);
  if (r.kind === 'desktop' && r.ready)
    toast(`新版 v${r.version} 已下载好`, 'ok', {
      label: '重启更新',
      run: () => void desktopInstall(r.version, version, toast).catch((e) => toast(`更新失败：${(e as Error)?.message || e}`, 'err')),
    });
  else if (r.kind === 'android') toast(`拾穗有新版 v${r.latest.version}`, 'ok', { label: '下载并安装', run: () => void androidInstall(r.latest, version, toast).catch((e) => toast(`更新失败：${(e as Error)?.message || e}`, 'err')) });
  return r;
}
