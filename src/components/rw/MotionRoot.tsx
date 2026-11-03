import type { ReactNode } from 'react';
import { afterFirstPaint, type MotionLevel } from '../../lib/motion';
import { motionReady, ReducedCtx } from './lite';

// 首屏画完才开始播动画：之前的弹簧 / 进场直接显示最终状态，不影响使用、不拖冷启动
void afterFirstPaint().then(motionReady);

/**
 * Rewamp UI 的组件用 `m.*` 写动效（v0.38 起是自写的 ./lite，WAAPI；以前是 Framer Motion）。
 * 减少动态效果（系统设置或低端机判为 off）时一律不动，只保留最终状态。
 */
export function MotionRoot({ level, children }: { level: MotionLevel; children: ReactNode }) {
  return <ReducedCtx.Provider value={level === 'off'}>{children}</ReducedCtx.Provider>;
}

/** 弹簧参数：照 Rewamp 的 morphing-tab / magnetic-pill / sidebar（stiffness 420, damping 30） */
export const SPRING = { type: 'spring', stiffness: 420, damping: 30 } as const;
export const SPRING_SOFT = { type: 'spring', stiffness: 300, damping: 28 } as const;
