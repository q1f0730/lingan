// v0.18 五种嫁接：相近 / 远距 / 被冷落 / 跨媒介 / 反氛围。
// 依据 research Perplexity P1「near / far / neglected / cross-medium / anti-vibe」+ pipeline 第 1 步
// 「underuse… at least three media types」。每种接法的抽样规则写在这里，同一段文字也写进 prompt。
import { similarity } from './similarity';
import { TYPE_LABEL, type Item, type ItemType } from './types';

export type GraftMode = 'near' | 'far' | 'neglected' | 'cross' | 'anti';

export interface ModeDef {
  id: GraftMode;
  name: string;
  /** 界面上的一句话 */
  note: string;
  /** 抽样规则（界面「怎么抽」与 prompt 同用） */
  rule: string;
  /** 给模型的要求 */
  ask: string;
  /** 离线：优先长成新枝的变形法 */
  transform: string;
  /** 存进 Development.jump，兼容旧字段 */
  jump: number;
}

export const MIN_CROSS_TYPES = 3;

export const MODES: ModeDef[] = [
  {
    id: 'near',
    name: '相近',
    note: '挑气质接近的',
    rule: '先随机抽一穗做起点，之后每次从与已选几穗平均最相像的前三穗里抽一穗。',
    ask: '这几穗气质相近：不要把相像当成同一件事，找出它们之间最细的那一点不同，把它放大成新枝。',
    transform: 'remove',
    jump: 0.15,
  },
  {
    id: 'far',
    name: '远距',
    note: '故意挑最不搭的',
    rule: '先随机抽一穗做起点，之后每次从与已选几穗平均最不相像的前三穗里抽一穗，类型尽量不重复。',
    ask: '这几穗故意挑得最不搭：不要找表面题材的共同点，去找结构、节奏、动作上的桥。',
    transform: 'eras',
    jump: 0.9,
  },
  {
    id: 'neglected',
    name: '被冷落',
    note: '优先从没接过的',
    rule: '按被嫁接次数从少到多排，只从全库最低的一档里抽；同一档里先抽从没接过的，再抽最久没接的。',
    ask: '这几穗很少被拿来嫁接：先看见每一穗被忽略的那个细节，让新枝靠这些细节长出来，不要只用它们最显眼的标签。',
    transform: 'flaw',
    jump: 0.6,
  },
  {
    id: 'cross',
    name: '跨媒介',
    note: '照片接歌，摘抄接电影',
    rule: `每组至少 ${MIN_CROSS_TYPES} 种类型：先每种类型抽一穗（类型之间尽量远），再按最不相像补满。`,
    ask: '这几穗来自不同媒介：每根新枝至少跨两种媒介，并且最后的形式不能和任何一穗原本的媒介相同。',
    transform: 'medium',
    jump: 0.7,
  },
  {
    id: 'anti',
    name: '反氛围',
    note: '把一穗的反面接上去',
    rule: '第一穗做锚；其余几穗按「与锚的氛围相反（静↔闹、明↔暗、暖↔冷、轻↔重、旧↔新、自然↔人造）」优先，其次与已选最不相像。',
    ask: '第一穗是锚：先说出它的氛围，再让新枝把它的反面接上去；不许调和成不冷不热的中间态。',
    transform: 'invert',
    jump: 0.8,
  },
];

const BY_ID = new Map(MODES.map((m) => [m.id, m]));
export function modeDef(id: GraftMode | undefined): ModeDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}
export function modeName(id: GraftMode | undefined): string {
  return modeDef(id)?.name || '';
}
export function isMode(v: unknown): v is GraftMode {
  return typeof v === 'string' && BY_ID.has(v as GraftMode);
}

// ——— 嫁接次数 ———
export const graftCount = (it: Item) => (typeof it.graftCount === 'number' && it.graftCount > 0 ? it.graftCount : 0);
const graftedAt = (it: Item) => it.graftedAt || 0;

