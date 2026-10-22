// v0.11 一次三枝：四步嫁接 MAP → DIVERGE → DEFIX → CONVERGE。
// 依据 research/perplexity_report_raw_part2.md「A better generation pipeline」+ Prompt template（PHASE A–D）。
// 为适应智谱免费模型限流：四步压成 2 次调用（A+B 一次、C+D 一次），每次带重试与退避。
// 没配 key / 调用失败时，离线同样走四步，确定性地出 3 根变形法两两不同的新枝。
import { AIError, chat, parseJSONLoose } from './ai';
import { graftCount, modeBrief, modeDef, oppositeWords, vibeOf, vibeWords, type GraftMode } from './modes';
import { pickOblique } from './oblique';
import { checkRefs, evidenceClean, evidenceIds, minEvidence, padRefs, weakNote, type RefCheck } from './provenance';
import type { Settings } from './settings';
import { TYPE_LABEL, type GraftSeed, type GraftTension, type Idea, type Item, type ItemType } from './types';

export interface Transform {
  id: string;
  name: string;
  hint: string; // 给模型看的解释
  short: string; // 离线标题前缀
  experiment: string; // 离线 / 兜底的 20 分钟小实验
}

export const TRANSFORMS: Transform[] = [
  { id: 'invert', name: '反转', hint: '把关系、方向、因果或主次倒过来', short: '倒过来的', experiment: '把两件素材各写成三句话，再把每一句的主语和宾语对调，留下最别扭的那一句。' },
  { id: 'medium', name: '换媒介', hint: '把它搬进另一种媒介（声音→画面、电影→物件、文字→动作）', short: '换个身体的', experiment: '用手机录 60 秒声音或拍 3 张照片来表达其中一件素材，不许出现它原本的样子。' },
  { id: 'eras', name: '撞年代', hint: '把它放进一个完全不同的年代，用那个年代才有的东西重做', short: '隔世的', experiment: '随手翻一本书指一个年份，只用那个年代就有的材料，写下这个点子的三行描述。' },
  { id: 'remove', name: '拿掉最显眼的', hint: '拿掉素材里最显眼、最被记住的那个元素，看剩下的还能不能成立', short: '少一样的', experiment: '把素材里最显眼的元素遮住或删掉，用 100 字写下剩下的东西还能说什么。' },
  { id: 'scale', name: '换尺度', hint: '缩到掌心大小，或放大到整座城市 / 一整年', short: '换了尺寸的', experiment: '画一张火柴盒大小的草图和一张 A4 大小的草图，比较哪一个更有意思。' },
  { id: 'material', name: '材料限制', hint: '强加一个具体的材料或工具限制（只用纸 / 只用一种颜色 / 只用环境音）', short: '只用一样东西的', experiment: '只用一张 A4 纸和一支笔，20 分钟内做出这个点子的样稿。' },
  { id: 'viewpoint', name: '换视角', hint: '换一个讲述者：配角、物件、旁观者、未来的自己', short: '从旁边看的', experiment: '挑素材里一件不起眼的小物件，用它的第一人称写 5 句话。' },
  { id: 'flaw', name: '保留瑕疵', hint: '把最笨拙、走调、跑焦的那一点留下，甚至放大成主角', short: '不修的', experiment: '故意把这件事做坏一次（走音、手抖、跑焦）并录下来，看三遍，找出想保留的那一秒。' },
];

const T_BY_ID = new Map(TRANSFORMS.map((t) => [t.id, t]));

export function transformName(id: string | undefined): string {
  return (id && T_BY_ID.get(id)?.name) || id || '';
}

/** 模型可能回 id、中文名或带说明的字符串，统一成 id */
export function resolveTransform(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (T_BY_ID.has(s)) return s;
  for (const t of TRANSFORMS) if (s.includes(t.id) || v.includes(t.name)) return t.id;
  // 常见同义说法
  const alias: Array<[RegExp, string]> = [
    [/倒置|颠倒|反过来/, 'invert'],
    [/媒介|媒体|形式迁移/, 'medium'],
    [/年代|时代|穿越/, 'eras'],
    [/拿掉|去掉|删掉|减法/, 'remove'],
    [/尺度|尺寸|缩小|放大/, 'scale'],
    [/材料|限制|约束/, 'material'],
    [/视角|观点|第一人称/, 'viewpoint'],
    [/瑕疵|缺陷|错误|笨拙/, 'flaw'],
  ];
  for (const [re, id] of alias) if (re.test(v)) return id;
  return null;
}

