// v0.16 Studio：动效只剩两种——进入视口淡入、图片缓慢放大（见 index.css）。这里只留档位判断与错开延迟。

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
export function staggerDelay(index: number, step = 40, max = 8): number {
  if (!(index > 0)) return 0;
  return Math.min(Math.floor(index), max) * step;
}
