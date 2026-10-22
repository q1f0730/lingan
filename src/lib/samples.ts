import type { Item } from './types';
type S = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;
export const SAMPLES: S[] = [
  { type: 'film', title: '花样年华', creator: '王家卫', year: '2000', why: '走廊里擦肩而过的慢镜头，什么都没发生却什么都发生了', tags: ['克制', '慢镜头', '旗袍', '雨'] },
  { type: 'music', title: 'Svefn-g-englar', creator: 'Sigur Rós', year: '1999', why: '像在水下听见有人叫你的名字', tags: ['后摇', '冰岛', '水下', '漫长'] },
  { type: 'text', title: '一句摘抄', content: '我们终此一生，就是要摆脱他人的期待，找到真正的自己。', creator: '伍绮诗', why: '被太多人引用到失去重量，反而想知道它最初有多重', tags: ['期待', '自我'] },
  { type: 'idea', title: '清晨菜市场的第一声吆喝', content: '蒸笼掀开的一瞬，白气里全是人声和葱香', why: '一天里最有生气的三分钟', tags: ['清晨', '市井', '声音', '热气'] },
  { type: 'film', title: '燃烧女子的肖像', creator: 'Céline Sciamma', year: '2019', why: '凝视被归还给被凝视的人', tags: ['凝视', '火', '海边', '画'] },
  { type: 'music', title: 'Avril 14th', creator: 'Aphex Twin', year: '2001', why: '一个做噪音的人写出最安静的钢琴', tags: ['钢琴', '反差', '电子'] },
  { type: 'link', title: '东京公共厕所计划', url: 'https://tokyotoilet.jp/', why: '把最被忽视的空间当作建筑作品', tags: ['城市', '公共空间', '透明'] },
  { type: 'idea', title: '外婆的缝纫机', content: '脚踏的节奏是我童年的节拍器', why: '声音比照片更能保存一个人', tags: ['节奏', '家', '手工', '记忆'] },
  { type: 'text', title: '路边的手写招牌', content: '「本店修一切，除了破碎的心」', why: '幽默里有一点点悲伤', tags: ['手写', '幽默', '街头'] },
  { type: 'music', title: '夜空中最亮的星', creator: '逃跑计划', year: '2011', why: 'KTV 里所有人都在唱，我却只想听前奏', tags: ['合唱', '前奏', '青春'] },
];
