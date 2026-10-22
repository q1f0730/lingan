// 图片 ASCII 显影：纯函数部分（可单测）。画布绘制在 components/AsciiDevelop.tsx。

/** 从暗到亮的字符梯度（暗处用密字符，亮处留白） */
export const RAMP = '@%#*+=-:. ';

export function lumToChar(lum: number): string {
  const l = Math.min(1, Math.max(0, Number.isFinite(lum) ? lum : 0));
  return RAMP[Math.min(RAMP.length - 1, Math.floor(l * RAMP.length))];
}

/** 按图片宽高比算出字符网格；字符格约 1:2（高:宽），所以行数要折半 */
export function gridFor(w: number, h: number, cols = 44): { cols: number; rows: number } {
  const c = Math.max(8, Math.round(cols));
  if (!(w > 0) || !(h > 0)) return { cols: c, rows: Math.round(c / 2) };
  const rows = Math.max(4, Math.min(120, Math.round((c * h) / w / 2)));
  return { cols: c, rows };
}

/** 确定性伪随机（mulberry32），让同一张图每次显影的“雾散开”顺序一致 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 每个格子的“显影时刻”(0..1)：从画面中心向外扩散 + 噪声，
 * 中心先显影成照片，边缘最后。progress 到 t 时该格已变成真实照片。
 */
export function revealTimes(cols: number, rows: number, seed = 1): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = (x + 0.5) / cols - 0.5;
      const dy = (y + 0.5) / rows - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) / 0.7072; // 0..1
      out[y * cols + x] = Math.min(1, Math.max(0, d * 0.7 + r() * 0.3));
    }
  }
  return out;
}

/** 给定进度 p(0..1)，返回应当已显影的格子数（用于测试与增量清除） */
export function revealedCount(times: Float32Array, p: number): number {
  let n = 0;
  for (let i = 0; i < times.length; i++) if (times[i] <= p) n++;
  return n;
}

/** 把亮度数组转成多行 ASCII 文本（测试 / 无画布时的兜底） */
export function lumToText(lums: ArrayLike<number>, cols: number, rows: number): string {
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) s += lumToChar(lums[y * cols + x]);
    lines.push(s);
  }
  return lines.join('\n');
}

/** 等待时的小动画：一排种子轻轻起伏 */
export const SPINNER = ['·  ', '·· ', '···', ' ··', '  ·', '   '];

const SPROUT = [
  '    \'v`    ',
  '    `#\'    ',
  '   \\ # /   ',
  '    \\|/    ',
  '     |     ',
  '    /|     ',
  ' .,;:|:;,. ',
];

/** 空状态：一根麦子从土里慢慢长出来（自下而上，9 帧，最后一帧是完整的穗） */
export function sproutFrames(): string[] {
  const rows = SPROUT.length;
  const frames: string[] = [];
  for (let s = 0; s <= 8; s++) {
    const shown = Math.round((s / 8) * rows); // 从下往上露出几行
    const lines = SPROUT.map((line, y) => (y >= rows - shown ? line : ' '.repeat(line.length)));
    frames.push(lines.join('\n'));
  }
  return frames;
}

/**
 * 图片 ASCII 显影的字符颜色：用像素自己的颜色，但保证在纸上读得出。
 * 浅色纸：太亮的颜色压暗；深色纸（夜晚）：太暗的颜色提亮。返回 rgb 字符串。
 */
export function inkOnPaper(r: number, g: number, b: number, dark: boolean): string {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  let k = 1;
  if (!dark && lum > 0.58) k = 0.58 / lum;
  if (dark && lum < 0.45) k = lum > 0.02 ? 0.45 / lum : 1;
  let R = r * k;
  let G = g * k;
  let B = b * k;
  if (dark && lum <= 0.02) R = G = B = 115;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c(R)},${c(G)},${c(B)})`;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
