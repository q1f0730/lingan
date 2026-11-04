import type { GraftMode } from './modes';

export type ItemType = 'music' | 'film' | 'image' | 'text' | 'link' | 'idea';

export interface Item {
  id?: number;
  type: ItemType;
  title: string;
  creator?: string;
  year?: string;
  content?: string;
  url?: string;
  /** 草稿 / 备份 / v0.12 及以前的旧行里才有：原图 data URL。v0.13 起入库后原图搬进 images 表，行里不再留 */
  image?: string;
  /** v0.13 列表用的小缩略图（JPEG Blob，约 20KB） */
  thumb?: Blob;
  thumbW?: number;
  thumbH?: number;
  /** 有原图（在 images 表） */
  hasImage?: 1;
  /** 缩略图待生成（后台补） */
  thumbTodo?: 1;
  /** 原图解不开，放弃生成缩略图（列表退回读原图） */
  thumbFail?: 1;
  why?: string;
  tags: string[];
  /** v0.22 拾自哪个 App（「微信读书」「网易云音乐」）：分享 / 选字 / 正在播放时自动记，认不出就没有 */
  source?: string;
  caption?: string; // AI image caption
  /** v0.36 0020 图里的字（Windows 系统 OCR 识别，进全文索引、随同步；'' = 识别过、没有字） */
  ocr?: string;
  embedding?: number[];
  embedModel?: string;
  /** v0.14 示例穗（示例池抽来的），可一键清掉 */
  sample?: 1;
  /** v0.14 最近一次「碰过」：打开详情、编辑、拿去嫁接。每日一穗按它找很久没碰的旧穗 */
  touchedAt?: number;
  /** v0.18 被嫁接的次数（一次嫁接 = 一批三根，算 1 次）。旧数据迁移时补 0 或按旧新枝回填 */
  graftCount?: number;
  /** v0.18 最后一次被嫁接的时间 */
  graftedAt?: number;
  /** v0.21 全局唯一 id（ULID）：备份、导入去重、以后同步都认它；本机自增 id 只在这台设备上有意义 */
  uid?: string;
  /** v0.21 最后一次改它的设备（lib/device.ts） */
  deviceId?: string;
  /** v0.31 HLC：行里最新一次修改 / 新建时 / 改过的字段 → 那次的 HLC（同步字段级合并） */
  hlc?: string;
  hc?: string;
  fh?: Record<string, string>;
  /** v0.31 原图内容哈希（同步时算、本机用，不参与合并） */
  imgSha?: string;
  /** v0.21 墓碑：删除时间。有它 = 在回收站里（30 天后彻底清掉），所有列表 / 搜索 / 嫁接都看不到 */
  deletedAt?: number;
  /** v0.23 待理：刚收进来、还没整理（速记 / 分享 / 极速拾 / 选字 / 正在播放）。留下、编辑、一键入仓后去掉；超过 7 天自动出现在穗仓 */
  inbox?: 1;
  /** v0.23 重复钥匙（u:链接 / i:原图哈希 / t:文字指纹，多值索引），lib/dupe.ts 算 */
  dup?: string[];
  /** v0.23 AI 想加、但不在你标签词汇里的新词：要你点一下才算数（0110） */
  tagSugg?: string[];
  /** v0.24 0206 反口味：-1 = 我讨厌的（不当素材抽，嫁接时列进 AVOID）；没有 = 普通的穗 */
  polarity?: -1;
  /** v0.24 0242 私密：任何发到云端模型的调用（嫁接 / 看图 / 打标签 / 向量 / 口味侧写）都不带它；本地模型可在设置里允许 */
  private?: 1;
  /** v0.28 0107 穗束（合集）名字：一穗可属于多个束，束也能当嫁接池（0108）。没加索引，不是 schema 变更 */
  bundles?: string[];
  /** v0.34 0902 公开花园：标了才会进「生成花园页」（默认私有）；私密穗永远不进。没加索引，不是 schema 变更 */
  garden?: 1;
  /** v0.35 0016 再次遇见：同一件东西又收了一次、合并进来时记下那次的时间（最早拾于 = createdAt）。没加索引，随同步 */
  meets?: number[];
  /** v0.38 0104 作品实体：手动归属（没有 = 按标题 / 《》自动认；'' = 拆出来不归入；名字 = 归到那一部）。没加索引，随同步 */
  work?: string;
  /** v0.38 0105 穗间连线（两头各存一条，存对方 uid）。没加索引，随同步 */
  links?: ItemLink[];
  /** v0.39 0017 链接正文快照（纯文本 ≤50KB，抓链接时顺手存；原链接失效也能看）。没加索引，随同步 / 备份 */
  snap?: string;
  /** v0.39 快照存于什么时候 */
  snapAt?: number;
  /** v0.39 0054 链接没解析成（断网 / 超时）：待补，联网后自动重试。只在本机、不同步 */
  metaTodo?: 1;
  /** v0.39 0907 上锁：要输入本机 PIN 才显示；永远不进分享、花园、Agent / MCP、AI。没加索引，随同步 */
  locked?: 1;
  /** v0.39 0934 这一穗关掉的出口（'ai' | 'agent' | 'share' | 'garden'）；上锁 = 全关。没加索引，随同步 */
  shut?: string[];
  /** v0.40 0131 / 0915 再看一句：同一穗随时间多段感受（y = 1：满一年时「现在的为什么」）。没加索引，随同步 */
  revisits?: Revisit[];
  /** v0.40 0938 放下：不进默认穗仓 / 每日一穗，可搜、可拿回来（放下的时间）。没加索引，随同步 */
  down?: number;
  /** v0.43 0651 照片 EXIF 里的拍摄时间（「拾于」候选；不加索引、随同步） */
  shotAt?: number;
  /** v0.45 0924 封存到某天（拆封日 0 点的时间戳）：之前不在穗仓 / 搜索 / 每日一穗 / 嫁接里出现，到期在穗仓顶部来一封「给未来的穗」，拆开才回来。没加索引，随同步 */
  sealUntil?: number;
  /** v0.45 封存那一刻（来信里说「n 天前封存」） */
  sealAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Revisit {
  text: string;
  at: number;
  y?: 1;
}

export type LinkKind = 'like' | 'anti' | 'lead' | 'reply';
/** r = 1：这一头是被连的（「由它引出」「被回应」） */
export interface ItemLink {
  to: string;
  k: LinkKind;
  at: number;
  r?: 1;
}

export interface Idea {
  title: string;
  bridge: string;
  idea: string;
  form?: string;
  firstStep?: string;
  cliches: string[];
  oblique?: string;
  /** v0.11 一次三枝：用了哪种变形（反转 / 换媒介 …） */
  transform?: string;
  /** 和另外两根哪里不同 */
  unlike?: string;
  /** 20 分钟能做的小实验 */
  experiment?: string;
  /** 用到的素材：嫁接时素材的序号（1 起，对应 Development.itemIds 的位置） */
  refs?: number[];
  /** v0.12 溯源：ok = 模型引用了 ≥3 件真实素材；weak = 重来一次仍说不清（证据不足）；legacy = v0.12 之前长的 */
  evidence?: 'ok' | 'weak' | 'legacy';
  /** 证据不足时的原因（给人看） */
  evidenceNote?: string;
  /** v0.19 套路墙：这一根原本撞了墙。replaced = 用别的种子重长了这一根；scrubbed = 把撞到的字删掉了 */
  wall?: 'replaced' | 'scrubbed';
  /** v0.24 三枝不撞车：这一根原本和另一根太像，换成了没用上的种子长的 */
  distinct?: 'replaced';
  /** v0.24 0241 新颖度：和穗仓里已有新枝的最大相似度（0–1，越低越新）；method = 字面 / 向量 */
  nearest?: { sim: number; method: 'text' | 'vector'; title?: string };
  /** v0.24 0234 去 AI 腔：本地改写了几处模板句式 */
  deai?: number;
  /** v0.30 0216 掷出的硬约束（「用了什么约束」里显示） */
  constraint?: string;
  /** v0.30 野一点：这一根是温度 1.5 + 破前提长出来的 */
  wild?: 1;
  /** v0.30 0201 用户亲手挑的张力 */
  focus?: string[];
  /** v0.30 0207 离「大众版」太近被换掉了 */
  mainstream?: 'replaced';
}

/** 四步嫁接的中间产物：张力与种子（可展开看） */
export interface GraftTension {
  text: string;
  refs: number[];
}
export interface GraftSeed {
  text: string;
  transform: string; // 变形法 id，见 lib/graft.ts TRANSFORMS
  refs: number[];
  /** DEFIX 时被换上来的新种子 */
  replaced?: boolean;
  /** CONVERGE 时被选中长成新枝 */
  chosen?: boolean;
}
export interface GraftBatch {
  id: string;
  index: number; // 0..size-1
  size: number;
  /** 只存在 index 0 上，避免重复 */
  tensions?: GraftTension[];
  seeds?: GraftSeed[];
  pattern?: string; // DEFIX 找到的重复套路
  calls?: number; // 实际调用了几次模型（含重试）
  /** v0.30 0207 模型给的「大众版」（新枝要离它远；只在溯源里给你看） */
  mainstream?: string;
  /** v0.30 每次调用用的温度（野一点时第一步是 1.5） */
  temps?: number[];
  /** v0.42 ROADMAP v0.32 可复现：用的模型（离线 = 无）、提示词版本（graft.ts PROMPT_V）；每根都存一份 */
  model?: string;
  prompt?: string;
  /** v0.42 0214 / 0217 特别抽法：时间差 / 标签对撞（抽到的说明） */
  draw?: string;
}

export interface Development {
  id?: number;
  itemIds: number[];
  theme?: string;
  jump: number;
  idea: Idea;
  source: 'ai' | 'offline';
  starred?: boolean;
  /** v0.11 起：同一次嫁接的三根新枝共享一个 batch.id */
  batch?: GraftBatch;
  /** v0.12：与 idea.evidence 相同，单独放一份方便建索引（Dexie version 2） */
  evidence?: 'ok' | 'weak' | 'legacy';
  /** v0.24 0202 锚点穗：嫁接时钉住的主干（穗 id）；其余穗只当养分 */
  anchorId?: number;
  /** v0.18 用哪种接法抽的穗（相近 / 远距 / 被冷落 / 跨媒介 / 反氛围）；之前长的没有 */
  mode?: GraftMode;
  /** v0.21 全局唯一 id（ULID）：备份、导入去重、以后同步都认它；本机自增 id 只在这台设备上有意义 */
  uid?: string;
  /** v0.21 最后一次改它的设备（lib/device.ts） */
  deviceId?: string;
  /** v0.31 HLC：行里最新一次修改 / 新建时 / 改过的字段 → 那次的 HLC（同步字段级合并） */
  hlc?: string;
  hc?: string;
  fh?: Record<string, string>;
  /** v0.21 墓碑：删除时间。有它 = 在回收站里（30 天后彻底清掉），所有列表 / 搜索 / 嫁接都看不到 */
  deletedAt?: number;
  /** v0.21 最后修改时间（旧新枝迁移时 = createdAt） */
  updatedAt?: number;
  /** v0.30 ROADMAP v0.24 新枝再嫁接：子枝挂在哪根新枝下（父枝 uid）、怎么接的 */
  parentUid?: string;
  regraft?: RegraftKind;
  /** v0.30 0904 落地追踪：种子 / 试过 / 做成 / 放弃（没有 = 种子）；结果穗（uid） */
  status?: BranchStatus;
  statusAt?: number;
  resultUids?: string[];
  /** v0.30 0204 新枝追问：问答挂在这根新枝下，回答只用这批穗 */
  followups?: Followup[];
  /** v0.42 ROADMAP v0.32 意外程度 1–5（轻评分，不评 = 没有） */
  surprise?: number;
  /** v0.42 0238 最后一次复制 / 分享出去的时间（采用信号） */
  out?: number;
  createdAt: number;
}

/** v0.30 再嫁接三种：更野 / 更能落地 / 换一种形式 */
export type RegraftKind = 'wilder' | 'grounded' | 'reform';
export type BranchStatus = 'seed' | 'tried' | 'done' | 'dropped';
export interface Followup {
  q: string;
  a: string;
  /** 回答里引用的穗（这批里的位置，1 起） */
  refs: number[];
  source: 'ai' | 'offline';
  at: number;
}

export const TYPE_LABEL: Record<ItemType, string> = {
  music: '音乐',
  film: '电影',
  image: '图片',
  text: '文案',
  link: '链接',
  idea: '想法',
};

export const TYPE_ORDER: ItemType[] = ['music', 'film', 'image', 'text', 'link', 'idea'];

/** v0.13 原图单独一张表：列表永远不读它 */
export interface StoredImage {
  itemId: number;
  blob: Blob;
  /** v0.37 0713 详情档（长边 ≤ MID_MAX 的 JPEG），本机派生、不进备份 / 同步；null = 看过了、原图不大不用做 */
  mid?: Blob | null;
  /** v0.43 0651 / 0636 刚收进来、还没抹 GPS / 缩图（值 = 收进来那一刻，换图后对不上就不写回）；本机、不进备份 */
  fresh?: number;
}

/** v0.14 每日一穗：某一天定下来的内容（同一天打开都一样） */
export interface DailyPick {
  /** 本地日期 YYYY-MM-DD */
  day: string;
  /** 3 件很久没碰的旧穗 */
  oldIds: number[];
  /** 1 个没试过的远距离组合（4 件） */
  comboIds: number[];
  createdAt: number;
}

/** v0.17 秒搜：全文索引表的一行（key = i:<穗 id> / b:<新枝 id>） */
export interface FtRow {
  key: string;
  kind: 'i' | 'b';
  ref: number;
  /** 内容签名（字段变了才重切） */
  sig: string;
  /** 切好的词：中文单字 + 二元、英文整词 */
  tok: string[];
}

/** v0.24 0212 「不要」的理由：点「不要」时选的（可不选）。写进下次嫁接的 FEEDBACK 段，口味页可见可删 */
export interface Reject {
  id?: number;
  /** 快捷理由 id（cliche 太俗 / far 太远 / hard 做不了 / notme 不像我）或 custom */
  reason: string;
  /** 自定义理由的原话（custom 时有） */
  text?: string;
  /** 被不要的那根新枝的标题与一句话（新枝 30 天后会被彻底清掉，理由留着） */
  title: string;
  gist?: string;
  devUid?: string;
  uid?: string;
  deviceId?: string;
  /** v0.31 HLC：行里最新一次修改 / 新建时 / 改过的字段 → 那次的 HLC（同步字段级合并） */
  hlc?: string;
  hc?: string;
  fh?: Record<string, string>;
  updatedAt?: number;
  createdAt: number;
}

// ——— v0.29 B2 创作产出：作品工坊（0301–0309、0314、0322、0339、0340）———
/** 作品形态（0302）：短篇 / 短片 / 歌单 / 影评 / 海报 / 播客 */
export type WorkForm = 'story' | 'film' | 'playlist' | 'review' | 'poster' | 'podcast';
/** 进度：构思 → 在做 → 完成 */
export type WorkStage = 'idea' | 'doing' | 'done';
/** 0304 分镜一行：景别 / 画面 / 声音 / 时长（秒）；0305 参考帧 = 库里一穗图（存 uid，跨设备 / 备份不断） */
export interface WorkShot {
  id: string;
  size: string;
  visual: string;
  sound: string;
  sec: number;
  frameUid?: string;
}
/** 0306 灵感歌单一首：只用库里的音乐穗（uid）+ 一句「为什么在这」 */
export interface WorkTrack {
  uid: string;
  why: string;
}
/** 0308 情绪板上一块：穗（图 / 字）、自由文字、色块。坐标是板内单位（不随缩放变） */
export interface BoardNode {
  id: string;
  kind: 'item' | 'text' | 'color';
  x: number;
  y: number;
  w: number;
  h: number;
  uid?: string;
  text?: string;
  color?: string;
}
export interface WorkTodo {
  id: string;
  text: string;
  done?: 1;
}
/**
 * v0.29 0301 作品：新枝「立项」后有自己的页面，挂素材、草稿、待办。
 * 引用一律存全局 uid（穗 uid / 新枝 uid），不存本机自增 id：备份导到别的设备、快照恢复后引用都不断。
 */
export interface Work {
  id?: number;
  title: string;
  form: WorkForm;
  stage: WorkStage;
  /** 从哪几根新枝立的项（新枝 uid） */
  devUids: string[];
  /** 0309 素材（穗 uid，按加入顺序） */
  itemUids: string[];
  /** 0303 草稿（Markdown；引用穗写成 [[标题|uid]]） */
  draft: string;
  todos: WorkTodo[];
  /** 0304 分镜表 + 目标时长（秒） */
  shots?: WorkShot[];
  targetSec?: number;
  /** 0306 灵感歌单 */
  tracks?: WorkTrack[];
  /** 0308 情绪板 */
  board?: { nodes: BoardNode[] };
  uid?: string;
  deviceId?: string;
  /** v0.31 HLC：行里最新一次修改 / 新建时 / 改过的字段 → 那次的 HLC（同步字段级合并） */
  hlc?: string;
  hc?: string;
  fh?: Record<string, string>;
  deletedAt?: number;
  updatedAt?: number;
  createdAt: number;
}
