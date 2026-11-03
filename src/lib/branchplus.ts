// v0.30 新枝之后：ROADMAP v0.24 新枝再嫁接（更野 / 更能落地 / 换一种形式，子枝挂在原枝下）、
// 0204 新枝追问（回答只用这批穗）、0904 新枝落地追踪（种子 / 试过 / 做成 / 放弃，结果图成新穗）。
// 新字段都在 Development 行里（parentUid / regraft / status / followups），不加索引，Dexie 不变。
import { AIError, chat, parseJSONLoose } from './ai';
import { WILD_DETOURS } from './constraints';
import { describeForGraft } from './graft';
import { checkRefs, evidenceClean, evidenceIds, minEvidence, weakNote } from './provenance';
import type { Settings } from './settings';
import type { BranchStatus, Development, Followup, Idea, Item, RegraftKind } from './types';

export const REGRAFT_LABEL: Record<RegraftKind, string> = { wilder: '更野', grounded: '更能落地', reform: '换一种形式' };
export const STATUS_LABEL: Record<BranchStatus, string> = { seed: '种子', tried: '试过', done: '做成', dropped: '放弃' };
export const STATUS_ORDER: BranchStatus[] = ['seed', 'tried', 'done', 'dropped'];

/** 换一种形式：歌 → 短片 → 海报 → 文案 → 装置 → 游戏 → 播客 → 照片 → 歌 */
export const FORM_CYCLE = ['歌', '短片', '海报', '文案', '装置', '游戏', '播客', '一组照片'];
export function nextForm(form?: string): string {
  const f = form || '';
  const RULES: Array<[RegExp, string]> = [
    [/照片|摄影|相片/, '一组照片'],
    [/播客|电台/, '播客'],
    [/游戏/, '游戏'],
    [/装置/, '装置'],
    [/海报|封面|画/, '海报'],
    [/歌|曲|MV/i, '歌'],
    [/片|视频|影像|镜头/, '短片'],
    [/文|诗|旁白|故事|信/, '文案'],
  ];
  const hit = RULES.find(([re]) => re.test(f));
  const i = hit ? FORM_CYCLE.indexOf(hit[1]) : -1;
  return FORM_CYCLE[(i + 1) % FORM_CYCLE.length];
}

const KIND_ASK: Record<RegraftKind, (idea: Idea) => string> = {
  wilder: () => '更野：找出这根新枝默认成立的一个前提，把它打破，换一个更陌生的角度；宁可奇怪也不要稳妥。',
  grounded: () => '更能落地：把它收成今晚就能开工的版本：用什么材料、多长、在哪做、第一步怎么动手，都要具体到能照着做。',
  reform: (idea) => `换一种形式：从「${idea.form || '原来的形式'}」换成「${nextForm(idea.form)}」，保留它接住的那份感觉和用到的素材。`,
};
const KIND_TEMP: Record<RegraftKind, number> = { wilder: 1.3, grounded: 0.6, reform: 0.9 };