/** 由新枝算出每件穗被嫁接的次数与最后一次时间：同一批（batch.id）三根算一次，旧的单根新枝每根算一次 */
export function graftStatsFromDevs(devs: Array<{ id?: number; itemIds: number[]; createdAt: number; batch?: { id: string } }>): Map<number, { count: number; last: number }> {
  const events = new Map<string, { ids: Set<number>; at: number }>();
  devs.forEach((d, i) => {
    const key = d.batch?.id ? `b:${d.batch.id}` : `d:${d.id ?? `i${i}`}`;
    const e = events.get(key) || { ids: new Set<number>(), at: 0 };
    for (const x of d.itemIds || []) if (x > 0) e.ids.add(x);
    e.at = Math.max(e.at, d.createdAt || 0);
    events.set(key, e);
  });
  const out = new Map<number, { count: number; last: number }>();
  for (const e of events.values())
    for (const id of e.ids) {
      const s = out.get(id) || { count: 0, last: 0 };
      s.count++;
      s.last = Math.max(s.last, e.at);
      out.set(id, s);
    }
  return out;
}

/** 全库最低档的门槛：按次数从少到多排，第 n 件的次数。抽到的 n 件次数都不超过它，且比它少的全部被抽到 */
export function lowestTier(items: Item[], n: number): number {
  const counts = items.filter((i) => i.id != null).map(graftCount).sort((a, b) => a - b);
  if (!counts.length) return 0;
  return counts[Math.min(n, counts.length) - 1];
}

// ——— 氛围（反氛围用）———
export const VIBE_AXES: Array<{ pos: string; neg: string; p: string[]; n: string[] }> = [
  { pos: '安静', neg: '热闹', p: ['安静', '寂静', '静', '沉默', '无声', '独处', '独自', '孤独', '冷清', '留白', '空旷', '慢', '缓', '雾', '凌晨', '深夜', '低语', '呼吸', 'quiet', 'silence', 'slow', 'ambient', 'calm'], n: ['热闹', '喧闹', '嘈杂', '吵', '派对', '人群', '节日', '狂欢', '摇滚', '鼓', '集市', '欢呼', '烟花', '快', '舞', 'loud', 'party', 'rock', 'dance', 'crowd', 'fast'] },
  { pos: '明亮', neg: '昏暗', p: ['明亮', '阳光', '白天', '晴', '光', '亮', '夏', '金色', '早晨', '清晨', '日出', 'sun', 'bright', 'morning', 'summer'], n: ['黑暗', '昏暗', '阴', '暗', '夜', '影', '雨', '灰', '黑', '黄昏', '冬', 'dark', 'night', 'shadow', 'rain', 'grey', 'gray'] },
  { pos: '温暖', neg: '冰冷', p: ['温暖', '暖', '热', '炉', '火', '拥抱', '家', '甜', '烤', '汤', '毛衣', '手心', 'warm', 'home', 'sweet'], n: ['冷', '冰', '寒', '雪', '金属', '疏离', '蓝', '玻璃', '霜', 'cold', 'ice', 'snow', 'blue'] },
  { pos: '轻盈', neg: '沉重', p: ['轻', '柔', '羽毛', '风', '漂浮', '飘', '气泡', '纸', '云', 'soft', 'light', 'float', 'air'], n: ['重', '沉', '石', '铁', '压', '混凝土', '钢', '厚', '墙', 'heavy', 'stone', 'iron', 'concrete'] },
  { pos: '怀旧', neg: '新潮', p: ['旧', '老', '复古', '胶片', '怀旧', '年代', '收音机', '磁带', '黑白', '泛黄', '外婆', '童年', 'old', 'vintage', 'retro', 'tape'] , n: ['新', '未来', '科技', '数字', '赛博', '屏幕', '算法', '像素', '机器人', 'ai', 'future', 'digital', 'cyber', 'neon'] },
  { pos: '自然', neg: '人造', p: ['山', '海', '树', '花', '草', '田', '河', '森林', '鸟', '湖', '麦', '土', '叶', 'nature', 'sea', 'forest', 'mountain', 'river'], n: ['城市', '地铁', '楼', '便利店', '霓虹', '工厂', '马路', '塑胶', '停车', '电梯', '商场', '写字楼', 'city', 'subway', 'mall', 'office'] },
];

