// v0.11 嫁接等待时的「三根麦子在长」：纯函数，可单测。组件在 components/GraftGrowing.tsx。
import type { GraftStage } from './graft';

const STALK = [
  "  'v`  ",
  "  `#'  ",
  ' \\ # / ',
  '  \\|/  ',
  '   |   ',
  '  /|   ',
  '   |\\  ',
  '   |   ',
];
const SWAY = "  `v'  ";
const W = STALK[0].length;
export const GROW_ROWS = STALK.length;

/** 每个阶段内的进度：渐近增长，永远不会在等待中「到头」；done 时为 1 */
export function stageProgress(stage: GraftStage, elapsedMs: number): number {
  const e = Math.max(0, elapsedMs);
  if (stage === 'done') return 1;
  if (stage === 'map') return 0.2 + 0.35 * (1 - Math.exp(-e / 10000));
  return 0.55 + 0.4 * (1 - Math.exp(-e / 12000));
}

/** 三根麦子（对应三根新枝）一起长，速度略有先后；tick 让穗头轻轻摆、偶尔飘起一粒种子 */
export function growFrame(progress: number, tick = 0, still = false): string {
  const p = Math.max(0, Math.min(1, progress));
  const lag = [0, 0.08, 0.04];
  const gap = '  ';
  const heights = lag.map((l) => Math.round(Math.max(0, Math.min(1, (p - l) / (1 - l))) * GROW_ROWS));
  const lines: string[] = [];
  // 顶上一行留给飘起的种子
  const sky = Array.from({ length: W * 3 + gap.length * 2 }, () => ' ');
  if (!still && p < 1 && tick % 3 !== 2) {
    const x = (tick * 5 + 3) % sky.length;
    sky[x] = tick % 2 ? '·' : "'";
  }
  lines.push(sky.join(''));
  for (let y = 0; y < GROW_ROWS; y++) {
    const row = heights.map((h, k) => {
      if (y < GROW_ROWS - h) return ' '.repeat(W);
      const top = y === GROW_ROWS - h;
      if (top && h === GROW_ROWS && !still && (tick + k) % 4 === 0) return SWAY;
      return STALK[y];
    });
    lines.push(row.join(gap));
  }
  lines.push(['.,;|;,.', '.,;|;,.', '.,;|;,.'].join(gap));
  return lines.join('\n');
}
