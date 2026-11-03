// v0.30 0211 穗仓对话：问「我收过哪些关于雨的东西」，先本地检索 top20，再只基于这些穗回答，每句带穗；没命中直说没有。
// 0237 对话沉淀：有价值的回答一键收成穗（来源「穗仓对话」）。
import { chat, parseJSONLoose } from './ai';
import { parseQuery, searchDocs, toDoc } from './search';
import type { Settings } from './settings';
import type { Item } from './types';

/** 问句里的虚词 / 套话去掉，剩下的才是要搜的词 */
const FILLER = /我(?:之前|以前|都|还)?(?:收过|收藏过|拾过|存过|收的|拾的|存的)?|有没有|有哪些|哪些|哪一些|什么样的|什么|关于|讲|和|跟|与|或者|还有|一些|东西|内容|的|吗|呢|吧|啊|呀|请|帮我|找找|找一下|找|列出|看看|一下|最近|有关|相关|跟.*?有关|是不是|穗|拾穗|仓里|里面/g;

export function askTerms(q: string): string[] {
  const s = (q || '').replace(/[？?！!。，,、；;：:"“”「」《》()（）]/g, ' ').replace(FILLER, ' ');
  const parts = s.split(/\s+/).map((x) => x.trim()).filter((x) => x.length >= 1);
  return [...new Set(parts)].slice(0, 6);
}

/** 本地检索：每个词各搜一遍（OR），分数相加；某个长词搜不到就拆成二字词再试 */
export function askRetrieve(items: Item[], q: string, k = 20): Array<{ item: Item; score: number }> {
  const docs = items.filter((i) => !i.deletedAt).map((i) => toDoc('i', i));
  const score = new Map<number, number>();
  const run = (term: string) => {
    const hits = searchDocs(null, docs, parseQuery(term));
    for (const h of hits) score.set(h.doc.ref, (score.get(h.doc.ref) || 0) + h.score);
    return hits.length;
  };
  for (const t of askTerms(q)) {
    if (run(t) || t.length < 3) continue;
    for (let i = 0; i + 2 <= t.length; i++) run(t.slice(i, i + 2));
  }
  const byId = new Map(items.map((i) => [i.id!, i]));
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || (byId.get(b[0])?.createdAt || 0) - (byId.get(a[0])?.createdAt || 0))
    .slice(0, k)
    .map(([id, sc]) => ({ item: byId.get(id)!, score: sc }))
    .filter((x) => x.item);
}

export interface AskAnswer {
  q: string;
  /** 回答文字（[#id] 已换成《标题》） */
  text: string;
  /** 回答引用到的穗 id（按出现顺序） */
  refs: number[];
  /** 本地检索命中的（给人看「从这些里找的」） */
  hits: number[];
  source: 'ai' | 'offline' | 'none';
}

export function buildAskPrompt(q: string, hits: Item[]): { system: string; user: string } {
  const system = [
    '你只为这一个人的私人收藏回答问题。下面是从他的收藏里按关键词找出来的穗（方括号里 # 后面的数字是穗 ID）。',
    '只能基于这些穗回答，不许引入外部作品、常识推荐或编造；每句话都要带上它依据的穗 [#ID]。',
    '如果这些穗其实都不相关，直接说「穗仓里没有」，不要硬凑。回答 150 字内。',
    '不要输出思考过程，只输出一个 JSON 对象：{"answer":"…","refs":[穗ID]}',
  ].join('\n');
  const user = [
    `问：${q}`,
    '找到的穗：',
    hits.map((it) => `[#${it.id}] ${it.title.slice(0, 40)}${it.creator ? ` · ${it.creator}` : ''}${it.why ? `\n  为什么：${it.why.slice(0, 80)}` : ''}${it.tags?.length ? `\n  标签：${it.tags.slice(0, 5).join('、')}` : ''}${it.content && it.content !== it.title ? `\n  内容：${it.content.slice(0, 80)}` : ''}`).join('\n'),
  ].join('\n\n');
  return { system, user };
}

export function normalizeAsk(raw: unknown, out: string, hits: Item[]): { text: string; refs: number[] } {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  let text = o && typeof o.answer === 'string' ? o.answer.trim() : out.replace(/```[\s\S]*?```/g, '').trim();
  const ok = new Map(hits.map((h) => [h.id!, h]));
  const refs: number[] = [];
  const push = (n: number) => ok.has(n) && !refs.includes(n) && refs.push(n);
  for (const m of text.matchAll(/\[#?(\d+)\]/g)) push(Number(m[1]));
  for (const r of Array.isArray(o?.refs) ? (o!.refs as unknown[]) : []) push(Number(r));
  text = text.replace(/\[#?(\d+)\]/g, (_m, n: string) => {
    const it = ok.get(Number(n));
    return it ? `《${it.title.replace(/^《|》$/g, '').slice(0, 16)}》` : '';
  });
  return { text: text.slice(0, 800), refs };
}

/** 问一句：没命中直说没有（不调模型）；没模型就列出命中的穗 */
export async function askLibrary(s: Settings | null, items: Item[], q0: string, signal?: AbortSignal): Promise<AskAnswer> {
  const q = q0.trim().slice(0, 120);
  const found = askRetrieve(items, q);
  const hits = found.map((f) => f.item);
  if (!hits.length) return { q, text: '穗仓里没有找到相关的穗。换个说法，或者先去拾几穗。', refs: [], hits: [], source: 'none' };
  if (!s) {
    const names = hits.slice(0, 8).map((it) => `《${it.title.replace(/^《|》$/g, '').slice(0, 16)}》`);
    return { q, text: `没连模型，按字面找到 ${hits.length} 穗：${names.join('、')}${hits.length > 8 ? ' 等' : ''}。`, refs: hits.slice(0, 8).map((h) => h.id!), hits: hits.map((h) => h.id!), source: 'offline' };
  }
  const p = buildAskPrompt(q, hits);
  const out = await chat(
    s,
    [
      { role: 'system', content: p.system },
      { role: 'user', content: p.user },
    ],
    { temperature: 0.3, maxTokens: 600, signal },
  );
  const r = normalizeAsk(parseJSONLoose(out), out, hits);
  return { q, text: r.text || '穗仓里没有。', refs: r.refs, hits: hits.map((h) => h.id!), source: 'ai' };
}

/** 0237 收成穗：一条「想法」穗，内容是问答，来源「穗仓对话」，为什么留给用户补 */
export function answerItem(a: AskAnswer): Omit<Item, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    type: 'idea',
    title: a.text.replace(/\s+/g, ' ').slice(0, 30),
    content: `问：${a.q}\n答：${a.text}`,
    tags: ['穗仓对话'],
    source: '穗仓对话',
  };
}