// ——— 文本相似度（离线 DEFIX / 收拢用）———
function bigrams(s: string): Set<string> {
  const t = s.replace(/[\s，。、《》「」：:；;！!？?,.\-—…·（）()]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
export function textSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

/** 三枝的变形法是否两两不同 */
export function transformsDistinct(branches: Idea[]): boolean {
  const ts = branches.map((b) => b.transform || '');
  return ts.every(Boolean) && new Set(ts).size === ts.length;
}

// ——— prompt ———
const FORBIDDEN = '禁用词与框架：沉浸式、旅程、交织、融合、碰撞出火花、灵魂、治愈、氛围感、赋能、打破边界、时光的、岁月的、独一无二；以及任何素材里没有依据的说法。';

/** 每件素材前面标上它的素材 ID（穗在库里的真实 id），模型必须用这个 ID 引用 */
export function describeForGraft(it: Item, idx: number): string {
  const id = typeof it.id === 'number' ? it.id : idx + 1;
  const parts = [`[#${id} | ${TYPE_LABEL[it.type]}${it.tags.length ? ` | 标签：${it.tags.slice(0, 6).join('、')}` : ''}] ${it.title}`];
  if (it.creator) parts.push(`作者：${it.creator}`);
  if (it.year) parts.push(`年份：${it.year}`);
  if (it.content) parts.push(`内容：${it.content.slice(0, 240)}`);
  if (it.caption) parts.push(`画面：${it.caption.slice(0, 160)}`);
  if (it.why) parts.push(`为什么打动我：${it.why}`);
  return parts.join('\n');
}

function minRefs(n: number) {
  return minEvidence(n);
}

/** 把位置列表写成给模型看的素材 ID（#12、#57） */
function idList(refs: number[], ids: number[]): string {
  return refs.map((r) => `#${ids[r - 1] ?? r}`).join('、');
}

type Ctx = { theme?: string; oblique: string; taste?: string; mode?: GraftMode };

function context(items: Item[], opts: Ctx) {
  return [
    modeBrief(opts.mode, items),
    opts.theme ? `创作方向：${opts.theme}` : '创作方向：没有指定，自由嫁接。',
    `斜策略（作为额外约束）：${opts.oblique}`,
    opts.taste ? `我的口味（参考，不要复述）：${opts.taste.slice(0, 400)}` : '',
    '素材（只能用这些；方括号里 # 后面的数字是素材 ID）：',
    items.map(describeForGraft).join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

const SYS_HEAD = [
  '你是只为一个人的私人收藏工作的「嫁接器」：把相距很远的几件素材嫁接出新枝。',
  '只能使用给出的素材。不要引入大众流行梗、名人名作、行业套路或泛泛建议。证据不够就直说。',
  '不要输出思考过程，只输出要求的 JSON。',
  FORBIDDEN,
].join('\n');

export function buildMapPrompt(items: Item[], opts: Ctx): { system: string; user: string } {
  const k = minRefs(items.length);
  const system = [
    SYS_HEAD,
    '这一次只做 PHASE A 和 PHASE B，不要写完整创意，不要排序。',
    opts.mode ? `这次按「${modeDef(opts.mode)?.name}」接法抽的穗（规则与要求见用户消息开头），张力和种子都要照这个接法的要求来。` : '',
    'PHASE A — MAP：找出 4 个素材之间的张力或意外的桥（结构、节奏、情绪、材料、动作上的同构或冲突，而不是表面题材相似），每个标出依据的素材 ID。',
    `PHASE B — DIVERGE：写 8 粒一句话种子（每粒不超过 45 字）。8 种变形法每种恰好用一次：`,
    ...TRANSFORMS.map((t) => `- ${t.id}（${t.name}）：${t.hint}`),
    `每粒种子至少引用 ${k} 件素材 ID（写方括号里 # 后面的数字，#12 就写 12；不许写不存在的 ID）。`,
    '只输出一个 JSON 对象：',
    '{"tensions":[{"text":"张力（40字内）","refs":[素材ID,素材ID]}],"seeds":[{"t":"invert","text":"一句话种子","refs":[素材ID,素材ID,素材ID]}]}',
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user: context(items, opts) };
}

export function buildConvergePrompt(
  items: Item[],
  opts: Ctx,
  tensions: GraftTension[],
  seeds: GraftSeed[],
  recheck?: string,
): { system: string; user: string } {
  const k = minRefs(items.length);
  const ids = evidenceIds(items);
  const system = [
    SYS_HEAD,
    '这一次做 PHASE C 和 PHASE D。',
    `PHASE C — DEFIX：看下面 8 粒种子，用一句话指出它们重复的结构、场景、语气或动词（pattern）；把最相像的 3 粒换成落在完全不同语义区域的新种子。新种子沿用被换掉那粒的变形法，仍至少引用 ${k} 件素材 ID。`,
    opts.mode ? `三根新枝都必须满足「${modeDef(opts.mode)?.name}」接法的要求（见用户消息开头）。` : '',
    'PHASE D — CONVERGE：从换过之后的 8 粒里，选 3 粒彼此最不一样、且变形法两两不同的，各长成一根新枝。挑选标准：证据扎实、在这一批里新、对我有用、做得出来、忠于这些素材。',
    '每根新枝给出：seed（种子编号 1-8）、title（12 字内，不要冒号）、idea（100-180 字，具体到画面 / 声音 / 结构）、form（形式，如短片 / 歌 / 海报 / 装置 / 文案 / 游戏）、refs（这根新枝真正用到的素材 ID，至少 ${k} 个，只能是上面方括号里的数字）、unlike（它和另外两根哪里不同，40 字内）、experiment（我 20 分钟内就能完成的一个小实验）。',
    'idea 正文里用到哪件素材，就点出它的名字（如《花样年华》），方便我对照。说不出依据的新枝宁可不写。',
    '再列出 3-5 个这组素材最容易落入的套路（cliches），三根新枝都必须避开。',
    recheck ? `注意：上一次的回答里${recheck}。这一次每根新枝的 refs 必须是至少 ${k} 个真实存在的素材 ID。` : '',
    '只输出一个 JSON 对象：',
    '{"pattern":"…","replaced":[{"n":2,"text":"新种子","refs":[素材ID,素材ID,素材ID]}],"branches":[{"seed":1,"title":"…","idea":"…","form":"…","refs":[素材ID,素材ID,素材ID],"unlike":"…","experiment":"…"}],"cliches":["…"]}',
  ]
    .filter(Boolean)
    .join('\n');
  const user = [
    context(items, opts),
    'PHASE A 找到的张力：',
    tensions.map((t, i) => `${i + 1}. ${t.text}${t.refs.length ? `（${idList(t.refs, ids)}）` : ''}`).join('\n'),
    'PHASE B 的 8 粒种子：',
    seeds.map((s, i) => `${i + 1}. [${s.transform}/${transformName(s.transform)}] ${s.text}${s.refs.length ? `（${idList(s.refs, ids)}）` : ''}`).join('\n'),
  ].join('\n\n');
  return { system, user };
}

// ——— 解析与修复 ———
class ParseError extends Error {}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** ids：这次嫁接素材的 ID 表（数字 n 表示 ID 就是 1..n）。模型写的是素材 ID，返回的是位置（1 起）。 */
type IdsArg = number | number[];
function idsOf(v: IdsArg): number[] {
  return Array.isArray(v) ? v : Array.from({ length: v }, (_, i) => i + 1);
}

export function normalizeRefs(v: unknown, ids: IdsArg): number[] {
  return checkRefs(v, idsOf(ids)).refs;
}

/** 第 1 次调用的结果：4 个张力、8 粒种子（变形法去重、补齐） */
export function normalizeMap(raw: unknown, idsArg: IdsArg): { tensions: GraftTension[]; seeds: GraftSeed[] } {
  if (!raw || typeof raw !== 'object') throw new ParseError('模型没有按格式回答（张力 / 种子）');
  const nItems = idsOf(idsArg);
  const r = raw as Record<string, unknown>;
  const tensions: GraftTension[] = (Array.isArray(r.tensions) ? r.tensions : [])
    .map((t) => {
      const o = (t && typeof t === 'object' ? t : { text: t }) as Record<string, unknown>;
      // 说不出依据就留空，不替模型编
      return { text: str(o.text || o.tension), refs: normalizeRefs(o.refs, nItems) };
    })
    .filter((t) => t.text)
    .slice(0, 4);
  const used = new Set<string>();
  const pending: GraftSeed[] = [];
  const seeds: GraftSeed[] = [];
  (Array.isArray(r.seeds) ? r.seeds : []).forEach((x) => {
    const o = (x && typeof x === 'object' ? x : { text: x }) as Record<string, unknown>;
    const text = str(o.text || o.seed);
    if (!text) return;
    const seed: GraftSeed = { text, transform: resolveTransform(o.t ?? o.transform) || '', refs: normalizeRefs(o.refs, nItems) };
    if (seed.transform && !used.has(seed.transform)) {
      used.add(seed.transform);
      seeds.push(seed);
    } else pending.push(seed);
  });
  // 变形法重复或缺失的种子：分给还没用过的变形法，保证 8 种各一次
  for (const s of pending) {
    const free = TRANSFORMS.find((t) => !used.has(t.id));
    if (!free) break;
    used.add(free.id);
    seeds.push({ ...s, transform: free.id });
  }
  if (seeds.length < 3) throw new ParseError('模型给的种子太少');
  return { tensions, seeds: seeds.slice(0, 8) };
}

/** DEFIX：按模型给的编号把最相像的种子换掉（最多 3 粒），沿用原变形法 */
export function applyDefix(seeds: GraftSeed[], replaced: unknown, nItems: IdsArg): GraftSeed[] {
  const out = seeds.map((s) => ({ ...s }));
  let n = 0;
  for (const x of Array.isArray(replaced) ? replaced : []) {
    if (n >= 3 || !x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const idx = parseInt(str(o.n ?? o.index ?? o.seed), 10) - 1;
    const text = str(o.text || o.seed_text || o.new);
    if (!(idx >= 0 && idx < out.length) || !text || out[idx].replaced) continue;
    const refs = normalizeRefs(o.refs, nItems);
    out[idx] = { ...out[idx], text, refs: refs.length ? refs : out[idx].refs, replaced: true };
    n++;
  }
  return out;
}

/** 本地收拢：贪心选 k 粒变形法两两不同、文字最不相像的种子（返回下标） */
export function localConverge(seeds: GraftSeed[], k = 3, exclude: number[] = [], usedTransforms: string[] = []): number[] {
  const chosen = [...exclude];
  const used = new Set(usedTransforms);
  const picked: number[] = [];
  while (picked.length < k) {
    let best = -1;
    let bestScore = Infinity;
    seeds.forEach((s, i) => {
      if (chosen.includes(i) || used.has(s.transform)) return;
      const score = chosen.length ? Math.max(...chosen.map((c) => textSimilarity(s.text, seeds[c].text))) : i * 0.001;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) break;
    chosen.push(best);
    used.add(seeds[best].transform);
    picked.push(best);
  }
  return picked;
}

function computeUnlike(t: string, others: string[]): string {
  return `它走「${transformName(t)}」，另外两根走「${others.map(transformName).join('」「')}」。`;
}

/** 收尾：补上「哪里不同」「小实验」，标记被选中的种子 */
function finishBranches(branches: Idea[], seeds: GraftSeed[], chosenIdx: number[]): { branches: Idea[]; seeds: GraftSeed[] } {
  const done = branches.map((b, i) => {
    const others = branches.filter((_, j) => j !== i).map((x) => x.transform || '');
    return {
      ...b,
      unlike: b.unlike || computeUnlike(b.transform || '', others),
      experiment: b.experiment || T_BY_ID.get(b.transform || '')?.experiment,
      firstStep: b.firstStep || b.experiment || T_BY_ID.get(b.transform || '')?.experiment,
    };
  });
  return { branches: done, seeds: seeds.map((s, i) => ({ ...s, chosen: chosenIdx.includes(i) || undefined })) };
}

/** 第 2 次调用的结果 → 3 根变形法两两不同的新枝；模型给不够或撞了变形，就从剩下的种子里本地补 */
export function normalizeConverge(
  raw: unknown,
  seedsIn: GraftSeed[],
  items: Item[],
  oblique: string,
): { branches: Idea[]; seeds: GraftSeed[]; pattern?: string; cliches: string[]; filled: number; faults: number; checks: RefCheck[] } {
  const n = items.length;
  const ids = evidenceIds(items);
  const k = minRefs(n);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const seeds = applyDefix(seedsIn, r.replaced, ids);
  const checks: RefCheck[] = [];
  let faults = 0;
  const cliches = Array.isArray(r.cliches) ? r.cliches.map((x) => str(x)).filter(Boolean).slice(0, 6) : [];
  const branches: Idea[] = [];
  const chosen: number[] = [];
  for (const x of Array.isArray(r.branches) ? r.branches : []) {
    if (branches.length >= 3 || !x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const si = parseInt(str(o.seed ?? o.n), 10) - 1;
    const seed = si >= 0 && si < seeds.length ? seeds[si] : undefined;
    const t = seed?.transform || resolveTransform(o.transform ?? o.t) || '';
    const body = str(o.idea || o.concept);
    if (!t || !body || branches.some((b) => b.transform === t)) continue;
    // 溯源：只认模型真的写出来、且确实存在的素材 ID；不够 k 件或编了 ID 就记一次不合格
    const chk = checkRefs(o.refs, ids);
    const clean = evidenceClean(chk, k);
    if (!clean) faults++;
    checks.push(chk);
    branches.push({
      title: (str(o.title) || seed?.text.slice(0, 12) || '新枝').replace(/[:：]/g, ' '),
      bridge: seed?.text || '',
      idea: body,
      form: str(o.form) || undefined,
      cliches,
      oblique,
      transform: t,
      unlike: str(o.unlike) || undefined,
      experiment: str(o.experiment) || undefined,
      refs: chk.refs,
      evidence: clean ? 'ok' : 'weak',
      evidenceNote: clean ? undefined : weakNote(chk, k),
    });
    if (seed) chosen.push(si);
    else {
      const k = seeds.findIndex((s) => s.transform === t);
      if (k >= 0) chosen.push(k);
    }
  }
  let filled = 0;
  if (branches.length < 3) {
    const more = localConverge(seeds, 3 - branches.length, chosen, branches.map((b) => b.transform!));
    for (const i of more) {
      branches.push(branchFromSeed(seeds[i], items, oblique, branches.length));
      chosen.push(i);
      filled++;
    }
  }
  const fin = finishBranches(branches, seeds, chosen);
  return { ...fin, pattern: str(r.pattern) || undefined, cliches, filled, faults, checks };
}

// ——— 离线素材拼装 ———
const q = (it?: Item) => (it ? `《${it.title.replace(/^《|》$/g, '').slice(0, 14)}》` : '《无题》');
const OTHER_MEDIUM: Record<ItemType, string> = {
  music: '一组三张照片',
  film: '一首只有副歌的歌',
  image: '一段 30 秒的环境声',
  text: '一个可以拿在手里的小物件',
  link: '一张手写便签',
  idea: '一分钟短片',
};
const FORMS = ['一分钟短片', '一首歌的副歌', '一张海报', '一段旁白', '一个房间装置', '一组三张照片', '一条朋友圈文案', '一个小游戏的玩法'];

function clue(it?: Item): string {
  if (!it) return '那点留白';
  if (it.why) return `「${it.why.slice(0, 18)}」`;
  if (it.tags.length) return `「${it.tags[0]}」`;
  return `那份${TYPE_LABEL[it.type]}的节奏`;
}

/** 每种变形法两个句式（第 2 个用于离线 DEFIX 换种子） */
function seedText(t: string, a: Item, b: Item, c: Item | undefined, alt: boolean): string {
  const A = q(a);
  const B = q(b);
  switch (t) {
    case 'invert':
      return alt ? `把${A}的结尾放到开头，让${B}成为倒叙里唯一的线索。` : `让${B}来讲${A}的故事：原本被看的那一方，反过来看人。`;
    case 'medium':
      return alt ? `${A}不再是${TYPE_LABEL[a.type]}，而是一张地图；${B}标出地图上没人去的地方。` : `把${A}翻成${OTHER_MEDIUM[a.type]}，只留下${B}里的${clue(b)}。`;
    case 'eras':
      return alt ? `${A}发生在三十年后的一个早晨，${B}是那时人们唯一还记得的老东西。` : `把${A}搬到一百年前，只用那时就有的东西，重做${B}里的${clue(b)}。`;
    case 'remove':
      return alt ? `${B}里最让人记住的那一样整个消失，换成${A}里一个不起眼的细节。` : `拿掉${A}最显眼的部分，只用${B}剩下的${clue(b)}撑住整件事。`;
    case 'scale':
      return alt ? `把${A}放大到整座城市的尺度，${B}是城市里每扇窗都亮着的同一盏灯。` : `把${A}缩进一个火柴盒，${B}是盒盖上的一行小字。`;
    case 'material':
      return alt ? `只用环境音（没有一个音符）重做${A}，${B}决定录音的地点。` : `只用一张纸、一支笔做${A}×${B}，${c ? `${q(c)}决定纸怎么折。` : '不许用别的。'}`;
    case 'viewpoint':
      return alt ? `二十年后的你回头看${A}，只记得${B}里的${clue(b)}。` : `从${A}里最不起眼的一件小东西的视角，看${B}发生。`;
    case 'flaw':
      return alt ? `${B}拍糊的那一张、唱破的那一句，正好是${A}缺的那块。` : `${A}里最笨拙的那一点不修，放大成${B}的主旋律。`;
    default:
      return `${A} × ${B}`;
  }
}

/** v0.18 离线：每种接法第一条张力说清这一组为什么这样抽 */
export function modeTension(mode: GraftMode, items: Item[]): GraftTension {
  const all = items.map((_, i) => i + 1);
  const [a, b] = items;
  switch (mode) {
    case 'near':
      return { text: `${q(a)}和${q(b)}气质很近：要找的是它们之间最细的那一点不同。`, refs: [1, 2] };
    case 'far':
      return { text: `${q(a)}和${q(b)}几乎不搭：桥不在题材上，在节奏和动作上。`, refs: [1, 2] };
    case 'neglected':
      return { text: `这几穗很少被接（${items.map((it) => `${q(it)} ${graftCount(it)} 次`).join('、')}）：先看它们被忽略的那一点。`, refs: all };
    case 'cross': {
      const ts = [...new Set(items.map((i) => TYPE_LABEL[i.type]))];
      return { text: `${ts.length} 种媒介：${ts.join('、')}。每根新枝都要跨过至少两种，形式也不能是其中任何一种。`, refs: all };
    }
    case 'anti': {
      const v = vibeOf(a);
      const w = vibeWords(v);
      return {
        text: w.length ? `${q(a)}是「${w.join('、')}」的，把它的反面「${oppositeWords(v).join('、')}」接上去，不调和。` : `以${q(a)}为锚，把它的反面接上去，不调和成中间态。`,
        refs: [1, ...(items.length > 1 ? [2] : [])],
      };
    }
  }
}

function tensionTexts(items: Item[], mode?: GraftMode): GraftTension[] {
  const n = items.length;
  const out: GraftTension[] = mode ? [modeTension(mode, items)] : [];
  for (let i = 0; out.length < 4; i++) {
    const ai = i % n;
    const bi = (i + 1) % n;
    const a = items[ai];
    const b = items[bi];
    let text: string;
    if (i === 0) text = `${q(a)}的${clue(a)}，和${q(b)}的${clue(b)}，在互相拉扯。`;
    else if (i === 1) text = a.type !== b.type ? `一件是${TYPE_LABEL[a.type]}、一件是${TYPE_LABEL[b.type]}：一个靠时间展开，一个靠一眼看完。` : `同是${TYPE_LABEL[a.type]}，${q(a)}和${q(b)}的快慢正好相反。`;
    else if (i === 2) text = a.why && b.why ? `你说「${a.why.slice(0, 16)}」，又说「${b.why.slice(0, 16)}」：像是同一种被击中的方式。` : `${q(a)}留下的空白，正好能装下${q(b)}。`;
    else text = a.year && b.year && a.year !== b.year ? `${a.year} 和 ${b.year}：隔着这些年，它们在说同一件小事。` : `把${q(a)}和${q(b)}都去掉题材，只剩下节奏和温度。`;
    out.push({ text, refs: Array.from(new Set([ai + 1, bi + 1])) });
  }
  return out;
}

function seedFor(t: string, i: number, items: Item[], alt: boolean): GraftSeed {
  const n = items.length;
  const ai = (i + (alt ? 1 : 0)) % n;
  const bi = (ai + 1) % n;
  const ci = n >= 3 ? (ai + 2) % n : -1;
  const refs = Array.from(new Set([ai + 1, bi + 1, ...(ci >= 0 ? [ci + 1] : [])]));
  return { text: seedText(t, items[ai], items[bi], ci >= 0 ? items[ci] : undefined, alt), transform: t, refs };
}

/** 从一粒种子长成一根新枝（离线 / 兜底） */
export function branchFromSeed(seed: GraftSeed, items: Item[], oblique: string, k: number, theme?: string, mode?: GraftMode): Idea {
  const t = T_BY_ID.get(seed.transform);
  // 溯源：正文就是用这几穗拼出来的，所以补到至少 3 穗，并且三穗都写进正文
  const refs = padRefs(seed.refs, items.length);
  const [a, b, c] = refs.map((r) => items[r - 1]);
  const form = FORMS[(TRANSFORMS.findIndex((x) => x.id === seed.transform) + k * 3) % FORMS.length];
  const idea = [
    seed.text,
    `做成${form}：取${q(a)}的结构、${q(b)}的情绪${c ? `、${q(c)}的材质` : ''}。`,
    t ? `这一根的变形是「${t.name}」——${t.hint}。` : '',
    modeLine(mode, items),
    `约束：${oblique}。`,
    theme ? `方向：${theme}。` : '',
  ]
    .filter(Boolean)
    .join('');
  return {
    title: `${t?.short || ''}${a.title.replace(/^《|》$/g, '').slice(0, 6)}`,
    bridge: seed.text,
    idea,
    form,
    cliches: [],
    oblique,
    transform: seed.transform,
    experiment: t?.experiment,
    refs,
    evidence: 'ok',
  };
}

/** v0.18 离线新枝里的一句接法说明 */
function modeLine(mode: GraftMode | undefined, items: Item[]): string {
  const m = modeDef(mode);
  if (!m) return '';
  if (mode === 'anti') {
    const w = vibeWords(vibeOf(items[0]));
    return w.length ? `接法「反氛围」：锚是${q(items[0])}的「${w.join('、')}」，这一根往「${oppositeWords(vibeOf(items[0])).join('、')}」长。` : `接法「反氛围」：以${q(items[0])}为锚，往它的反面长。`;
  }
  if (mode === 'cross') return `接法「跨媒介」：${[...new Set(items.map((i) => TYPE_LABEL[i.type]))].join(' × ')}，最后的形式不用其中任何一种。`;
  if (mode === 'neglected') return `接法「被冷落」：这几穗平时很少被接，这一根只靠它们被忽略的细节。`;
  return `接法「${m.name}」：${m.ask}`;
}

export interface GraftResult {
  /** v0.18 用了哪种接法 */
  mode?: GraftMode;
  branches: Idea[];
  tensions: GraftTension[];
  seeds: GraftSeed[];
  pattern?: string;
  source: 'ai' | 'offline';
  calls: number;
  /** AI 第 2 次调用失败、用种子在本地收拢 */
  partial?: boolean;
  /** v0.12：有新枝说不清来源，第 2 步重来了一次 */
  recheck?: boolean;
  /** 重来之后仍然证据不足的根数 */
  weak?: number;
}

/** 离线四步：张力 → 8 种变形各一粒 → 换掉最相像的 3 粒 → 收拢 3 根变形法两两不同的 */
export function graftOffline(items: Item[], opts: { theme?: string; rand?: () => number; mode?: GraftMode } = {}): GraftResult {
  const rand = opts.rand || Math.random;
  if (!items.length) throw new Error('没有穗');
  const list = items.length === 1 ? [items[0], items[0]] : items;
  const oblique = pickOblique(rand);
  const tensions = tensionTexts(list, opts.mode);
  // 随机一个起点，让同一组穗多次离线嫁接不完全一样
  const off = Math.floor(rand() * list.length);
  const rot = [...list.slice(off), ...list.slice(0, off)];
  const remap = (s: GraftSeed): GraftSeed => ({ ...s, refs: s.refs.map((r) => ((r - 1 + off) % list.length) + 1) });
  let seeds = TRANSFORMS.map((t, i) => remap(seedFor(t.id, i, rot, false)));
  // DEFIX：两两相似度最高的种子换成另一个句式
  const score = seeds.map((s, i) => Math.max(0, ...seeds.map((o, j) => (i === j ? 0 : textSimilarity(s.text, o.text)))));
  const worst = score
    .map((v, i) => [v, i] as const)
    .sort((x, y) => y[0] - x[0] || x[1] - y[1])
    .slice(0, 3)
    .map(([, i]) => i);
  seeds = seeds.map((s, i) => (worst.includes(i) ? { ...remap(seedFor(s.transform, i, rot, true)), replaced: true } : s));
  // CONVERGE：随机起点 + 贪心最不相像
  // v0.18：有接法时，第一根固定走这个接法最合适的变形（跨媒介 → 换媒介，反氛围 → 反转 …）
  const pref = opts.mode ? seeds.findIndex((s) => s.transform === modeDef(opts.mode)?.transform) : -1;
  const first = pref >= 0 ? pref : Math.floor(rand() * seeds.length);
  const rest = localConverge(seeds, 2, [first], [seeds[first].transform]);
  const chosen = [first, ...rest];
  const branches = chosen.map((i, k) => branchFromSeed(seeds[i], list, oblique, k, opts.theme, opts.mode));
  const fin = finishBranches(branches, seeds, chosen);
  return { mode: opts.mode, branches: fin.branches, seeds: fin.seeds, tensions, pattern: '同一个句式反复出现（「把…放进…」），换掉了最像的三粒。', source: 'offline', calls: 0 };
}

/** 给模型的「上一次哪里不对」 */
function describeFaults(checks: RefCheck[], k: number): string {
  const bad = checks.map((c, i) => [c, i] as const).filter(([c]) => !evidenceClean(c, k));
  return bad.map(([c, i]) => `第 ${i + 1} 根新枝${c.missing ? '没写 refs' : c.invalid ? '引用了不存在的素材 ID' : `只引用了 ${c.refs.length} 件素材`}`).join('；');
}

// ——— 重试 / 退避 ———
export function isRetryable(e: unknown): boolean {
  if (e instanceof ParseError) return true;
  if (e instanceof AIError) {
    if (e.message === '已取消') return false;
    const st = e.status;
    return st === 0 || st === 429 || (typeof st === 'number' && st >= 500);
  }
  return false;
}

export function backoffMs(attempt: number, e: unknown, rand: () => number = Math.random): number {
  const ra = e instanceof AIError ? e.retryAfterMs : undefined;
  if (ra) return Math.min(ra, 20000);
  const base = e instanceof AIError && e.status === 429 ? 2500 : 1200;
  return Math.round(Math.min(15000, base * 2 ** (attempt - 1)) * (0.8 + 0.4 * rand()));
}

export interface RetryInfo {
  attempt: number; // 第几次重试（1 起）
  waitMs: number;
  reason: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; onRetry?: (r: RetryInfo) => void; sleep?: (ms: number) => Promise<void>; rand?: () => number; signal?: AbortSignal } = {},
): Promise<T> {
  const tries = opts.tries ?? 3;
  const sleep = opts.sleep || ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i >= tries || !isRetryable(e) || opts.signal?.aborted) throw e;
      const waitMs = backoffMs(i, e, opts.rand);
      const reason = e instanceof AIError && e.status === 429 ? '田里有点挤（限流）' : e instanceof ParseError ? '回答没长全' : '风有点大（网络）';
      opts.onRetry?.({ attempt: i, waitMs, reason });
      await sleep(waitMs);
    }
  }
  throw last;
}

export type GraftStage = 'map' | 'defix' | 'done';
export interface GraftProgress {
  stage: GraftStage;
  retry?: RetryInfo;
  /** v0.12：有新枝说不清从哪几穗长出来，正在重长一次 */
  recheck?: boolean;
}

/** AI 四步嫁接：2 次调用。第 2 次失败时用第 1 次的种子本地收拢（仍是 3 根） */
export async function graftWithAI(
  s: Settings,
  items: Item[],
  opts: {
    theme?: string;
    taste?: string;
    mode?: GraftMode;
    rand?: () => number;
    signal?: AbortSignal;
    onProgress?: (p: GraftProgress) => void;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<GraftResult> {
  const oblique = pickOblique(opts.rand);
  const ctx: Ctx = { theme: opts.theme, oblique, taste: opts.taste, mode: opts.mode };
  const temp = Math.max(0.2, Math.min(1.3, s.temperature || 1));
  let calls = 0;
  const rOpts = (stage: GraftStage) => ({
    sleep: opts.sleep,
    rand: opts.rand,
    signal: opts.signal,
    onRetry: (retry: RetryInfo) => opts.onProgress?.({ stage, retry }),
  });

  opts.onProgress?.({ stage: 'map' });
  const p1 = buildMapPrompt(items, ctx);
  const map = await withRetry(async () => {
    calls++;
    const out = await chat(
      s,
      [
        { role: 'system', content: p1.system },
        { role: 'user', content: p1.user },
      ],
      { temperature: temp, maxTokens: 1500, signal: opts.signal },
    );
    return normalizeMap(parseJSONLoose(out), items.length);
  }, rOpts('map'));

  opts.onProgress?.({ stage: 'defix' });
  const converge = (recheck?: string) =>
    withRetry(async () => {
      const p2 = buildConvergePrompt(items, ctx, map.tensions, map.seeds, recheck);
      calls++;
      const out = await chat(
        s,
        [
          { role: 'system', content: p2.system },
          { role: 'user', content: p2.user },
        ],
        { temperature: Math.min(temp, 0.8), maxTokens: 2200, signal: opts.signal },
      );
      const parsed = parseJSONLoose(out);
      if (!parsed) throw new ParseError('模型没有按格式回答（新枝）');
      return normalizeConverge(parsed, map.seeds, items, oblique);
    }, rOpts('defix'));
  try {
    let conv = await converge();
    let recheck = false;
    if (conv.faults > 0) {
      // 溯源不合格：重来一次（只这一次），还不行就如实标「证据不足」
      recheck = true;
      opts.onProgress?.({ stage: 'defix', recheck: true });
      try {
        conv = await converge(describeFaults(conv.checks, minRefs(items.length)));
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        // 重来那次没跑通：保留第一次的结果，不合格的已经标好了「证据不足」
      }
    }
    opts.onProgress?.({ stage: 'done' });
    const weak = conv.branches.filter((b) => b.evidence === 'weak').length;
    return { mode: opts.mode, branches: conv.branches, seeds: conv.seeds, tensions: map.tensions, pattern: conv.pattern, source: 'ai', calls, recheck, weak };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    // 第二步没跑完：用第一步的 8 粒种子本地收拢
    const conv = normalizeConverge({}, map.seeds, items, oblique);
    opts.onProgress?.({ stage: 'done' });
    return { mode: opts.mode, branches: conv.branches, seeds: conv.seeds, tensions: map.tensions, source: 'ai', calls, partial: true };
  }
}
