import { chat, parseJSONLoose } from './ai';
import { pickOblique } from './oblique';
import type { Settings } from './settings';
import { TYPE_LABEL, type Idea, type Item } from './types';

export function describeItem(it: Item, idx: number): string {
  const head = `【素材${idx + 1}·${TYPE_LABEL[it.type]}】${it.title}`;
  const parts = [head];
  if (it.creator) parts.push(`作者/创作者：${it.creator}`);
  if (it.year) parts.push(`年份：${it.year}`);
  if (it.content) parts.push(`内容：${it.content.slice(0, 400)}`);
  if (it.caption) parts.push(`画面：${it.caption.slice(0, 200)}`);
  if (it.url) parts.push(`链接：${it.url}`);
  if (it.why) parts.push(`为什么打动我：${it.why}`);
  if (it.tags.length) parts.push(`标签：${it.tags.join('、')}`);
  return parts.join('\n');
}

export function buildPrompt(items: Item[], opts: { theme?: string; oblique: string; taste?: string }): { system: string; user: string } {
  const system = [
    '你是一个反套路的创意显影师。你只能使用用户自己收藏的素材来提炼创意，不能引入大众化的流行梗、鸡汤、常见营销套路。',
    '工作方法（必须按顺序在心里完成）：',
    '1. 先列出面对这些素材，大多数人和大多数AI会想到的 5 个最常见、最平庸的创意方向（套路清单）。',
    '2. 这些套路全部禁止使用，连近义改写也不行。',
    '3. 找出素材之间隐秘的、反直觉的联系（结构、节奏、情绪、隐喻、材料、动作上的同构），而不是表面题材的相似。',
    '4. 应用给定的「斜策略」作为强制约束。',
    '5. 产出一个具体、可执行、有画面感的创意，像给一个真实创作者的提案。',
    '只输出一个 JSON 对象，不要输出其他文字。字段：',
    '{"cliches":["套路1","套路2","套路3","套路4","套路5"],"title":"创意标题(12字内,不要用冒号)","bridge":"素材之间的隐秘联系(60-120字)","idea":"创意正文(150-260字,具体到画面/声音/结构)","form":"适合的形式(如短片/歌/海报/装置/文案/游戏)","firstStep":"今天30分钟内就能做的第一步","oblique":"实际使用的斜策略"}',
  ].join('\n');
  const user = [
    opts.theme ? `我这次想做的方向：${opts.theme}` : '我这次没有指定方向，请自由显影。',
    `斜策略：${opts.oblique}`,
    opts.taste ? `我的口味画像（参考，不要复述）：${opts.taste.slice(0, 500)}` : '',
    '素材如下：',
    items.map(describeItem).join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, user };
}

export function normalizeIdea(raw: unknown, oblique: string): Idea | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const idea: Idea = {
    title: str(r.title) || '未命名显影',
    bridge: str(r.bridge),
    idea: str(r.idea),
    form: str(r.form) || undefined,
    firstStep: str(r.firstStep || r.first_step) || undefined,
    cliches: Array.isArray(r.cliches) ? r.cliches.map((x) => String(x)).filter(Boolean).slice(0, 8) : [],
    oblique: str(r.oblique) || oblique,
  };
  if (!idea.idea && !idea.bridge) return null;
  return idea;
}

export async function developWithAI(s: Settings, items: Item[], opts: { theme?: string; taste?: string; rand?: () => number }): Promise<Idea> {
  const oblique = pickOblique(opts.rand);
  const { system, user } = buildPrompt(items, { theme: opts.theme, oblique, taste: opts.taste });
  const out = await chat(s, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  const parsed = normalizeIdea(parseJSONLoose(out), oblique);
  if (parsed) return parsed;
  // model ignored JSON: keep its text
  return { title: '显影结果', bridge: '', idea: out.slice(0, 1200), cliches: [], oblique };
}

const FORMS = ['一分钟短片', '一首歌的副歌', '一张海报', '一段旁白', '一个房间装置', '一组三张照片', '一条朋友圈文案', '一个小游戏的玩法'];

/** Offline development: no AI, deterministic-ish structured prompt card from the items themselves. */
export function developOffline(items: Item[], opts: { theme?: string; rand?: () => number } = {}): Idea {
  const rand = opts.rand || Math.random;
  const oblique = pickOblique(rand);
  const form = FORMS[Math.floor(rand() * FORMS.length)];
  const names = items.map((i) => `《${i.title}》`).join(' × ');
  const whys = items.map((i) => i.why).filter(Boolean) as string[];
  const tags = Array.from(new Set(items.flatMap((i) => i.tags))).slice(0, 6);
  const bridge = whys.length
    ? `你说过：「${whys.join('」「')}」。这几句话放在一起，指向同一种你反复被击中的东西。`
    : `${names} 表面上毫无关系。试着只看它们的节奏、温度和留白。`;
  const idea = [
    `把 ${names} 压进${form}。`,
    `取第一件素材的结构，第二件素材的情绪${items[2] ? '，第三件素材的材质' : ''}。`,
    tags.length ? `可用的线索：${tags.join(' / ')}。` : '',
    `约束：${oblique}。`,
    opts.theme ? `方向：${opts.theme}。` : '',
  ]
    .filter(Boolean)
    .join('');
  return {
    title: `${items[0]?.title.slice(0, 5) || '无题'}×${items[1]?.title.slice(0, 5) || '无题'}`,
    bridge,
    idea,
    form,
    firstStep: '拿一张纸，把每件素材最打动你的那一秒写成一句话，然后划掉最顺口的那句。',
    cliches: [],
    oblique,
  };
}
