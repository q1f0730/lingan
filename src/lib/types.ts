export type ItemType = 'music' | 'film' | 'image' | 'text' | 'link' | 'idea';

export interface Item {
  id?: number;
  type: ItemType;
  title: string;
  creator?: string;
  year?: string;
  content?: string;
  url?: string;
  image?: string; // data URL (compressed)
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
}

export interface Development {
  id?: number;
  itemIds: number[];
  theme?: string;
  jump: number;
  idea: Idea;
  source: 'ai' | 'offline';
  starred?: boolean;
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
