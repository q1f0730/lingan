import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { db } from '../lib/db';
import { Seg } from './rw/Seg';
import { saveTextFile } from '../lib/files';
import { isTauriEnv } from '../lib/desktop';
import {
  backupRunning,
  currentTarget,
  defaultDesktopDir,
  listBackups,
  readAutoBak,
  RETENTION_LABEL,
  runBackup,
  writeAutoBak,
  type BackupFile,
  type BlobLike,
  type Retention,
} from '../lib/autobackup';
import { deleteSnapshot, getSnapshot, listSnapshots, restoreSnapshot, snapFileName, snapshotToBackupJson, type SnapInfo } from '../lib/snapshots';
import { ftShared } from '../lib/ftsync';

const fmtTime = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);
const KIND_LABEL: Record<BackupFile['kind'], string> = { auto: '自动', manual: '手动', 'pre-update': '更新前' };
const SHOW = 6;

/** v0.26 设置 → 自动备份（0606 0508 0609 0637）：开关、保留策略、位置（Windows 可换文件夹）、立即备份、列表（已验证 / 损坏、恢复） */
export function AutoBackupPanel({ version, onRestore }: { version: string; onRestore: (name: string, file: BlobLike) => void }) {
  const { toast } = useApp();
  const [st, setSt] = useState(() => readAutoBak());
  const [where, setWhere] = useState('');
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [busy, setBusy] = useState('');
  const [all, setAll] = useState(false);
  const desktop = isTauriEnv() && !('LinganBackup' in window);
  const supported = isTauriEnv() || 'LinganBackup' in window;

  const refresh = useCallback(async () => {
    const t = await currentTarget(readAutoBak());
    if (!t) return;
    setWhere(await t.where());
    setFiles(await listBackups(t).catch(() => []));
  }, []);
  useEffect(() => {
    if (supported) void refresh();
  }, [supported, refresh]);

  const save = (patch: Partial<typeof st>) => setSt(writeAutoBak(patch));

  async function now() {
    if (busy || backupRunning()) return;
    setBusy('0%');
    try {
      const r = await runBackup('manual', version, { onProgress: (a, t) => setBusy(`${Math.round((a / Math.max(1, t)) * 100)}%`) });
      setSt(readAutoBak());
      toast(r.verify.ok ? `已备份 ${r.stats.items} 穗 · ${r.stats.images} 张图，回读校验通过` : `备份写完但校验没过：${r.verify.problems[0] || ''}`, r.verify.ok ? 'ok' : 'err');
      (window as unknown as { __gleanAutoBackup?: unknown }).__gleanAutoBackup = r;
      await refresh();
    } catch (e) {
      setSt(readAutoBak());
      toast('备份失败：' + ((e as Error)?.message || e), 'err');
    } finally {
      setBusy('');
    }
  }

  async function pickDir() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, multiple: false, title: '自动备份存到哪个文件夹' });
      if (!dir || Array.isArray(dir)) return;
      save({ dir: String(dir) });
      toast(`之后的自动备份存到 ${dir}`);
      await refresh();
    } catch (e) {
      toast('选文件夹失败：' + ((e as Error)?.message || e), 'err');
    }
  }
  async function resetDir() {
    save({ dir: '' });
    toast(`改回默认：${await defaultDesktopDir()}`);
    await refresh();
  }

  async function restore(f: BackupFile) {
    try {
      const t = await currentTarget(readAutoBak());
      if (!t) return;
      onRestore(f.name, await t.reader(f.name));
    } catch (e) {
      toast('读不出这份备份：' + ((e as Error)?.message || e), 'err');
    }
  }

  const shown = files ? (all ? files : files.slice(0, SHOW)) : [];
  return (
    <section className="set-sec autobak-panel" id="set-autobak">
      <h2 className="sec-title">
        自动备份 {files && <span className="num autobak-count">({files.length})</span>}
      </h2>
      {!supported ? (
        <p className="meta-text autobak-web">网页版没有本机文件夹可写：自动备份只在安卓和 Windows 版里有。网页版请定期在上面「导出备份」，大操作前的快照（下面）照样有。</p>
      ) : (
        <>
          <p className="meta-text">每天第一次打开后，空闲时把整个穗仓（含原图）写成一份 .glean；库没变就不重复写。写完立刻回读核对每个文件的哈希。更新前也会自动备份一份。</p>
          <div className="table action-table">
            <button className="trow cap-switch autobak-on" role="switch" aria-checked={st.on} onClick={() => save({ on: !st.on })}>
              <span className="tc tc-title">每天自动备份</span>
              <span className="tc tc-src">{st.lastAt ? `上次 ${fmtTime(st.lastAt)}` : '还没备份过'}</span>
              <span className="tc tc-date">{st.on ? '开' : '关'}</span>
            </button>
            <button className="trow autobak-now" onClick={now} disabled={!!busy}>
              <span className="tc tc-title">{busy ? `备份中 ${busy}` : '立即备份'}</span>
              <span className="tc tc-src">存到下面的位置，写完自动校验</span>
              <span className="tc tc-date">.glean</span>
            </button>
            {desktop && (
              <button className="trow autobak-dir" onClick={pickDir}>
                <span className="tc tc-title">换文件夹…</span>
                <span className="tc tc-src">可以选坚果云 / OneDrive 的同步文件夹，备份自动上云</span>
                <span className="tc tc-date" />
              </button>
            )}
          </div>
          <dl className="kv">
            <div>
              <dt>位置</dt>
              <dd className="autobak-where">
                {where || '…'}
                {desktop && st.dir && (
                  <button className="btn text autobak-reset" onClick={resetDir}>
                    改回默认
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt>保留</dt>
              <dd>
                <Seg<Retention> id="autobak-policy" className="autobak-policy" role="radiogroup" label="保留哪些" value={st.policy} options={(['gfs', 'last7'] as Retention[]).map((k) => [k, RETENTION_LABEL[k]])} onPick={(v) => save({ policy: v })} />
              </dd>
            </div>
          </dl>
          {st.lastError && <p className="meta-text autobak-error">{st.lastError}</p>}
          {files && files.length > 0 && (
            <div className="table autobak-table">
              {shown.map((f) => {
                const v = st.verified[f.name];
                return (
                  <div key={f.name} className="trow autobak-row" data-name={f.name} data-verified={v || ''}>
                    <span className="tc tc-title">
                      {fmtTime(f.at)} · {KIND_LABEL[f.kind]}
                    </span>
                    <span className="tc tc-src">
                      {fmtSize(f.bytes)}
                      {v === 'ok' ? ' · 已验证' : v === 'bad' ? ' · 损坏' : ''}
                    </span>
                    <span className="tc tc-date">
                      <button className="btn text autobak-restore" onClick={() => restore(f)}>
                        恢复…
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {files && files.length > SHOW && (
            <button className="btn text autobak-more" onClick={() => setAll(!all)}>
              {all ? '收起' : `全部 ${files.length} 份`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** v0.26 设置 → 操作前快照（0621 0624）：大操作前自动拍的，能一键回到那之前；升级前副本能存成文件 */
export function SnapshotPanel({ version }: { version: string }) {
  const { toast, confirm } = useApp();
  const [list, setList] = useState<SnapInfo[] | null>(null);
  const refresh = useCallback(() => void listSnapshots().then(setList, () => setList([])), []);
  useEffect(() => {
    refresh();
    const on = () => refresh();
    window.addEventListener('glean:snap', on);
    return () => window.removeEventListener('glean:snap', on);
  }, [refresh]);

  async function back(s: SnapInfo) {
    const ok = await confirm({
      title: `回到「${s.label}」？`,
      body: `穗仓会回到 ${fmtTime(s.at)} 那一刻：${s.counts.items} 穗、${s.counts.developments} 根新枝。之后新收的会不见——放心，恢复前会先给现在拍一张快照，随时可以再回来。`,
      ok: '回到那之前',
      cancel: '算了',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await restoreSnapshot(s.id!, db, { appVersion: version });
      void ftShared(db).reconcile();
      toast(`已回到「${s.label}」：${r.items} 穗 · ${r.developments} 新枝`);
      refresh();
    } catch (e) {
      toast('恢复失败：' + ((e as Error)?.message || e), 'err');
    }
  }
  async function saveFile(s: SnapInfo) {
    const full = await getSnapshot(s.id!);
    if (!full) return;
    const where = await saveTextFile(snapFileName(full), snapshotToBackupJson(full));
    if (where) toast(`已存成 ${where}，用「导入备份」就能恢复`);
  }
  async function drop(s: SnapInfo) {
    await deleteSnapshot(s.id!);
    refresh();
  }

  return (
    <section className="set-sec snap-panel" id="set-snap">
      <h2 className="sec-title">
        操作前快照 {list && <span className="num snap-count">({list.length})</span>}
      </h2>
      <p className="meta-text">导入、清示例、清空、批量删、彻底删之前自动拍一张（只存在本机，留最近 10 张）；装了新版、数据库要升级前也会先存一份原样副本（留 3 份）。</p>
      {list && list.length > 0 ? (
        <div className="table snap-table">
          {list.map((s) => (
            <div key={s.id} className="trow snap-row" data-kind={s.kind}>
              <span className="tc tc-title">{s.label}</span>
              <span className="tc tc-src">
                {fmtTime(s.at)} · {s.counts.items} 穗 · {s.counts.developments} 新枝
              </span>
              <span className="tc tc-date">
                {s.kind === 'op' ? (
                  <button className="btn text snap-back" onClick={() => back(s)}>
                    回到这之前
                  </button>
                ) : (
                  <button className="btn text snap-save" onClick={() => saveFile(s)}>
                    存成文件
                  </button>
                )}
                <button className="btn text snap-drop" aria-label="删掉这张快照" onClick={() => drop(s)}>
                  删
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="meta-text snap-empty">还没有快照。</p>
      )}
    </section>
  );
}