export function buildRegraftPrompt(parent: Idea, items: Item[], kind: RegraftKind): { system: string; user: string; temperature: number } {
  const k = minEvidence(items.length);
  const system = [
    '你是只为一个人的私人收藏工作的「嫁接器」。下面是一根已经长出来的新枝和它的素材，在它的基础上再长一根子枝。',
    KIND_ASK[kind](parent),
    '只能使用给出的素材，不要引入大众流行梗、名人名作、行业套路或泛泛建议。',
    `子枝给出：title（12 字内，不要冒号）、idea（100-180 字，具体到画面 / 声音 / 结构；用到哪件素材就点出它的名字）、form（形式）、refs（真正用到的素材 ID，至少 ${k} 个，只能是方括号里 # 后的数字）、experiment（20 分钟能完成的小实验）。`,
    '不要输出思考过程，只输出一个 JSON 对象：{"title":"…","idea":"…","form":"…","refs":[素材ID],"experiment":"…"}',
  ].join('\n');
  const user = [
    '素材：',
    items.map((it, i) => describeForGraft(it, i)).join('\n\n'),
    `原来那根新枝：《${parent.title.replace(/^《|》$/g, '')}》（${parent.form || '形式未定'}）`,
    parent.idea,
    parent.experiment ? `原来的小实验：${parent.experiment}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, user, temperature: KIND_TEMP[kind] };
}

export function normalizeRegraft(raw: unknown, parent: Idea, items: Item[], kind: RegraftKind): Idea | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const idea = s(o.idea);
  if (!idea) return null;
  const k = minEvidence(items.length);
  const chk = checkRefs(o.refs, evidenceIds(items));
  const clean = evidenceClean(chk, k);
  return {
    title: (s(o.title) || parent.title).replace(/[:：]/g, ' ').slice(0, 24),
    bridge: `${REGRAFT_LABEL[kind]} · 接自《${parent.title.replace(/^《|》$/g, '')}》`,
    idea,
    form: s(o.form) || (kind === 'reform' ? nextForm(parent.form) : parent.form),
    cliches: [],
    oblique: parent.oblique,
    transform: parent.transform,
    experiment: s(o.experiment) || parent.experiment,
    refs: clean ? chk.refs : parent.refs,
    evidence: clean ? 'ok' : parent.refs?.length ? 'ok' : 'weak',
    evidenceNote: clean || parent.refs?.length ? undefined : weakNote(chk, k),
  };
}

/** 离线子枝：按三种接法改写原枝（溯源沿用原枝） */
export function offlineRegraft(parent: Idea, kind: RegraftKind, rand: () => number = Math.random): Idea {
  const t = parent.title.replace(/^《|》$/g, '');
  const base: Idea = { ...parent, cliches: [], bridge: `${REGRAFT_LABEL[kind]} · 接自《${t}》`, nearest: undefined, wall: undefined, distinct: undefined };
  if (kind === 'wilder') {
    const d = WILD_DETOURS[Math.floor(rand() * WILD_DETOURS.length)];
    return { ...base, title: `野·${t}`.slice(0, 14), idea: `${d}？把原来的前提拿掉再长一次：${parent.idea}`, wild: 1 };
  }
  if (kind === 'grounded') {
    return {
      ...base,
      title: `今晚·${t}`.slice(0, 14),
      idea: `收成今晚就能开工的版本：只用手边的东西，限时 60 分钟，做出最粗的一版。第一步：${parent.experiment || parent.firstStep || '把用到的那几穗摊在桌上，挑一个细节先做'}。原来的想法：${parent.idea}`,
    };
  }
  const f = nextForm(parent.form);
  return { ...base, title: `${f}·${t}`.slice(0, 14), form: f, idea: `换成「${f}」：保留原来接住的那份感觉，用${f}的方式重新讲一遍。${parent.idea}` };
}

/** 子枝那一行：同一批素材、挂在父枝下（parentUid）；不进父枝那一捆（没有 batch） */
export function childDevelopment(parent: Development, idea0: Idea, kind: RegraftKind, source: 'ai' | 'offline', now = Date.now(), ids: number[] = parent.itemIds): Development {
  // 离线子枝沿用父枝的 refs（父枝 itemIds 里的位置）：素材表变了（父枝的穗有被删的）就按穗 id 换算到新位置
  let idea = idea0;
  if (source === 'offline' && ids.join() !== parent.itemIds.join()) {
    const refs = (idea0.refs || []).map((p) => ids.indexOf(parent.itemIds[p - 1]) + 1).filter((p) => p > 0);
    idea = { ...idea0, refs };
  }
  return {
    itemIds: [...ids],
    ...(parent.anchorId != null ? { anchorId: parent.anchorId } : {}),
    theme: parent.theme,
    jump: parent.jump,
    ...(parent.mode ? { mode: parent.mode } : {}),
    idea,
    source,
    evidence: idea.evidence || 'ok',
    parentUid: parent.uid,
    regraft: kind,
    createdAt: now,
  };
}

/** 再嫁接一根：有模型走一次调用（失败退回离线），没模型直接离线 */
export async function regraft(s: Settings | null, parent: Development, items: Item[], kind: RegraftKind, opts: { signal?: AbortSignal; rand?: () => number } = {}): Promise<{ idea: Idea; source: 'ai' | 'offline'; temperature?: number; error?: string }> {
  if (s && items.length) {
    const p = buildRegraftPrompt(parent.idea, items, kind);
    try {
      const out = await chat(
        s,
        [
          { role: 'system', content: p.system },
          { role: 'user', content: p.user },
        ],
        { temperature: p.temperature, maxTokens: 1200, signal: opts.signal },
      );
      const idea = normalizeRegraft(parseJSONLoose(out), parent.idea, items, kind);
      if (idea) return { idea, source: 'ai', temperature: p.temperature };
      return { idea: offlineRegraft(parent.idea, kind, opts.rand), source: 'offline', error: '模型没有按格式回答' };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      return { idea: offlineRegraft(parent.idea, kind, opts.rand), source: 'offline', error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { idea: offlineRegraft(parent.idea, kind, opts.rand), source: 'offline' };
}

/** 新枝页的树：父枝 uid → 子枝（按时间）；父枝不在了（删了 / 回收站）的子枝当独立的一根 */
export function branchTree(devs: Development[]): { roots: Development[]; children: Map<string, Development[]> } {
  const uids = new Set(devs.map((d) => d.uid).filter(Boolean) as string[]);
  const children = new Map<string, Development[]>();
  const roots: Development[] = [];
  for (const d of devs) {
    if (d.parentUid && uids.has(d.parentUid) && d.parentUid !== d.uid) {
      const arr = children.get(d.parentUid) || [];
      arr.push(d);
      children.set(d.parentUid, arr);
    } else roots.push(d);
  }
  for (const arr of children.values()) arr.sort((a, b) => a.createdAt - b.createdAt);
  return { roots, children };
}

// ——— 0204 新枝追问 ———

export const FOLLOWUP_MAX = 20;
export function buildFollowupPrompt(dev: Pick<Development, 'idea' | 'followups'>, items: Item[], q: string): { system: string; user: string } {
  const system = [
    '你只为这一个人的私人收藏工作。回答关于下面这根新枝的追问。',
    '只能用给出的素材（方括号里 # 后面的数字是素材 ID），不许引入外部作品、名人名作或泛泛建议；证据不够就直说。',
    '回答 200 字内，具体到怎么做（画面 / 声音 / 结构 / 第一步）；用到哪件素材就在句子里写 [#ID]。',
    '不要输出思考过程，只输出一个 JSON 对象：{"answer":"…","refs":[素材ID]}',
  ].join('\n');
  const prev = (dev.followups || []).slice(-3).map((f) => `问：${f.q}\n答：${f.a}`);
  const user = [
    '素材：',
    items.map((it, i) => describeForGraft(it, i)).join('\n\n'),
    `新枝：《${dev.idea.title.replace(/^《|》$/g, '')}》（${dev.idea.form || '形式未定'}）\n${dev.idea.idea}`,
    prev.length ? '之前问过：\n' + prev.join('\n\n') : '',
    `这次问：${q}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, user };
}
/** 回答里的 [#ID] 换成《标题》，refs 只认这批里真的有的 */
export function normalizeFollowup(raw: unknown, text: string, items: Item[]): { a: string; refs: number[] } | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  let a = o && typeof o.answer === 'string' ? o.answer.trim() : '';
  if (!a && !o) a = text.replace(/```[\s\S]*?```/g, '').trim();
  if (!a) return null;
  const ids = evidenceIds(items);
  const mentioned = [...a.matchAll(/\[#?(\d+)\]/g)].map((m) => Number(m[1]));
  const chk = checkRefs([...(Array.isArray(o?.refs) ? (o!.refs as unknown[]) : []), ...mentioned], ids);
  a = a.replace(/\[#?(\d+)\]/g, (_m, n: string) => {
    const pos = ids.indexOf(Number(n));
    return pos >= 0 ? `《${items[pos].title.replace(/^《|》$/g, '').slice(0, 16)}》` : '';
  });
  return { a: a.slice(0, 600), refs: chk.refs };
}
export function offlineFollowup(dev: Pick<Development, 'idea'>, items: Item[], q: string): Followup {
  const names = items.slice(0, 3).map((it) => `《${it.title.replace(/^《|》$/g, '').slice(0, 14)}》`);
  const a = `没连模型，先给你一个离线的路子：回到这根新枝的根 ${names.join('')}，${/开头|第一/.test(q) ? '开头就从其中最具体的一个细节（一个画面 / 一句话 / 一个声音）切进去' : /拍|镜头|画面/.test(q) ? '先只拍它们共有的一个动作或光线，三个镜头就够' : '先只做其中最小的一块'}；${dev.idea.experiment ? `20 分钟小实验：${dev.idea.experiment.replace(/[。.！!？?\s]+$/u, '')}` : '限时 20 分钟，做出最粗的一版'}。`;
  return { q, a, refs: items.slice(0, 3).map((_, i) => i + 1), source: 'offline', at: Date.now() };
}
export async function askFollowup(s: Settings | null, dev: Development, items: Item[], q0: string, signal?: AbortSignal): Promise<Followup> {
  const q = q0.trim().slice(0, 120);
  if (!q) throw new AIError('先写一句要问什么');
  if (!s) return offlineFollowup(dev, items, q);
  const p = buildFollowupPrompt(dev, items, q);
  const out = await chat(
    s,
    [
      { role: 'system', content: p.system },
      { role: 'user', content: p.user },
    ],
    { temperature: 0.7, maxTokens: 700, signal },
  );
  const r = normalizeFollowup(parseJSONLoose(out), out, items);
  if (!r) throw new AIError('模型没有回答');
  return { q, a: r.a, refs: r.refs, source: 'ai', at: Date.now() };
}
export function withFollowup(list: Followup[] | undefined, f: Followup): Followup[] {
  return [...(list || []), f].slice(-FOLLOWUP_MAX);
}

// ——— 0904 落地追踪 ———

export function statusOf(d: Pick<Development, 'status'>): BranchStatus {
  return d.status && STATUS_ORDER.includes(d.status) ? d.status : 'seed';
}
export function statusCounts(devs: Array<Pick<Development, 'status'>>): Record<BranchStatus, number> {
  const out: Record<BranchStatus, number> = { seed: 0, tried: 0, done: 0, dropped: 0 };
  for (const d of devs) out[statusOf(d)]++;
  return out;
}
/** 结果穗：一张图 + 一句话，标签「新枝结果」，为什么里写是哪根新枝 */
export function resultItem(dev: Pick<Development, 'idea'>, imageData: string | undefined, note: string): Omit<Item, 'id' | 'createdAt' | 'updatedAt'> {
  const t = dev.idea.title.replace(/^《|》$/g, '');
  return {
    type: imageData ? 'image' : 'idea',
    title: note.trim().slice(0, 40) || `「${t}」的结果`,
    ...(imageData ? { image: imageData } : {}),
    content: note.trim() || undefined,
    why: `新枝「${t}」动手做出来的结果`,
    tags: ['新枝结果'],
    source: '新枝',
  };
}
