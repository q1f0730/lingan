// v0.29 B2 创作产出：作品工坊的纯逻辑（可单测，不碰界面）。
//   0301 立项 / 0302 形态模板 / 0303 草稿里的穗引用 / 0304 分镜表 / 0305 参考帧 / 0306 灵感歌单（起-落-起）
//   0307 影评骨架（论点必须引用收藏）/ 0308 情绪板 / 0309 素材 / 0314 短篇五格 / 0322 歌单文本 / 0339 Markdown / 0340 离线骨架
// 引用一律用穗的 uid：草稿里写成 [[标题|uid]]，备份到别的设备、快照恢复后都不断。
import type { BoardNode, Development, Idea, Item, Work, WorkForm, WorkShot, WorkStage, WorkTodo, WorkTrack } from './types';
import { TYPE_LABEL } from './types';
import { isUlid, ulid } from './ulid';

export type WorkPanel = 'draft' | 'shots' | 'tracks' | 'board';
export interface FormDef {
  label: string;
  /** 一句话说明（立项时给人看） */
  hint: string;
  /** 工作区有哪几块，第一块默认打开（0302） */
  panels: WorkPanel[];
  /** 立项时的待办（最小可交付） */
  todos: string[];
}
export const FORMS: Record<WorkForm, FormDef> = {
  story: { label: '短篇', hint: '人物 / 欲望 / 阻碍 / 转折 / 结尾意象五格', panels: ['draft'], todos: ['五格各写一句', '写出第一段', '读一遍删掉空话'] },
  film: { label: '短片', hint: '梗概 + 分镜表 + 情绪板', panels: ['shots', 'draft', 'board'], todos: ['定下目标时长', '每个镜头配一张参考帧', '拍一条 10 秒试片'] },
  playlist: { label: '歌单', hint: '只用你库里的歌，按起-落-起排好', panels: ['tracks', 'draft'], todos: ['听一遍顺序', '每首写一句为什么在这', '导出到音乐 App'] },
  review: { label: '影评', hint: '立场 / 三个论点（各引一穗）/ 反驳 / 结尾', panels: ['draft'], todos: ['写清立场', '三个论点都引到收藏', '写满 800 字'] },
  poster: { label: '海报', hint: '情绪板 + 一句宣言', panels: ['board', 'draft'], todos: ['摆好情绪板', '定一句宣言', '署名 Q1f730'] },
  podcast: { label: '播客', hint: '开场 / 三段 / 结尾，配歌单', panels: ['draft', 'tracks'], todos: ['写开场 30 秒', '三段各引一穗', '录一段试音'] },
};
export const FORM_ORDER: WorkForm[] = ['story', 'film', 'playlist', 'review', 'poster', 'podcast'];
export const STAGE_LABEL: Record<WorkStage, string> = { idea: '构思', doing: '在做', done: '完成' };
export const STAGE_ORDER: WorkStage[] = ['idea', 'doing', 'done'];
export const PANEL_LABEL: Record<WorkPanel, string> = { draft: '稿', shots: '分镜', tracks: '歌单', board: '情绪板' };

export const FOCUS_WORK_KEY = 'glean.focuswork';
export const REVIEW_TARGET = 800;

const rid = () => Math.random().toString(36).slice(2, 10);

// ───────── 0303 引用 ─────────

/** 引用里的标题不能有 [ ] | 和换行 */
export function refTitle(t: string): string {
  return (t || '无题').replace(/[[\]|\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 40) || '无题';
}
export function refToken(it: Pick<Item, 'title' | 'uid'>): string {
  return `[[${refTitle(it.title)}|${it.uid}]]`;
}
const REF_RE = /\[\[([^\]|\n]+)\|([0-9A-HJKMNP-TV-Z]{26})\]\]/g;
export interface RefHit {
  title: string;
  uid: string;
  start: number;
  end: number;
}
export function parseRefs(md: string): RefHit[] {
  const out: RefHit[] = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(md || ''))) out.push({ title: m[1], uid: m[2], start: m.index, end: m.index + m[0].length });
  return out;
}
/** 草稿里引用到的穗（按第一次出现的顺序，去重） */
export function refUids(md: string): string[] {
  return [...new Set(parseRefs(md).map((r) => r.uid))];
}