function vibeText(it: Item): string {
  return [it.title, it.creator, it.content, it.why, it.caption, it.tags.join(' ')].filter(Boolean).join(' ').toLowerCase();
}

/** 每条氛围轴上 -1 / 0 / +1（正 = pos，负 = neg） */
export function vibeOf(it: Item): number[] {
  const t = vibeText(it);
  return VIBE_AXES.map((ax) => {
    const hit = (ws: string[]) => ws.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
    const v = hit(ax.p) - hit(ax.n);
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  });
}

/** 氛围的文字说法，如「安静、昏暗」；读不出来返回空 */
export function vibeWords(v: number[]): string[] {
  return v.map((x, i) => (x > 0 ? VIBE_AXES[i].pos : x < 0 ? VIBE_AXES[i].neg : '')).filter(Boolean);
}
export function oppositeWords(v: number[]): string[] {
  return v.map((x, i) => (x > 0 ? VIBE_AXES[i].neg : x < 0 ? VIBE_AXES[i].pos : '')).filter(Boolean);
}

/** 与锚的氛围相反程度：锚读得出的轴上，b 站在反面的条数 − 站在同面的条数 */
export function vibeOpposition(anchor: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < anchor.length; i++) s -= anchor[i] * b[i];
  return s;
}

// ——— 抽样 ———
export interface DrawOpts {
  rand?: () => number;
  /** 已经定下、要保留的穗（换一穗时用） */
  keep?: Item[];
  /** 不许抽到的穗 id（换一穗时被换掉的那件） */
  exclude?: number[];
}
export interface DrawResult {
  items: Item[];
  /** 给人看的提示（比如库里类型不够 3 种） */
  note?: string;
  /** 跨媒介：库里一共几种类型 */
  libTypes?: number;
}

const avgSim = (x: Item, chosen: Item[]) => (chosen.length ? chosen.reduce((s, c) => s + similarity(x, c), 0) / chosen.length : 0);

function pickTop<T>(arr: T[], score: (x: T) => number, k: number, rand: () => number): T {
  const sorted = arr.map((x) => ({ x, s: score(x) })).sort((a, b) => a.s - b.s);
  const top = sorted.slice(0, Math.min(k, sorted.length));
  return top[Math.floor(rand() * top.length)].x;
}

