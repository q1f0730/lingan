/**
 * ROADMAP v0.41 穗仓的空地：口味页指出「你几乎没收过的」——某类型、某年代、某种情绪的空白。
 * 只给一句提示和一个问题，不去网上找任何内容塞给你（离线、纯统计，单测覆盖）。
 */
import { TYPE_LABEL, TYPE_ORDER, type Item, type ItemType } from './types';

export interface Gap {
  kind: 'type' | 'decade' | 'mood';
  key: string;
  hint: string;
  ask: string;
}

const TYPE_ASK: Record<ItemType, string> = {
  music: '最近一首让你停下手里事情的歌是什么？',
  film: '最近一部让你看完还坐着不动的片子是哪部？',
  image: '这周有没有一个画面，你后来还在想？',
  text: '最近读到哪一句，你想抄下来？',
  link: '有没有一个网页，你收藏了却一直没回去看？',
  idea: '今天有没有一个念头，闪了一下就没了？',
};

/** 情绪：在「为什么」和标签里认词 */
export const MOODS: Array<{ key: string; label: string; words: string[]; ask: string }> = [
  { key: 'warm', label: '温暖', words: ['温暖', '暖', '温柔', '治愈', '安心', '平静', '安静'], ask: '上一次觉得被轻轻接住，是因为什么？' },
  { key: 'sad', label: '难过', words: ['难过', '悲伤', '伤感', '哭', '遗憾', '孤独', '失落', '心酸'], ask: '有没有一样东西，让你难过但你还是想留着？' },
  { key: 'fun', label: '好笑', words: ['好笑', '搞笑', '幽默', '笑', '开心', '快乐', '可爱', '荒诞'], ask: '上一次笑出声是因为什么？' },
  { key: 'fire', label: '燃', words: ['燃', '热血', '力量', '爽', '愤怒'], ask: '最近有什么让你想立刻站起来去做点事？' },
  { key: 'fear', label: '不安', words: ['恐怖', '害怕', '不安', '诡异', '压抑', '窒息', '惊悚'], ask: '有没有让你不舒服、却移不开眼的东西？' },
  { key: 'love', label: '心动', words: ['浪漫', '心动', '喜欢你', '爱情', '暧昧', '思念'], ask: '最近一次心跳快了一下，是看到了什么？' },
];

function decadeOf(y: string | undefined): number | null {
  const m = /(1[89]\d\d|20\d\d)/.exec(y || '');
  return m ? Math.floor(Number(m[1]) / 10) * 10 : null;
}

export function findGaps(items: Item[], max = 3): Gap[] {
  const out: Gap[] = [];
  const n = items.length;
  if (n < 10) return out;
  // 类型：一穗都没有，或 ≥30 穗时不到 3%
  const byType = new Map<ItemType, number>();
  for (const it of items) byType.set(it.type, (byType.get(it.type) || 0) + 1);
  for (const t of TYPE_ORDER) {
    const c = byType.get(t) || 0;
    if (c === 0) out.push({ kind: 'type', key: t, hint: `你还没收过${TYPE_LABEL[t]}穗。`, ask: TYPE_ASK[t] });
    else if (n >= 30 && c / n < 0.03) out.push({ kind: 'type', key: t, hint: `${TYPE_LABEL[t]}只有 ${c} 穗，几乎是空地。`, ask: TYPE_ASK[t] });
  }
  // 年代：带年份的作品 ≥8 穗时，最早和最晚之间整段空着的十年
  const ds = items.map((i) => decadeOf(i.year)).filter((d): d is number => d != null);
  if (ds.length >= 8) {
    const have = new Set(ds);
    const lo = Math.min(...ds);
    const hi = Math.max(...ds);
    for (let d = lo + 10; d < hi; d += 10)
      if (!have.has(d)) {
        out.push({ kind: 'decade', key: String(d), hint: `${d} 年代是一片空地：前后都有，中间这十年一穗没有。`, ask: `${d} 年代有没有什么，你一直想补却没收过？` });
        break;
      }
  }
  // 情绪：认得出情绪的穗 ≥8 时，一穗都没有的那几种
  const hit = new Map<string, number>();
  let any = 0;
  for (const it of items) {
    const txt = (it.why || '') + ' ' + it.tags.join(' ');
    let got = false;
    for (const m of MOODS)
      if (m.words.some((w) => txt.includes(w))) {
        hit.set(m.key, (hit.get(m.key) || 0) + 1);
        got = true;
      }
    if (got) any++;
  }
  if (any >= 8) for (const m of MOODS) if (!hit.get(m.key)) out.push({ kind: 'mood', key: m.key, hint: `你收的穗里几乎没有「${m.label}」的。`, ask: m.ask });
  // 每种空地最多先给一条，再按顺序补满
  const first = (['type', 'mood', 'decade'] as const).map((k) => out.find((g) => g.kind === k)).filter((g): g is Gap => !!g);
  const rest = out.filter((g) => !first.includes(g));
  return [...first, ...rest].slice(0, max);
}