/** 光标前刚打了 [[ 之后的字（用来弹穗选择器）；没有就是 null */
export function pendingRef(text: string, caret: number): { from: number; q: string } | null {
  const before = text.slice(0, caret);
  const i = before.lastIndexOf('[[');
  if (i < 0) return null;
  const q = before.slice(i + 2);
  if (/[\]\n|]/.test(q) || q.length > 20) return null;
  return { from: i, q };
}
/** 在光标处插入一个引用（替换掉正在打的 [[xxx） */
export function insertRef(text: string, caret: number, token: string): { text: string; caret: number } {
  const p = pendingRef(text, caret);
  const from = p ? p.from : caret;
  const next = text.slice(0, from) + token + text.slice(caret);
  return { text: next, caret: from + token.length };
}

// ───────── Markdown 小渲染（不走 innerHTML）─────────

export type Inline = { t: string } | { b: string } | { ref: { title: string; uid: string } };
export interface Block {
  kind: 'h1' | 'h2' | 'h3' | 'quote' | 'li' | 'todo' | 'p' | 'hr';
  done?: boolean;
  inline: Inline[];
}
export function inlineOf(s: string): Inline[] {
  const out: Inline[] = [];
  const refs = parseRefs(s);
  let at = 0;
  const pushText = (t: string) => {
    if (!t) return;
    // **粗体**
    const parts = t.split(/(\*\*[^*\n]+\*\*)/);
    for (const p of parts) {
      if (!p) continue;
      if (/^\*\*[^*\n]+\*\*$/.test(p)) out.push({ b: p.slice(2, -2) });
      else out.push({ t: p });
    }
  };
  for (const r of refs) {
    pushText(s.slice(at, r.start));
    out.push({ ref: { title: r.title, uid: r.uid } });
    at = r.end;
  }
  pushText(s.slice(at));
  return out;
}
export function mdBlocks(md: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', inline: inlineOf(para.join('\n')) });
    para = [];
  };
  for (const raw of (md || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      out.push({ kind: (['h1', 'h2', 'h3'] as const)[m[1].length - 1], inline: inlineOf(m[2]) });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      out.push({ kind: 'quote', inline: inlineOf(m[1]) });
    } else if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      flush();
      out.push({ kind: 'todo', done: m[1] !== ' ', inline: inlineOf(m[2]) });
    } else if ((m = line.match(/^\s*(?:[-*]|\d+[.、])\s+(.*)$/))) {
      flush();
      out.push({ kind: 'li', inline: inlineOf(m[1]) });
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push({ kind: 'hr', inline: [] });
    } else para.push(line);
  }
  flush();
  return out;
}

