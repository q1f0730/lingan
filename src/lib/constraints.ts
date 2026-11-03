// v0.30 嫁接前的约束：斜策略卡（ROADMAP v0.23：可重抽、可钉住、可写自己的卡）+ 约束骰子（0216：一条硬约束）+ 野一点。
// 卡面全是我们自己写的句子（斜策略的意思借自 Eno & Schmidt，不是原卡文字）。
import { OBLIQUE } from './oblique';
import { daySeed, mulberry32 } from './similarity';

/** 0216 约束骰子：60 条硬约束，按作品形态分组；掷出的那条写进 prompt 的「硬约束」段，新枝必须满足 */
export const CONSTRAINT_GROUPS: Array<{ id: string; name: string; list: string[] }> = [
  {
    id: 'any',
    name: '通用',
    list: [
      '只能用三种材料',
      '成品必须在 60 秒内看完 / 听完 / 读完',
      '不许出现人脸',
      '一个字都不许解释',
      '预算为零：只用手边已有的东西',
      '必须今晚就能做出第一版',
      '只能在一个房间里完成',
      '要能被一个陌生人在 10 秒内看懂',
      '结尾不许有答案',
      '必须用到一件旧物',
      '只用黑白灰',
      '整件作品只能有一个动作',
    ],
  },
  {
    id: 'film',
    name: '影像',
    list: [
      '全片一个镜头，不剪',
      '没有对白',
      '摄影机不许动',
      '只拍手',
      '只用手机竖拍',
      '每个镜头不超过 2 秒',
      '只在夜里拍',
      '画外音和画面说的是两件事',
      '只拍影子',
      '倒放成片',
      '只用一盏灯',
      '主角始终背对镜头',
    ],
  },
  {
    id: 'sound',
    name: '声音',
    list: [
      '只用人声，不用乐器',
      '全曲只有两个和弦',
      '必须用到一段现场录音',
      '副歌一句歌词都没有',
      'BPM 固定 60',
      '从头到尾不许有鼓',
      '只用一件乐器',
      '歌词只能用名词',
      '前 30 秒完全安静',
      '采样一段生活噪音当节奏',
      '必须能用口哨哼出来',
      '只录一遍，不修音',
    ],
  },
  {
    id: 'text',
    name: '文字',
    list: [
      '全文不超过 100 字',
      '不许用形容词',
      '只用对话写',
      '每句都以动词开头',
      '用第二人称「你」写',
      '不许出现「我」',
      '倒着讲：先结局后开头',
      '只用一个标点',
      '每段只有一句',
      '用一张清单代替正文',
      '题目必须比正文长',
      '只写感官，不写情绪',
    ],
  },
  {
    id: 'visual',
    name: '视觉',
    list: [
      '只用一种颜色加白',
      '画面里只能有一个元素',
      '只用文字排版，不用图',
      '必须留白一半以上',
      '只用撕纸拼贴',
      '尺寸必须是正方形',
      '只用直线',
      '必须能缩到邮票大小还认得出',
      '用一张没对焦的照片',
      '字号全部一样大',
      '只用现成的标志 / 符号拼',
      '必须看起来像说明书',
    ],
  },
];

export const ALL_CONSTRAINTS: string[] = CONSTRAINT_GROUPS.flatMap((g) => g.list);

/** 方向里写了形式的，优先从对应那组掷（短片→影像，歌→声音……），否则全表 */
export function constraintPool(theme = ''): string[] {
  const t = theme || '';
  const g = /片|影|镜头|拍|MV|视频/i.test(t) ? 'film' : /歌|曲|音|播客|声/.test(t) ? 'sound' : /文|诗|故事|小说|文案|信/.test(t) ? 'text' : /海报|画|图|设计|视觉|封面/.test(t) ? 'visual' : '';
  const group = CONSTRAINT_GROUPS.find((x) => x.id === g);
  return group ? [...group.list, ...CONSTRAINT_GROUPS[0].list] : ALL_CONSTRAINTS;
}

/** 掷一次：今天第一次按日期种子（同一天先看到同一条），之后随机重掷；不重复上一条 */
export function rollConstraint(theme = '', prev?: string, rand: () => number = Math.random): string {
  const pool = constraintPool(theme).filter((c) => c !== prev);
  return pool[Math.floor(rand() * pool.length)] || ALL_CONSTRAINTS[0];
}
export function dailyConstraint(theme = '', d = new Date()): string {
  return rollConstraint(theme, undefined, mulberry32(daySeed(d) ^ 0x5eed));
}

// ——— 斜策略卡 ———

const MINE_KEY = 'glean.oblique.mine';
/** 自己写的卡（最多 40 张，localStorage；不是数据库行，不进同步） */
export function myCards(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 40) : [];
  } catch {
    return [];
  }
}
export function cleanCard(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
export function addMyCard(s: string): string[] {
  const c = cleanCard(s);
  if (!c) return myCards();
  const next = [c, ...myCards().filter((x) => x !== c)].slice(0, 40);
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式 */
  }
  return next;
}
export function removeMyCard(s: string): string[] {
  const next = myCards().filter((x) => x !== s);
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式 */
  }
  return next;
}
/** 抽一张：内置 + 自己写的混在一起，不重复上一张；撞墙的（keys 命中）跳过 */
export function drawCard(prev?: string, rand: () => number = Math.random, mine: string[] = myCards(), hit: (s: string) => boolean = () => false): string {
  const deck = [...mine, ...OBLIQUE].filter((c, i, a) => a.indexOf(c) === i);
  const ok = deck.filter((c) => c !== prev && !hit(c));
  const pool = ok.length ? ok : deck;
  return pool[Math.floor(rand() * pool.length)];
}

/** 野一点：临时把温度提到 1.5，并加一条「破前提」的迂回指令 */
export const WILD_TEMP = 1.5;
export const WILD_LINE = '这一次「野一点」：先找出这组素材背后默认成立的一个前提（它们「应该」被怎么用），把它打破；绕远路，宁可奇怪也不要稳妥，但仍然只用给出的素材。';
/** 离线时野一点的迂回句（按穗挑一个前提来破） */
export const WILD_DETOURS = ['如果它根本不是给人看的', '如果它只能在错误的时间出现', '如果最重要的那穗反而是背景', '如果观众是它自己', '如果它必须失败一次才算完成', '如果它的作者是个孩子'];
