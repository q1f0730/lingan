// v0.25 0838 Agent 访问审计：每次本地 API / MCP 调用记一行（谁、哪个工具、返回几穗、成没成），只存本机，最多 300 条。
// 不记查询词和穗的内容。

export interface AuditRow {
  t: number;
  client: string;
  tool: string;
  /** 返回了几穗（list_branches 算用到的穗） */
  n: number;
  ok: boolean;
}
export const AUDIT_KEY = 'glean.apiaudit.v1';
export const AUDIT_MAX = 300;

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readAudit(s: Storage | null = store()): AuditRow[] {
  try {
    const a = JSON.parse(s?.getItem(AUDIT_KEY) || '[]');
    return Array.isArray(a) ? a.filter((r) => r && typeof r.t === 'number') : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
export function onAudit(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recordAudit(r: AuditRow, s: Storage | null = store()) {
  const row: AuditRow = { t: r.t, client: String(r.client || '未知客户端').slice(0, 60), tool: String(r.tool).slice(0, 40), n: Math.max(0, r.n | 0), ok: !!r.ok };
  const all = readAudit(s);
  all.push(row);
  try {
    s?.setItem(AUDIT_KEY, JSON.stringify(all.slice(-AUDIT_MAX)));
  } catch {
    /* 存储满：丢掉这一条 */
  }
  for (const f of listeners) f();
}

export function clearAudit(s: Storage | null = store()) {
  try {
    s?.removeItem(AUDIT_KEY);
  } catch {
    /* ignore */
  }
  for (const f of listeners) f();
}

/** 本周（近 7 天）按客户端汇总：调用次数、看过几穗、最后一次 */
export function weekSummary(rows: AuditRow[], now = Date.now()): Array<{ client: string; calls: number; items: number; writes: number; last: number }> {
  const from = now - 7 * 86400000;
  const m = new Map<string, { client: string; calls: number; items: number; writes: number; last: number }>();
  for (const r of rows) {
    if (r.t < from) continue;
    const e = m.get(r.client) || { client: r.client, calls: 0, items: 0, writes: 0, last: 0 };
    e.calls++;
    e.items += r.n;
    if (r.tool === 'add_item' && r.ok) e.writes++;
    e.last = Math.max(e.last, r.t);
    m.set(r.client, e);
  }
  return [...m.values()].sort((a, b) => b.last - a.last);
}
