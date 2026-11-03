import { useEffect, useState } from 'react';
import { androidUpdater, checkForUpdate, LATEST_JSON, readUpdatePrefs, RELEASES, updatePlatform, writeUpdatePrefs, type ApkStep, type CheckResult } from '../lib/update';
import { androidInstall, desktopInstall, onUpdateState, updateState } from '../lib/updatecheck';
import { useApp } from '../lib/store';

/** v0.25 设置 → 更新（0511 0751）：自动检查开关、手动检查、Windows 下载好后重启更新、安卓去下载新 APK */
export function UpdatePanel({ version }: { version: string }) {
  const { toast, confirm } = useApp();
  const plat = updatePlatform();
  const [prefs, setPrefs] = useState(() => readUpdatePrefs());
  const [res, setRes] = useState<CheckResult | null>(() => updateState());
  const [busy, setBusy] = useState<'' | 'check' | 'install'>('');
  const [step, setStep] = useState('');
  const ask = (title: string, body: string) => confirm({ title, body, ok: '仍然更新', cancel: '先不更新', danger: true });
  useEffect(() => onUpdateState(setRes), []);

  async function check() {
    if (busy) return;
    setBusy('check');
    const r = await checkForUpdate(version, { download: plat === 'windows' });
    writeUpdatePrefs({ ...readUpdatePrefs(), lastCheck: Date.now() });
    setPrefs(readUpdatePrefs());
    setRes(r);
    setBusy('');
    if (r.kind === 'none') toast(`已是最新（v${version}）`);
    else if (r.kind === 'error') toast(`检查失败：${r.message}`, 'err');
  }

  async function install() {
    if (res?.kind !== 'desktop' || busy) return;
    const yes = await confirm({ title: `更新到 v${res.version}？`, body: '先自动备份一份完整的 .glean 到备份文件夹，然后拾穗会关掉、装好新版后自动重新打开，大约半分钟。', ok: '备份并重启更新', cancel: '稍后' });
    if (!yes) return;
    setBusy('install');
    try {
      await desktopInstall(res.version, version, toast, ask);
    } catch (e) {
      toast(`更新失败：${(e as Error)?.message || e}`, 'err');
    } finally {
      setBusy('');
    }
  }

  // v0.26 0512：安卓应用内下载 → 校验 → 备份 → 系统安装器
  async function installApk() {
    if (res?.kind !== 'android' || busy) return;
    setBusy('install');
    const show = (s: ApkStep) =>
      setStep(s.step === 'sums' ? '取校验文件…' : s.step === 'download' ? `下载中 ${s.total ? Math.round((s.done / s.total) * 100) + '%' : `${(s.done / 1048576).toFixed(1)}MB`}` : s.step === 'backup' ? '更新前备份…' : '打开系统安装器…');
    try {
      await androidInstall(res.latest, version, toast, ask, show);
    } catch (e) {
      toast(`更新失败：${(e as Error)?.message || e}`, 'err');
    } finally {
      setBusy('');
      setStep('');
    }
  }

  function toggleAuto() {
    const next = { ...prefs, auto: !prefs.auto };
    writeUpdatePrefs(next);
    setPrefs(next);
    toast(next.auto ? '每天最多自动查一次新版' : '不再自动检查，需要时手动点「检查更新」');
  }

  const last = prefs.lastCheck ? new Date(prefs.lastCheck).toLocaleString('zh-CN', { hour12: false }) : '还没查过';
  return (
    <section className="set-sec update-panel" id="set-update">
      <h2 className="sec-title">更新</h2>
      <p className="meta-text">
        {plat === 'web'
          ? '网页版刷新就是最新；安卓和 Windows 版在这里检查新版。'
          : plat === 'android'
            ? '有新版时提示你，在 App 里下载安装包（核对 SHA-256 和签名证书），先自动备份一份，再交给系统安装器覆盖安装。'
            : '有新版时后台下载好（安装包经签名校验），装之前先自动备份一份，再重启更新。'}
        只读取一个公开的静态文件，不带任何设备信息。
      </p>
      <div className="table action-table">
        <button className="trow cap-switch update-auto" role="switch" aria-checked={prefs.auto} onClick={toggleAuto} disabled={plat === 'web'}>
          <span className="tc tc-title">自动检查更新</span>
          <span className="tc tc-src">每天最多一次 · 上次 {last}</span>
          <span className="tc tc-date">{prefs.auto ? '开' : '关'}</span>
        </button>
        <button className="trow update-check" onClick={check} disabled={plat === 'web' || !!busy}>
          <span className="tc tc-title">{busy === 'check' ? '检查中…' : '检查更新'}</span>
          <span className="tc tc-src">当前 v{version}</span>
          <span className="tc tc-date" />
        </button>
        {res?.kind === 'desktop' && (
          <button className="trow update-install" onClick={install} disabled={!!busy}>
            <span className="tc tc-title">{busy === 'install' ? '正在更新…' : `重启更新到 v${res.version}`}</span>
            <span className="tc tc-src">{res.ready ? '已下载好' : '点了先下载再装'}</span>
            <span className="tc tc-date" />
          </button>
        )}
        {res?.kind === 'android' && (
          <button className="trow update-download" onClick={installApk} disabled={!!busy}>
            <span className="tc tc-title">{busy === 'install' ? step || '处理中…' : `下载并安装 v${res.latest.version}`}</span>
            <span className="tc tc-src">{androidUpdater() ? '校验通过、备份好之后打开系统安装器' : '用浏览器下载安装包，下完点开安装'}</span>
            <span className="tc tc-date" />
          </button>
        )}
      </div>
      {(res?.kind === 'desktop' || res?.kind === 'android') && (res.kind === 'desktop' ? res.notes : res.latest.notes) && (
        <div className="update-notes">
          <p className="meta-text update-notes-k">这版新了什么</p>
          <p className="meta-text update-notes-body">{res.kind === 'desktop' ? res.notes : res.latest.notes}</p>
        </div>
      )}
      <dl className="kv">
        <div>
          <dt>更新源</dt>
          <dd className="update-src">{LATEST_JSON.replace('https://', '')}</dd>
        </div>
        <div>
          <dt>所有版本</dt>
          <dd>
            <a href={RELEASES} target="_blank" rel="noreferrer">
              github.com/q1f0730/lingan/releases
            </a>
          </dd>
        </div>
      </dl>
    </section>
  );
}
