// v0.32 0660 穗仓大标题旁的小字「已同步 10:21」；上次失败时变成黑条并写原因（点一下去设置看）。
// 首屏组件：只读 localStorage，不加载同步引擎。
import { useEffect, useState } from 'react';

interface Last {
  ok: boolean;
  msg: string;
  at: number;
}
function latest(): Last | null {
  let best: Last | null = null;
  for (const k of ['glean.sync.v1', 'glean.lan.v1']) {
    try {
      const l = (JSON.parse(localStorage.getItem(k) || 'null') as { last?: Last } | null)?.last;
      if (l && (!best || l.at > best.at)) best = l;
    } catch {
      /* ignore */
    }
  }
  return best;
}

const snap = () => ({ last: latest(), today: new Date().toDateString() });

export function SyncBadge({ onOpen }: { onOpen?: () => void }) {
  const [{ last, today }, setS] = useState(snap);
  useEffect(() => {
    const on = () => setS(snap());
    window.addEventListener('glean:sync', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('glean:sync', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  if (!last) return null;
  const d = new Date(last.at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = today === d.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  if (last.ok)
    return (
      <span className="title-note sync-badge" title="上次同步时间">
        已同步 {day}
      </span>
    );
  return (
    <button className="sync-badge err" onClick={onOpen} title={last.msg}>
      同步失败：{last.msg.length > 40 ? last.msg.slice(0, 40) + '…' : last.msg}
    </button>
  );
}
