// v0.23 缺为什么的判定单独放：穗仓首屏只要这一个函数，organize 的其余部分点开才加载
import type { Item } from './types';

type WhyItem = Pick<Item, 'why' | 'sample' | 'deletedAt'>;

/** 缺为什么：不是示例、没进回收站、为什么为空 */
export function lacksWhy(it: WhyItem): boolean {
  return !it.sample && !it.deletedAt && !(it.why || '').trim();
}
