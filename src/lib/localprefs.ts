// v0.31（v0.30 遗留）：只存在本机 localStorage 的三样东西也进 .glean 备份 / 导入 / 操作快照：
//   口味原子（glean.taste.atoms）、自写斜策略卡（glean.oblique.mine）、出站记录（glean.outbound.log）。
// .glean 里是一行 {"t":"local", atoms, cards, outbound}；旧版读到会计入「x 行读不出，已跳过」，不影响导入。
// 合并规则：原子按文字认（本机的为准，备份里本机没有的补进来，自己改过 / 加的 mine 优先）；卡取并集；出站记录按
// 时间 + 域名 + 种类去重后按时间排，各自的上限照旧（20 / 40 / 400）。替换 = 备份为准。
// 这里直接读写那几个键，不 import 各自的模块（atoms 依赖 ai.ts，不想把它带进备份 / 快照的包）。

export const LOCAL_KEYS = { atoms: 'glean.taste.atoms', cards: 'glean.oblique.mine', outbound: 'glean.outbound.log' } as const;
const MAX = { atoms: 20, cards: 40, outbound: 400 };

export interface AtomLite {
  atom: string;
  uids: string[];
  weight: number;
  mine?: 1;
}
export interface LocalPrefs {
  atoms: { at: number; source: string; atoms: AtomLite[] } | null;
  cards: string[];
  outbound: Array<{ at: number; host: string; kind: string; fields: string[]; bytes: number; ok: boolean; stripped?: number }>;
}

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function readLocalPrefs(): LocalPrefs {
  const atoms = read<LocalPrefs['atoms']>(LOCAL_KEYS.atoms, null);
  const cards = read<unknown>(LOCAL_KEYS.cards, []);
  const out = read<unknown>(LOCAL_KEYS.outbound, []);
  return {
    atoms: atoms && Array.isArray(atoms.atoms) ? atoms : null,
    cards: Array.isArray(cards) ? cards.filter((x): x is string => typeof x === 'string') : [],
    outbound: Array.isArray(out) ? (out as LocalPrefs['outbound']).filter((r) => r && typeof r.at === 'number' && typeof r.host === 'string') : [],
  };
}
export function isEmptyPrefs(p: LocalPrefs): boolean {
  return !p.atoms?.atoms.length && !p.cards.length && !p.outbound.length;
}

/** 从备份行里认出一份（字段不对的丢掉） */
export function cleanPrefs(o: unknown): LocalPrefs {
  const x = (o || {}) as Partial<LocalPrefs>;
  const atoms =
    x.atoms && Array.isArray(x.atoms.atoms)
      ? { at: Number(x.atoms.at) || 0, source: x.atoms.source === 'ai' ? 'ai' : 'offline', atoms: x.atoms.atoms.filter((a) => a && typeof a.atom === 'string' && a.atom).map((a) => ({ atom: a.atom.slice(0, 8), uids: Array.isArray(a.uids) ? a.uids.filter((u) => typeof u === 'string') : [], weight: Math.min(5, Math.max(1, Number(a.weight) || 1)), ...(a.mine ? { mine: 1 as const } : {}) })) }
      : null;
  const cards = Array.isArray(x.cards) ? x.cards.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.slice(0, 40)) : [];
  const outbound = Array.isArray(x.outbound) ? x.outbound.filter((r) => r && typeof r.at === 'number' && typeof r.host === 'string' && typeof r.kind === 'string').map((r) => ({ at: r.at, host: r.host, kind: r.kind, fields: Array.isArray(r.fields) ? r.fields.filter((f) => typeof f === 'string') : [], bytes: Number(r.bytes) || 0, ok: !!r.ok, ...(r.stripped ? { stripped: Number(r.stripped) } : {}) })) : [];
  return { atoms, cards, outbound };
}

export function mergePrefs(local: LocalPrefs, inc: LocalPrefs, mode: 'merge' | 'missing' | 'replace'): LocalPrefs {
  if (mode === 'replace') return { atoms: inc.atoms, cards: inc.cards.slice(0, MAX.cards), outbound: inc.outbound.slice(-MAX.outbound) };
  let atoms = local.atoms;
  if (inc.atoms?.atoms.length) {
    if (!atoms?.atoms.length) atoms = inc.atoms;
    else {
      const have = new Set(atoms.atoms.map((a) => a.atom));
      const extra = inc.atoms.atoms.filter((a) => !have.has(a.atom));
      const all = [...atoms.atoms, ...extra].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
      atoms = { ...atoms, atoms: all.slice(0, MAX.atoms) };
    }
  }
  const cards = [...local.cards, ...inc.cards.filter((c) => !local.cards.includes(c))].slice(0, MAX.cards);
  const seen = new Set<string>();
  const outbound = [...local.outbound, ...inc.outbound]
    .filter((r) => {
      const k = `${r.at}|${r.host}|${r.kind}`;
      return !seen.has(k) && (seen.add(k), true);
    })
    .sort((a, b) => a.at - b.at)
    .slice(-MAX.outbound);
  return { atoms, cards, outbound };
}

export function writeLocalPrefs(p: LocalPrefs): void {
  try {
    if (p.atoms?.atoms.length) localStorage.setItem(LOCAL_KEYS.atoms, JSON.stringify(p.atoms));
    else localStorage.removeItem(LOCAL_KEYS.atoms);
    if (p.cards.length) localStorage.setItem(LOCAL_KEYS.cards, JSON.stringify(p.cards));
    else localStorage.removeItem(LOCAL_KEYS.cards);
    if (p.outbound.length) localStorage.setItem(LOCAL_KEYS.outbound, JSON.stringify(p.outbound));
    else localStorage.removeItem(LOCAL_KEYS.outbound);
  } catch {
    /* 隐私模式 / 满了 */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('glean:atoms'));
    window.dispatchEvent(new Event('glean:outbound'));
    window.dispatchEvent(new Event('glean:cards'));
  }
}
