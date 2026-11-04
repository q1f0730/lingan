// v0.43 0639「上次备份 n 天前」提醒 + 0631 存储用量（超 80% 预警）。
// main.tsx 启动 18 秒后空闲时才加载，而且一天最多看一次（glean.nudge.next）；提醒走 App 的 glean:say 事件（一条提示 + 「去看看」）。
// 只读 localStorage 和 navigator.storage，不碰主库（条数 / 最早一穗由调用方给，或用设置页已经算好的）。

export const LASTEXP_KEY = 'glean.lastexp';
export const NUDGE_KEY = 'glean.nudge';
export const NEXT_KEY = 'glean.nudge.next';
const DAY = 864e5;
export const BACKUP_DAYS = 14;
export const STORAGE_WARN = 0.8;

interface NudgeState {
  /** 上次提醒备份 / 存储的时间 */
  bk?: number;
  st?: number;
  /** 不提醒备份 */
  off?: 1;
}
const read = <T,>(k: string, d: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) || 'null') as T) ?? d;
  } catch {
    return d;
  }
};
export const nudgeState = (): NudgeState => read<NudgeState>(NUDGE_KEY, {});
export const setNudge = (p: Partial<NudgeState>) => localStorage.setItem(NUDGE_KEY, JSON.stringify({ ...nudgeState(), ...p }));

/** 最近一次真的有备份的时间：手动导出 .glean / 自动备份（开着、上次没出错时，lastAt = 写过或确认库没变） */
export function lastBackupAt(): { at: number; kind: '' | '手动导出' | '自动备份' } {
  const man = +(localStorage.getItem(LASTEXP_KEY) || 0) || 0;
  const ab = read<{ on?: boolean; lastAt?: number; lastError?: string }>('glean.autobak.v1', {});
  const auto = ab.on !== false && !ab.lastError ? Number(ab.lastAt) || 0 : 0;
  return auto > man ? { at: auto, kind: '自动备份' } : { at: man, kind: man ? '手动导出' : '' };
}

/** 该不该提醒备份：穗 ≥20、最早一穗也超过 14 天，且上次备份超过 14 天（或从没备份过）；提醒过 7 天内不再提 */
export function backupDue(now: number, last: number, items: number, oldest: number, st: NudgeState = {}): number | null {
  if (st.off || items < 20 || now - oldest < BACKUP_DAYS * DAY) return null;
  if (last && now - last < BACKUP_DAYS * DAY) return null;
  if (st.bk && now - st.bk < 7 * DAY) return null;
  return last ? Math.floor((now - last) / DAY) : -1;
}
export const backupText = (days: number | null) => (days == null ? '' : days < 0 ? '还没备份过' : `上次备份是 ${days} 天前`);

export interface StorageInfo {
  usage: number;
  quota: number;
  pct: number;
  persisted: boolean | null;
}
export async function storageInfo(): Promise<StorageInfo | null> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.estimate) return null;
  try {
    const e = await s.estimate();
    const usage = e.usage || 0;
    const quota = e.quota || 0;
    return { usage, quota, pct: quota ? usage / quota : 0, persisted: s.persisted ? await s.persisted() : null };
  } catch {
    return null;
  }
}
export const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);

declare global {
  interface Window {
    __gleanNudge?: string[];
  }
}

/** 启动后看一眼：要提醒就发 glean:say；返回发了哪些（e2e 看 window.__gleanNudge） */
export async function nudgeTick(count: () => Promise<{ items: number; oldest: number }>, now = Date.now()): Promise<string[]> {
  localStorage.setItem(NEXT_KEY, String(now + DAY));
  const said: string[] = [];
  const say = (msg: string, label: string) => {
    said.push(msg);
    window.dispatchEvent(new CustomEvent('glean:say', { detail: { msg, label, go: 'glean://go/settings' } }));
  };
  const st = nudgeState();
  const info = await storageInfo();
  if (info && info.pct >= STORAGE_WARN && (!st.st || now - st.st > 3 * DAY)) {
    setNudge({ st: now });
    say(`存储快满了：已用 ${Math.round(info.pct * 100)}%（${mb(info.usage)} / ${mb(info.quota)}）`, '去看看');
  }
  const c = await count();
  const d = backupDue(now, lastBackupAt().at, c.items, c.oldest, st);
  if (d != null) {
    setNudge({ bk: now });
    say(`${backupText(d)}：导出一份 .glean 放到别处更安心`, '去备份');
  }
  window.__gleanNudge = said;
  return said;
}
