// v0.32 设置目录里「同步 · 网盘 / 局域网直连 / 设备与记录」三行的摘要：只读 localStorage，不加载同步引擎。
// （从组件文件里拆出来：组件文件只导出组件，热更新才靠得住）
interface Last {
  ok: boolean;
  msg: string;
  at: number;
}
export interface LanCfg {
  role: 'host' | 'peer';
  name: string;
  hosts: string[];
  port: number;
  auto: boolean;
  lastAt?: number;
  last?: Last;
}
const read = <T,>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') as T | null;
  } catch {
    return null;
  }
};
export function readLan(): LanCfg | null {
  const v = read<LanCfg>('glean.lan.v1');
  return v && v.role ? v : null;
}
export function lanSummary(): string {
  const c = readLan();
  if (!c) return '关';
  if (c.last && !c.last.ok) return '上次失败';
  return c.role === 'host' ? '这台是电脑' : `连 ${c.name}`;
}
export const hm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export function syncStateSummary(): string {
  const lasts = ['glean.sync.v1', 'glean.lan.v1'].map((k) => read<{ last?: Last }>(k)).filter(Boolean);
  if (!lasts.length) return '关';
  const last = lasts.map((c) => c!.last).filter((x): x is Last => !!x).sort((a, b) => b.at - a.at)[0];
  return last ? (last.ok ? `最近 ${hm(last.at)}` : '上次失败') : '—';
}
