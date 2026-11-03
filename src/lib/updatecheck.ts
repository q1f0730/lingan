// v0.25 启动后（空闲时）的自动检查：每天最多一次；结果共享给设置 → 更新
import { checkForUpdate, dueForCheck, installAndRestart, openDownload, readUpdatePrefs, updatePlatform, writeUpdatePrefs, type CheckResult } from './update';

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

export async function autoCheck(version: string, toast: Toast, now = Date.now()): Promise<CheckResult | null> {
  const plat = updatePlatform();
  if (plat === 'web') return null;
  const p = readUpdatePrefs();
  if (!dueForCheck(p, now)) return null;
  writeUpdatePrefs({ ...p, lastCheck: now });
  const r = await checkForUpdate(version, { download: plat === 'windows' });
  set(r);
  if (r.kind === 'desktop' && r.ready)
    toast(`新版 v${r.version} 已下载好`, 'ok', {
      label: '重启更新',
      run: () => void installAndRestart().catch((e) => toast(`更新失败：${(e as Error)?.message || e}`, 'err')),
    });
  else if (r.kind === 'android') toast(`拾穗有新版 v${r.latest.version}`, 'ok', { label: '下载', run: () => void openDownload(r.latest.apkUrl) });
  return r;
}