/** 按某种接法从穗仓里抽 n 穗。抽样规则见 MODES[].rule */
export function drawForMode(mode: GraftMode, all: Item[], n: number, opts: DrawOpts = {}): DrawResult {
  const rand = opts.rand || Math.random;
  const keep = (opts.keep || []).filter((k) => k.id != null);
  const keepIds = new Set(keep.map((k) => k.id));
  const ex = new Set(opts.exclude || []);
  const lib = all.filter((i) => i.id != null);
  const pool = lib.filter((i) => !keepIds.has(i.id) && !ex.has(i.id!));
  const need = Math.max(0, n - keep.length);
  const libTypes = new Set(lib.map((i) => i.type)).size;
  if (pool.length <= need && mode !== 'cross') return { items: [...keep, ...pool] };
  const chosen = [...keep];
  const rest = () => pool.filter((p) => !chosen.includes(p));

  if (mode === 'neglected') {
    // 次数少的在前；同次数里从没接过 / 最久没接的在前；再同就随机
    const r = new Map(pool.map((p) => [p.id!, rand()]));
    const sorted = [...pool].sort((a, b) => graftCount(a) - graftCount(b) || graftedAt(a) - graftedAt(b) || r.get(a.id!)! - r.get(b.id!)!);
    return { items: [...chosen, ...sorted.slice(0, need)] };
  }

  if (mode === 'cross') {
    const want = Math.min(n, MIN_CROSS_TYPES);
    const types = new Set<ItemType>(chosen.map((c) => c.type));
    let note: string | undefined;
    if (libTypes < want) note = `穗仓里只有 ${libTypes} 种类型，跨媒介至少要 ${want} 种：先尽量把不同类型都放进来了，去拾点别的类型再试。`;
    while (chosen.length < n) {
      const left = rest();
      if (!left.length) break;
      const fresh = left.filter((x) => !types.has(x.type));
      const cand = fresh.length ? fresh : left;
      const next = chosen.length ? pickTop(cand, (x) => avgSim(x, chosen), 3, rand) : cand[Math.floor(rand() * cand.length)];
      chosen.push(next);
      types.add(next.type);
    }
    return { items: chosen, note, libTypes };
  }

  if (mode === 'anti') {
    if (!chosen.length) {
      const left = rest();
      const vibed = left.filter((x) => vibeOf(x).some(Boolean));
      const from = vibed.length ? vibed : left;
      chosen.push(from[Math.floor(rand() * from.length)]);
    }
    const anchor = vibeOf(chosen[0]);
    while (chosen.length < n) {
      const left = rest();
      if (!left.length) break;
      // 反面优先（相反程度整条比较），同样相反时取与已选最不相像的
      const scored = left.map((x) => ({ x, o: vibeOpposition(anchor, vibeOf(x)), s: avgSim(x, chosen) }));
      const bestO = Math.max(...scored.map((s) => s.o));
      const top = scored.filter((s) => s.o === bestO);
      chosen.push(pickTop(top, (s) => s.s, 2, rand).x);
    }
    return { items: chosen };
  }

  // near / far
  if (!chosen.length) chosen.push(pool[Math.floor(rand() * pool.length)]);
  while (chosen.length < n) {
    const left = rest();
    if (!left.length) break;
    const next =
      mode === 'near'
        ? pickTop(left, (x) => -avgSim(x, chosen), 3, rand)
        : pickTop(left, (x) => avgSim(x, chosen) + (chosen.some((c) => c.type === x.type) ? 0.1 : 0), 3, rand);
    chosen.push(next);
  }
  return { items: chosen };
}

// ——— prompt 里的接法段 ———
/** 给模型的接法说明：名字 + 抽样规则 + 要求 + 这一组的具体情况 */
export function modeBrief(mode: GraftMode | undefined, items: Item[]): string {
  const m = modeDef(mode);
  if (!m) return '';
  const idOf = (it: Item, i: number) => `#${typeof it.id === 'number' ? it.id : i + 1}`;
  const lines = [`这次的接法：${m.name}（${m.note}）。`, `抽样规则：${m.rule}`, `要求：${m.ask}`];
  if (mode === 'neglected') lines.push(`这几穗被嫁接过的次数：${items.map((it, i) => `${idOf(it, i)} ${graftCount(it)} 次`).join('，')}。`);
  if (mode === 'cross') {
    const ts = [...new Set(items.map((i) => TYPE_LABEL[i.type]))];
    lines.push(`这一组的媒介（${ts.length} 种）：${ts.join('、')}。`);
  }
  if (mode === 'anti' && items[0]) {
    const v = vibeOf(items[0]);
    const w = vibeWords(v);
    lines.push(
      w.length
        ? `锚是 ${idOf(items[0], 0)}，它的氛围读起来是「${w.join('、')}」，反面是「${oppositeWords(v).join('、')}」。`
        : `锚是 ${idOf(items[0], 0)}，它的氛围由你从素材里读出来，再找反面。`,
    );
  }
  return lines.join('\n');
}
