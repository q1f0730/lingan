// v0.30 0205 口味原子：从「为什么」里抽 ≤20 个「我在意的东西」（手写感、留白、低保真…），可删可改，嫁接 prompt 带 top8。
// 0244 口味导出卡：原子 + 代表作，复制成一段能贴进任何 AI 的提示词（不含私密穗）。
// 存 localStorage（和 AI 口味侧写一样是派生数据，随时能重抽）；原子引用穗的 uid。
import { AIError, chat, parseJSONLoose } from './ai';
import { checkRefs } from './provenance';
import type { Settings } from './settings';
import type { Item } from './types';

export interface TasteAtom {
  atom: string;
  /** 依据的穗（uid） */
  uids: string[];
  /** 1–5 */
  weight: number;
  /** 自己改过 / 加的 */
  mine?: 1;
}
export interface AtomStore {
  at: number;
  source: 'ai' | 'offline';
  atoms: TasteAtom[];
}

const KEY = 'glean.taste.atoms';
export const MAX_ATOMS = 20;

export function loadAtoms(): AtomStore | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && Array.isArray(v.atoms) ? v : null;
  } catch {
    return null;
  }
}
export function saveAtoms(st: AtomStore | null): void {
  try {
    if (st) localStorage.setItem(KEY, JSON.stringify({ ...st, atoms: st.atoms.slice(0, MAX_ATOMS) }));
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event('glean:atoms'));
  } catch {
    /* 隐私模式 */
  }
}
export function cleanAtom(s: string): string {
  return (s || '').replace(/[\s「」『』"“”'‘’。，,.!！?？、:：;；#]+/g, '').slice(0, 8);
}
/** 嫁接 prompt 用：按权重取前 n 个 */
export function topAtoms(st: AtomStore | null = loadAtoms(), n = 8): string[] {
  if (!st) return [];
  return [...st.atoms]
    .sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.weight - a.weight || b.uids.length - a.uids.length)
    .slice(0, n)
    .map((a) => a.atom);
}
export function editAtom(st: AtomStore, i: number, text: string): AtomStore {
  const t = cleanAtom(text);
  const atoms = st.atoms.map((a, j) => (j === i ? { ...a, atom: t || a.atom, mine: 1 as const } : a));
  return { ...st, atoms: dedupe(atoms) };
}
export function removeAtom(st: AtomStore, i: number): AtomStore {
  return { ...st, atoms: st.atoms.filter((_, j) => j !== i) };
}
export function addAtom(st: AtomStore | null, text: string): AtomStore {
  const t = cleanAtom(text);
  const base: AtomStore = st || { at: Date.now(), source: 'offline', atoms: [] };
  if (!t) return base;
  return { ...base, atoms: dedupe([{ atom: t, uids: [], weight: 5, mine: 1 }, ...base.atoms]).slice(0, MAX_ATOMS) };
}
function dedupe(a: TasteAtom[]): TasteAtom[] {
  const seen = new Set<string>();
  return a.filter((x) => x.atom && !seen.has(x.atom) && (seen.add(x.atom), true));
}

// ——— 离线：「为什么」里反复出现的短语 + 常用标签 ———

const STOP = new Set(['一个', '这个', '那个', '什么', '因为', '所以', '就是', '还是', '感觉', '觉得', '喜欢', '真的', '有点', '一种', '时候', '我们', '自己', '没有', '可以', '一样', '这种', '很多', '一直', '然后', '但是', '如果', '这样', '那种', '特别', '非常', '好像', '不是', '东西', '的话', '一下']);
const SPLIT = /[\s，,。.！!？?、；;：:「」『』（）()《》"“”'‘’\-—…·/\\|]+|的|了|和|跟|与|在|是|我|你|他|她|它|很|也|都|就|又|还|被|把|让|给|着|过|吗|呢|吧|啊/;

export function offlineAtoms(items: Item[], max = MAX_ATOMS): TasteAtom[] {
  const count = new Map<string, Set<string>>();
  const add = (k: string, uid: string) => {
    if (k.length < 2 || k.length > 6 || STOP.has(k) || /^\d+$/.test(k)) return;
    let s = count.get(k);
    if (!s) count.set(k, (s = new Set()));
    s.add(uid);
  };
  for (const it of items) {
    if (!it.uid) continue;
    for (const ph of (it.why || '').split(SPLIT)) {
      const p = ph.trim();
      if (p.length >= 2 && p.length <= 6) add(p, it.uid);
      else if (p.length > 6) for (let i = 0; i + 4 <= p.length; i += 2) add(p.slice(i, i + 4), it.uid);
    }
    for (const t of it.tags || []) add(cleanAtom(t), it.uid);
  }
  const rows = [...count.entries()].filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length);
  const out: TasteAtom[] = [];
  for (const [k, s] of rows) {
    // 被更长的已选短语包含的不要（「低保真」和「保真」只留一个）
    if (out.some((o) => o.atom.includes(k) || k.includes(o.atom))) continue;
    out.push({ atom: k, uids: [...s].slice(0, 8), weight: Math.min(5, 1 + s.size) });
    if (out.length >= max) break;
  }
  return out;
}

// ——— AI 抽取 ———

export function buildAtomPrompt(items: Item[]): { system: string; user: string } {
  const system = [
    '你在帮一个人整理他自己的收藏口味。下面每一行是他收的一件东西和他写的「为什么打动我」。',
    `从这些「为什么」里抽出最多 ${MAX_ATOMS} 个「我在意的东西」：2–6 个字的短语，具体、可感（如：手写感、留白、低保真、夜里的城市、重复的节奏），不要空泛的词（好看、高级、有感觉）。`,
    '每个原子标出依据的素材 ID（方括号里 # 后面的数字，至少 2 个）和权重 w（1–5，越常出现越高）。只用他写的内容，不许编。',
    '不要输出思考过程，只输出一个 JSON 对象：{"atoms":[{"atom":"…","refs":[素材ID,素材ID],"w":3}]}',
  ].join('\n');
  const user = items
    .slice(0, 120)
    .map((it) => `[#${it.id}] ${it.title.slice(0, 30)}：${(it.why || '').slice(0, 80)}${it.tags?.length ? ` #${it.tags.slice(0, 4).join(' #')}` : ''}`)
    .join('\n');
  return { system, user };
}
export function normalizeAtoms(raw: unknown, items: Item[]): TasteAtom[] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ids = items.map((i) => i.id!);
  const out: TasteAtom[] = [];
  for (const x of Array.isArray(r.atoms) ? r.atoms : []) {
    const o = (x && typeof x === 'object' ? x : { atom: x }) as Record<string, unknown>;
    const atom = cleanAtom(String(o.atom || o.text || ''));
    if (atom.length < 2) continue;
    const chk = checkRefs(o.refs, ids);
    const uids = chk.refs.map((p) => items[p - 1]?.uid).filter(Boolean) as string[];
    const w = Math.max(1, Math.min(5, Math.round(Number(o.w ?? o.weight) || 3)));
    out.push({ atom, uids, weight: w });
  }
  return dedupe(out).slice(0, MAX_ATOMS);
}
/** 只用写了为什么的穗；没模型或失败 → 离线 */
export async function extractAtoms(s: Settings | null, items: Item[]): Promise<AtomStore> {
  const withWhy = items.filter((i) => (i.why || '').trim().length >= 2 && i.uid);
  if (!withWhy.length) throw new AIError('还没有写过「为什么」的穗：先给几穗补一句为什么');
  if (s) {
    const p = buildAtomPrompt(withWhy);
    const out = await chat(
      s,
      [
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ],
      { temperature: 0.4, maxTokens: 1200 },
    );
    const atoms = normalizeAtoms(parseJSONLoose(out), withWhy);
    if (atoms.length) return { at: Date.now(), source: 'ai', atoms };
  }
  return { at: Date.now(), source: 'offline', atoms: offlineAtoms(withWhy) };
}

// ——— 0244 导出成提示词 ———

/** ≤300 字的 Markdown：只含原子与代表作（不含私密穗、不含为什么原文） */
export function atomsPrompt(st: AtomStore, items: Item[], name = 'Q1f730'): string {
  const byUid = new Map(items.filter((i) => i.uid && !i.private && !i.locked && !i.deletedAt).map((i) => [i.uid!, i]));
  const top = topAtoms(st, 12);
  const score = new Map<string, number>();
  for (const a of st.atoms) for (const u of a.uids) if (byUid.has(u)) score.set(u, (score.get(u) || 0) + a.weight);
  const reps = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([u]) => byUid.get(u)!)
    .map((it) => `《${it.title.replace(/^《|》$/g, '').slice(0, 14)}》${it.creator ? `（${it.creator.slice(0, 8)}）` : ''}`);
  const lines = [
    `# ${name} 的口味（来自拾穗）`,
    `我在意：${top.join('、')}。`,
    reps.length ? `代表作：${reps.join('、')}。` : '',
    '给我写东西或出主意时：接住上面这些，别用大众套路和 AI 腔；说不清依据就直说。',
  ].filter(Boolean);
  let out = lines.join('\n');
  while (out.length > 300 && top.length > 3) {
    top.pop();
    lines[1] = `我在意：${top.join('、')}。`;
    out = lines.join('\n');
  }
  return out.slice(0, 300);
}
