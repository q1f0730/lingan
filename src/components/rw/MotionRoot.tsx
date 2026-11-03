import { LazyMotion, MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { afterFirstPaint, type MotionLevel } from '../../lib/motion';

// 首屏画完再加载动画特性包：之前的弹簧 / 滑块直接显示最终状态，不影响使用
const loadFeatures = () => afterFirstPaint().then(() => import('./features')).then((r) => r.default);

/**
 * Rewamp UI 的组件都用 Framer Motion 写动效。这里用 LazyMotion + `m.*`：首包只带极小的渲染器，
 * 动画特性（domMax，含 layoutId）在首屏后异步加载，不拖冷启动。
 * 减少动态效果（系统设置或低端机判为 off）时一律不动，只保留最终状态。
 */
export function MotionRoot({ level, children }: { level: MotionLevel; children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion={level === 'off' ? 'always' : 'user'}>{children}</MotionConfig>
    </LazyMotion>
  );
}

/** 弹簧参数：照 Rewamp 的 morphing-tab / magnetic-pill / sidebar（stiffness 420, damping 30） */
export const SPRING = { type: 'spring', stiffness: 420, damping: 30 } as const;
export const SPRING_SOFT = { type: 'spring', stiffness: 300, damping: 28 } as const;
