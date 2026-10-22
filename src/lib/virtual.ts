// v0.13 虚拟滚动的纯计算部分（可单测）：瀑布 / 双列布局、竖排列表偏移、可见区间。
import type { Item } from './types';

export interface Placed {
  top: number;
  left: number;
  height: number;
  col: number;
}

/** 列数：复刻 CSS `columns: <max> <minWidth>` 的算法 */
export function columnCount(width: number, maxCols: number, minColWidth: number, gap: number): number {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.min(maxCols, Math.floor((width + gap) / (minColWidth + gap))));
}

/** 瀑布：按顺序放进当前最矮的一列（同高取最左），保证同样输入总得出同样布局 */
export function layoutMasonry(heights: number[], cols: number, colWidth: number, gapX: number, gapY: number): { cells: Placed[]; height: number } {
  const n = Math.max(1, cols);
  const colH = new Array<number>(n).fill(0);
  const cells: Placed[] = new Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    let c = 0;
    for (let k = 1; k < n; k++) if (colH[k] < colH[c] - 0.5) c = k;
    const top = colH[c];
    cells[i] = { top, left: c * (colWidth + gapX), height: heights[i], col: c };
    colH[c] = top + heights[i] + gapY;
  }
  const height = Math.max(0, ...colH.map((h) => (h > 0 ? h - gapY : 0)));
  return { cells, height };
}

/** 竖排列表：每行累计偏移（行与行之间 gap） */
export function layoutList(heights: number[], gap: number): { tops: number[]; height: number } {
  const tops: number[] = new Array(heights.length);
  let y = 0;
  for (let i = 0; i < heights.length; i++) {
    tops[i] = y;
    y += heights[i] + (i < heights.length - 1 ? gap : 0);
  }
  return { tops, height: y };
}

/** 落在 [from, to] 窗口里的下标（含跨边界的），保持原顺序 */
export function visibleIndexes(cells: Array<{ top: number; height: number }>, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.top + c.height >= from && c.top <= to) out.push(i);
  }
  return out;
}

/** 竖排列表的可见区间 [start, end)，tops 递增，用二分 */
export function listRange(tops: number[], heights: number[], from: number, to: number): [number, number] {
  const n = tops.length;
  if (!n) return [0, 0];
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] + heights[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < n && tops[end] <= to) end++;
  return [lo, Math.max(end, Math.min(n, lo + 1))];
}

/** 没量过的卡片先估个高：图片按缩略图比例（最多 360），文字按字数粗算行数 */
export function estimateCardHeight(it: Pick<Item, 'type' | 'title' | 'content' | 'why' | 'tags' | 'creator' | 'year' | 'url' | 'thumbW' | 'thumbH' | 'hasImage' | 'image'>, colWidth: number): number {
  const inner = Math.max(60, colWidth - 30);
  const perLine = Math.max(6, Math.floor(inner / 16.5));
  const lines = (s: string | undefined, max = 20) => (s ? Math.min(max, Math.ceil(s.length / perLine)) : 0);
  let h = 12 + 14 + 22; // padding + meta 行
  if (it.thumbW && it.thumbH) h += Math.min(360, (colWidth * it.thumbH) / it.thumbW) + 10 - 12;
  else if (it.hasImage || it.image) h += Math.min(360, colWidth * 0.75) + 10 - 12;
  const quote = it.type === 'text' && it.content;
  h += (quote ? lines(it.content, 30) * 29 : lines(it.title, 6) * 25) + 2;
  if (quote || it.creator || it.year) h += 21;
  if (it.type === 'idea' && it.content) h += 6 + lines(it.content, 12) * 23;
  if (it.type === 'link' && it.url) h += 24;
  if (it.why) h += 8 + lines(it.why, 8) * 22;
  if (it.tags?.length) h += 8 + 22 * Math.ceil(Math.min(5, it.tags.length) / Math.max(1, Math.floor(inner / 70)));
  return Math.round(h);
}
