// 「哇」第二弹：动效的纯逻辑（可单测）。组件在 components/Motion.tsx。
// 思路参考 reactbits.dev（MIT）的 ScrambledText / DecryptedText / Magnet / ClickSpark，自己重写成零依赖版本。

export type MotionLevel = 'full' | 'lite' | 'off';

/** 判断动效档位：用户要求减少动效 → off；低端机（核心少/内存小/省流量）→ lite；其余 full */
export function motionLevel(env: {
  reduced?: boolean;
  cores?: number;
  memory?: number;
  saveData?: boolean;
}): MotionLevel {
  if (env.reduced) return 'off';
  if (env.saveData) return 'lite';
  if (typeof env.cores === 'number' && env.cores > 0 && env.cores <= 4) return 'lite';
  if (typeof env.memory === 'number' && env.memory > 0 && env.memory <= 2) return 'lite';
  return 'full';
}

export function detectMotionLevel(): MotionLevel {
  if (typeof window === 'undefined') return 'off';
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return motionLevel({
    reduced: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    saveData: nav.connection?.saveData,
  });
}

/** 卡片入场错落延迟（毫秒）：前 max 张依次延迟，更靠后的不再延迟，避免长列表等很久 */
export function staggerDelay(index: number, step = 45, max = 12): number {
  if (!(index > 0)) return 0;
  return Math.min(Math.floor(index), max) * step;
}

const GLYPHS = '▒░▓█▌▐#%@*+=-:.01';

/** 文字解码：progress 0..1，已“解出”的字符保持原样，其余是乱码（空白与标点保留，长度不变） */
export function decodeFrame(text: string, progress: number, seed = 1): string {
  const chars = Array.from(text);
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  if (p >= 1) return text;
  const solved = Math.floor(chars.length * p);
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return chars
    .map((c, i) => {
      const r = rnd();
      if (i < solved || /[\s，。、；：！？,.;:!?《》「」“”‘’()（）\-—]/.test(c)) return c;
      return GLYPHS[Math.floor(r * GLYPHS.length)];
    })
    .join('');
}

/** 逐字浮现：长度 len 的文字，在 progress(0..1) 时已显示多少个字符 */
export function revealCount(len: number, progress: number): number {
  if (!(len > 0)) return 0;
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return Math.min(len, Math.floor(len * p + 1e-9));
}

/** 逐字浮现总时长（毫秒）：约每秒 70 字，夹在 600~3500ms 之间 */
export function typeDuration(len: number): number {
  return Math.min(3500, Math.max(600, Math.round((len / 70) * 1000)));
}

/** 磁吸：鼠标相对按钮中心的偏移 → 按钮位移（像素），限制最大 max，超出 range 不吸 */
export function magnetOffset(dx: number, dy: number, range = 70, max = 6): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (!(d > 0) || d > range) return { x: 0, y: 0 };
  const k = (1 - d / range) * max;
  return { x: +((dx / d) * k).toFixed(2), y: +((dy / d) * k).toFixed(2) };
}