/** 字数：中文按字、拉丁按词（不算 Markdown 标记和引用里的 uid） */
export function wordCount(md: string): number {
  const s = (md || '').replace(REF_RE, '$1').replace(/^#{1,3}\s+/gm, '').replace(/^>\s?/gm, '').replace(/\*\*/g, '');
  const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const words = (s.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return cjk + words;
}

// ───────── 0340 离线骨架（0314 短篇五格 / 0307 影评）─────────

export interface SkeletonCtx {
  title: string;
  ideas: Idea[];
  /** 素材（顺序 = 立项时新枝的来源顺序） */
  items: Item[];
}
const why = (it: Item) => (it.why || '').trim();
const firstOf = (items: Item[], t: Item['type'][]) => items.find((x) => t.includes(x.type));

function ideaLine(ctx: SkeletonCtx): string {
  const i = ctx.ideas[0];
  return i ? `> 从新枝《${i.title.replace(/^《|》$/g, '')}》长出来：${i.idea.trim()}` : '> 空白立项：从右边的素材里挑几穗开始。';
}
function refOr(it: Item | undefined, fallback: string): string {
  return it && it.uid ? refToken(it) : fallback;
}

/** 立项时生成的草稿骨架：每个形态一套章节 + 提示语；提示语里直接引用素材穗。没有 AI、没有 key 也能用 */
export function skeleton(form: WorkForm, ctx: SkeletonCtx): string {
  const { items } = ctx;
  const title = ctx.title.replace(/^《|》$/g, '');
  const A = items[0];
  const B = items[1];
  const C = items[2];
  const img = firstOf(items, ['image']);
  const music = firstOf(items, ['music']);
  const L: string[] = [`# ${title}`, '', ideaLine(ctx), ''];
  if (form === 'story') {
    L.push(
      '## 人物',
      `（谁？从 ${refOr(A, '「一穗素材」')} 里找一个具体的人，写他 / 她手上在做的事）`,
      '',
      '## 欲望',
      `（他 / 她想要什么？${B && why(B) ? `你收 ${refToken(B)} 时写的「${why(B)}」可以是答案` : '一句话，越具体越好'}）`,
      '',
      '## 阻碍',
      `（什么挡住了他 / 她？试试用 ${refOr(C || B, '「另一穗」')} 当障碍）`,
      '',
      '## 转折',
      '（哪一刻局面翻过来？不要靠巧合）',
      '',
      '## 结尾意象',
      `（最后一个画面，最好直接取自 ${refOr(img || A, '「一张图穗」')}）`,
      '',
    );
  } else if (form === 'film') {
    L.push(
      '## 一句话梗概',
      `（谁 + 想要什么 + 结果怎样，30 字以内）`,
      '',
      '## 主要画面',
      ...items.slice(0, 4).map((it) => `- ${refToken(it)}${why(it) ? `：${why(it)}` : ''}`),
      '',
      '## 声音',
      music ? `- 配乐试试 ${refToken(music)}` : '- 环境声先行，音乐最后再加',
      '',
      '## 结构',
      '- 开场：',
      '- 中段：',
      '- 结尾：',
      '',
    );
  } else if (form === 'playlist') {
    L.push('## 开场白', '（像电台主持人那样，用一句话说这张歌单为什么存在）', '', '## 曲间串词', '（在「歌单」页排好顺序后，挑两三处写串词：上一首和下一首之间发生了什么）', '');
  } else if (form === 'review') {
    const film = firstOf(items, ['film']) || A;
    const ev = reviewEvidence(items, film);
    const name = film ? refTitle(film.title) : title;
    L.length = 0;
    L.push(
      `# 《${name.replace(/^《|》$/g, '')}》：（一句立场）`,
      '',
      ideaLine(ctx),
      `> 目标 ${REVIEW_TARGET} 字。每个论点至少引用一穗你的收藏（打 [[ 选穗）。`,
      '',
      '## 立场',
      film && why(film) ? `（你收它时写的是「${why(film)}」——把这句话变成一个能被反驳的判断）` : '（一句能被反驳的判断，不要「很好看」）',
      '',
    );
    ev.forEach((it, i) => {
      L.push(`## 论点${'一二三'[i]}`, '', `证据：${refOr(it, '（打 [[ 选一穗）')}${it && why(it) ? ` ——「${why(it)}」` : ''}`, '（这一穗说明了什么？写具体的镜头、台词、声音）', '');
    });
    L.push('## 反驳', '（最有力的反对意见是什么？用你收过的东西回应它）', '', '## 结尾', '（回到开头那句立场，但比开头多知道一点）', '');
  } else if (form === 'poster') {
    L.push('## 宣言', `（一句话，8–14 字；可以从 ${refOr(A, '「素材」')} 里偷一个词）`, '', '## 小字', '- 时间：', '- 地点：', '- 署名：Q1f730', '');
  } else {
    L.push(
      '## 开场（30 秒）',
      `（从 ${refOr(A, '「一穗素材」')} 讲起：你第一次遇见它是什么时候）`,
      '',
      '## 第一段',
      `（${refOr(B || A, '「素材」')}）`,
      '',
      '## 第二段',
      `（${refOr(C || B || A, '「素材」')}）`,
      '',
      '## 第三段',
      '（把前两段连起来：它们其实在说同一件事吗）',
      '',
      '## 结尾',
      music ? `（用 ${refToken(music)} 收尾）` : '（留一个问题给听的人）',
      '',
    );
  }
  return L.join('\n');
}

/** 0307 影评三个论点的证据：这部电影本身、同导演 / 同标签的穗、截图（图穗）；不够三条就空着让人自己选 */
export function reviewEvidence(items: Item[], film?: Item): Array<Item | undefined> {
  const out: Item[] = [];
  const add = (x?: Item) => {
    if (x && !out.includes(x) && out.length < 3) out.push(x);
  };
  add(film);
  const tags = new Set(film?.tags || []);
  const near = items.filter((x) => x !== film && ((film?.creator && x.creator === film.creator) || x.tags.some((t) => tags.has(t))));
  near.forEach(add);
  items.filter((x) => x.type === 'image').forEach(add);
  items.forEach(add);
  return [0, 1, 2].map((i) => out[i]);
}

export interface ReviewCheck {
  words: number;
  target: number;
  /** 没引用任何收藏的论点（「论点二」） */
  bare: string[];
  points: number;
}
/** 0307 影评检查：字数 + 每个「## 论点…」段落里至少一个 [[穗]] */
export function reviewCheck(md: string, target = REVIEW_TARGET): ReviewCheck {
  const bare: string[] = [];
  let points = 0;
  const secs = (md || '').split(/^(?=##\s)/m);
  for (const s of secs) {
    const m = s.match(/^##\s+(论点\S*)/);
    if (!m) continue;
    points++;
    if (!parseRefs(s).length) bare.push(m[1]);
  }
  return { words: wordCount(md), target, bare, points };
}

// ───────── 0304 / 0305 分镜 ─────────

export const SHOT_SIZES = ['远景', '全景', '中景', '近景', '特写'];
/** 没有参考帧时的字印：景别第一个字 */
export const sizeGlyph = (s: string) => (s || '中').slice(0, 1);
export function newShot(p: Partial<WorkShot> = {}): WorkShot {
  return { id: rid(), size: '中景', visual: '', sound: '', sec: 5, ...p };
}
/** 立项时从素材起一版分镜：每穗一个镜头，图穗直接当参考帧，音乐穗当声音 */
export function shotsFrom(items: Item[], max = 8): WorkShot[] {
  const music = items.find((x) => x.type === 'music');
  const pool = items.filter((x) => x.type !== 'music').slice(0, max);
  const cycle = ['全景', '中景', '近景', '特写'];
  const shots = pool.map((it, i) =>
    newShot({
      size: cycle[i % cycle.length],
      visual: `${it.title}${why(it) ? ` —— ${why(it)}` : ''}`.slice(0, 80),
      sound: i === 0 && music ? `《${music.title}》${music.creator ? ` · ${music.creator}` : ''}` : '环境声',
      sec: 5,
      frameUid: it.type === 'image' && it.uid ? it.uid : undefined,
    }),
  );
  return shots.length ? shots : [newShot({ size: '全景', visual: '（开场画面）' })];
}
export function shotTotal(shots: WorkShot[]): number {
  return shots.reduce((s, x) => s + (Number.isFinite(x.sec) && x.sec > 0 ? x.sec : 0), 0);
}
export function shotCheck(shots: WorkShot[], target?: number): { total: number; target: number; over: number } {
  const total = Math.round(shotTotal(shots) * 10) / 10;
  const t = target && target > 0 ? target : 60;
  return { total, target: t, over: Math.max(0, Math.round((total - t) * 10) / 10) };
}
export function fmtSec(s: number): string {
  const n = Math.round(s);
  return n >= 60 ? `${Math.floor(n / 60)} 分 ${n % 60 ? `${n % 60} 秒` : ''}`.trim() : `${n} 秒`;
}

// ───────── 0306 灵感歌单（起-落-起）─────────

const LOW = ['夜', '雨', '慢', '静', '安静', '孤独', '一个人', '冬', '睡', '眠', '海', '月', '雾', '钢琴', '民谣', '温柔', '哭', '想念', '告别', '凌晨', 'lofi', 'ambient', 'piano', 'slow', 'sleep', 'night', 'rain'];
const HIGH = ['燃', '快', '跳', '舞', '夏', '阳光', '摇滚', '朋克', '电子', '跑', '热', '派对', '鼓', '公路', '自由', '狂', 'rock', 'dance', 'edm', 'punk', 'run', 'summer', 'party'];
/** 粗估能量 0–1（看标题 / 为什么 / 标签里的词；都没有就 0.5，按标题哈希给一点抖动，结果稳定） */
export function energyOf(it: Pick<Item, 'title' | 'why' | 'tags' | 'creator'>): number {
  const s = `${it.title} ${it.why || ''} ${(it.tags || []).join(' ')}`.toLowerCase();
  let e = 0.5;
  for (const w of LOW) if (s.includes(w)) e -= 0.12;
  for (const w of HIGH) if (s.includes(w)) e += 0.12;
  let h = 0;
  for (const ch of it.title || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  e += ((h % 100) / 100 - 0.5) * 0.06;
  return Math.max(0, Math.min(1, e));
}
/** 起-落-起的目标曲线：开头中高、中间最低、结尾最高 */
export function curveTarget(i: number, n: number): number {
  if (n <= 1) return 0.7;
  const x = i / (n - 1);
  return x < 0.5 ? 0.7 - 0.7 * (x / 0.5) : 0.15 + 0.85 * ((x - 0.5) / 0.5);
}
export function trackRole(i: number, n: number): string {
  if (i === 0) return '开场';
  if (i === n - 1) return '收尾';
  const lowAt = Math.round((n - 1) / 2);
  if (i === lowAt) return '最低处';
  return i < lowAt ? '往下落' : '再起来';
}
/**
 * 0306 只用库里的音乐穗排一张歌单：先挑和素材同标签 / 同歌手的，不够再按最近收的补；
 * 按估出的能量排成起-落-起，每首写一句「为什么在这」（位置 + 你当时写的为什么）。
 */
export function buildPlaylist(music: Item[], seeds: Item[] = [], max = 12): WorkTrack[] {
  const pool = music.filter((x) => x.type === 'music' && x.uid && !x.deletedAt && x.polarity !== -1);
  if (!pool.length) return [];
  const tags = new Set(seeds.flatMap((x) => x.tags || []));
  const who = new Set(seeds.map((x) => x.creator).filter(Boolean) as string[]);
  const seedUids = new Set(seeds.map((x) => x.uid));
  const score = (x: Item) => (seedUids.has(x.uid) ? 3 : 0) + (x.creator && who.has(x.creator) ? 2 : 0) + x.tags.filter((t) => tags.has(t)).length;
  const picked = [...pool].sort((a, b) => score(b) - score(a) || b.createdAt - a.createdAt).slice(0, max);
  const n = picked.length;
  const byE = picked.map((it) => ({ it, e: energyOf(it) })).sort((a, b) => a.e - b.e || a.it.title.localeCompare(b.it.title));
  const slots = Array.from({ length: n }, (_, i) => ({ i, t: curveTarget(i, n) })).sort((a, b) => a.t - b.t || a.i - b.i);
  const order: Item[] = new Array(n);
  slots.forEach((s, k) => (order[s.i] = byE[k].it));
  return order.map((it, i) => ({ uid: it.uid!, why: `${trackRole(i, n)}：${why(it) || '（你没写为什么收它，补一句？）'}` }));
}
/** 0322 导出给音乐 App「导入歌单」：每行「歌名 - 歌手」 */
export function playlistText(tracks: WorkTrack[], byUid: Map<string, Item>): string {
  return tracks
    .map((t) => byUid.get(t.uid))
    .filter((x): x is Item => !!x)
    .map((it) => (it.creator ? `${it.title} - ${it.creator}` : it.title))
    .join('\n');
}

// ───────── 0308 情绪板 ─────────

export const BOARD_W = 1600;
export const BOARD_H = 1200;
export const GRAYS = ['#1d1b18', '#6b665e', '#a9a49b', '#e8e4dc'];
/** 立项时摆一版：图穗大一点、字穗小卡，按网格错落；之后随便拖 */
export function boardFrom(items: Item[]): BoardNode[] {
  const nodes: BoardNode[] = [];
  let x = 40;
  let y = 40;
  let rowH = 0;
  for (const it of items.slice(0, 12)) {
    if (!it.uid) continue;
    const img = it.type === 'image' || !!it.hasImage;
    const w = img ? 280 : 220;
    const h = img ? Math.round(w * ((it.thumbH && it.thumbW ? it.thumbH / it.thumbW : 1.25) || 1.25)) : 120;
    if (x + w > BOARD_W - 40) {
      x = 40;
      y += rowH + 32;
      rowH = 0;
    }
    nodes.push({ id: rid(), kind: 'item', uid: it.uid, x, y, w, h: Math.min(h, 420) });
    x += w + 32;
    rowH = Math.max(rowH, Math.min(h, 420));
  }
  return nodes;
}
export function clampZoom(k: number): number {
  return Math.max(0.25, Math.min(3, k));
}
/** 以屏幕上某点为中心缩放：返回新的平移 */
export function zoomAt(view: { x: number; y: number; k: number }, px: number, py: number, k2: number): { x: number; y: number; k: number } {
  const k = clampZoom(k2);
  const bx = (px - view.x) / view.k;
  const by = (py - view.y) / view.k;
  return { x: px - bx * k, y: py - by * k, k };
}

// ───────── 0301 立项 ─────────

export function defaultTodos(form: WorkForm): WorkTodo[] {
  return FORMS[form].todos.map((text) => ({ id: rid(), text }));
}

/** 用新枝和它的来源穗拼出一件新作品（不入库，入库在 workstore） */
export function draftWork(form: WorkForm, devs: Development[], items: Item[], opts: { title?: string; music?: Item[]; now?: number } = {}): Work {
  const now = opts.now ?? Date.now();
  const ideas = devs.map((d) => d.idea);
  const title = (opts.title || ideas[0]?.title || '无题作品').replace(/^《|》$/g, '').trim() || '无题作品';
  const mats = items.filter((x) => x.uid);
  const w: Work = {
    title,
    form,
    stage: 'idea',
    devUids: devs.map((d) => d.uid).filter((u): u is string => isUlid(u)),
    itemUids: mats.map((x) => x.uid!),
    draft: skeleton(form, { title, ideas, items: mats }),
    todos: defaultTodos(form),
    createdAt: now,
    updatedAt: now,
    uid: ulid(now),
  };
  const panels = FORMS[form].panels;
  if (panels.includes('shots')) {
    w.shots = shotsFrom(mats);
    w.targetSec = 60;
  }
  if (panels.includes('tracks')) w.tracks = buildPlaylist(opts.music || [], mats);
  if (panels.includes('board')) w.board = { nodes: boardFrom(mats) };
  return w;
}

// ───────── 0339 Markdown ─────────

/** 作品 → 干净的 Markdown：引用变成「《标题》[n]」，文末列溯源（类型 · 作者 · 链接）；分镜成表、歌单成列表 */
export function workMarkdown(w: Work, byUid: Map<string, Item>, devTitles: string[] = []): string {
  const order: string[] = [];
  const num = (uid: string) => {
    let i = order.indexOf(uid);
    if (i < 0) {
      order.push(uid);
      i = order.length - 1;
    }
    return i + 1;
  };
  const conv = (s: string) => s.replace(REF_RE, (_m, t: string, uid: string) => `《${t.trim()}》[${num(uid)}]`);
  const L: string[] = [];
  const body = conv(w.draft || '').trim();
  if (!/^#\s/.test(body)) L.push(`# ${w.title}`, '');
  L.push(body, '');
  L.push(`> ${FORMS[w.form]?.label || w.form} · ${STAGE_LABEL[w.stage] || w.stage}${devTitles.length ? ` · 来自新枝：${devTitles.map((t) => `《${t.replace(/^《|》$/g, '')}》`).join('、')}` : ''}`, '');
  if (w.shots?.length) {
    const c = shotCheck(w.shots, w.targetSec);
    L.push('## 分镜', '', '| 镜号 | 景别 | 画面 | 声音 | 时长 | 参考帧 |', '| --- | --- | --- | --- | --- | --- |');
    w.shots.forEach((s, i) => {
      const f = s.frameUid ? byUid.get(s.frameUid) : undefined;
      const cell = (x: string) => (x || '').replace(/\|/g, '／').replace(/\n/g, ' ');
      L.push(`| ${i + 1} | ${cell(s.size)} | ${cell(conv(s.visual))} | ${cell(s.sound)} | ${s.sec} 秒 | ${f ? `《${cell(f.title)}》[${num(f.uid!)}]` : ''} |`);
    });
    L.push('', `合计 ${fmtSec(c.total)} / 目标 ${fmtSec(c.target)}${c.over ? `（超出 ${fmtSec(c.over)}）` : ''}`, '');
  }
  if (w.tracks?.length) {
    L.push('## 歌单', '');
    w.tracks.forEach((t, i) => {
      const it = byUid.get(t.uid);
      if (it) L.push(`${i + 1}. 《${it.title}》${it.creator ? ` - ${it.creator}` : ''} —— ${t.why}`);
    });
    L.push('');
  }
  if (w.todos?.length) {
    L.push('## 待办', '', ...w.todos.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`), '');
  }
  if (order.length) {
    L.push('## 溯源', '');
    order.forEach((uid, i) => {
      const it = byUid.get(uid);
      if (!it) L.push(`${i + 1}. （这穗已经不在穗仓了）`);
      else L.push(`${i + 1}. 《${it.title}》 · ${TYPE_LABEL[it.type]}${it.creator ? ` · ${it.creator}` : ''}${it.year ? ` · ${it.year}` : ''}${it.url ? ` · ${it.url}` : ''}`);
    });
    L.push('');
  }
  L.push('— Q1f730 · 拾穗 Glean');
  return L.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/** 文件名里不能有的字 */
export function safeFileName(s: string): string {
  return (s || '作品').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || '作品';
}
