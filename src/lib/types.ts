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
  caption?: string; // AI image caption
  embedding?: number[];
  embedModel?: string;
  createdAt: number;
  updatedAt: number;
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
  createdAt: number;
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
}
