import { memo, useEffect, useState } from 'react';
import { backupText, BACKUP_DAYS, lastBackupAt, mb, nudgeState, setNudge, storageInfo, STORAGE_WARN, type StorageInfo } from '../lib/nudge';

const DAY = 864e5;
const ago = (at: number, now = Date.now()) => (!at ? '还没备份过' : now - at < DAY ? '今天' : `${Math.floor((now - at) / DAY)} 天前`);

/** v0.43 0631 存储用量 + 0639 上次备份（设置 → 备份与导入）。不带 props、memo：导出进度变化时不重画（v0.26 堆增长教训） */
export const StoreHealth = memo(function StoreHealth() {
  const [info, setInfo] = useState<StorageInfo | null | undefined>(undefined);
  const [last, setLast] = useState(lastBackupAt);
  const [off, setOff] = useState(() => !!nudgeState().off);
  useEffect(() => {
    let alive = true;
    void storageInfo().then((i) => alive && setInfo(i));
    const on = () => setLast(lastBackupAt());
    window.addEventListener('glean:backed', on);
    return () => {
      alive = false;
      window.removeEventListener('glean:backed', on);
    };
  }, []);
  async function persist() {
    const ok = await navigator.storage?.persist?.().catch(() => false);
    setInfo(await storageInfo());
    if (!ok) window.dispatchEvent(new CustomEvent('glean:say', { detail: { msg: '浏览器没答应持久保存：空间紧张时它可能清掉本站数据，记得常导出备份', label: '知道了', go: '' } }));
  }
  const old = !last.at || Date.now() - last.at > BACKUP_DAYS * DAY;
  return (
    <>
      <dl className="kv store-health">
        <div>
          <dt>上次备份</dt>
          <dd className={`num last-backup${old ? ' warn' : ''}`}>
            {ago(last.at)}
            {last.kind ? ` · ${last.kind}` : ''}
          </dd>
        </div>
        <div>
          <dt>占用</dt>
          <dd className={`num store-use${info && info.pct >= STORAGE_WARN ? ' warn' : ''}`}>
            {info === undefined ? '…' : !info ? '这个浏览器不告诉用量' : `${mb(info.usage)} / ${mb(info.quota)}（${Math.round(info.pct * 1000) / 10}%）`}
            {info?.persisted === false && (
              <button className="btn text store-persist" onClick={persist}>
                申请持久保存
              </button>
            )}
          </dd>
        </div>
      </dl>
      {info && info.pct >= STORAGE_WARN && <p className="meta-text store-warn">快满了：先导出一份备份，再清回收站、或在「极速采集」里打开「收图时缩到长边 4096」。</p>}
      <div className="table action-table">
        <button className="trow cap-switch nudge-bk" role="switch" aria-checked={!off} onClick={() => (setNudge({ off: off ? undefined : 1 }), setOff(!off))}>
          <span className="tc tc-title">隔久了提醒我备份</span>
          <span className="tc tc-src">{`超过 ${BACKUP_DAYS} 天没备份时，打开后提一句（7 天内只提一次）`}{old && !off ? ` · 现在：${backupText(last.at ? Math.floor((Date.now() - last.at) / DAY) : -1)}` : ''}</span>
          <span className="tc tc-date">{off ? '关' : '开'}</span>
        </button>
      </div>
    </>
  );
});
