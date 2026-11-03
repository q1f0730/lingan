import type { ReactNode } from 'react';
import { Glide } from './Glide';

/**
 * Rewamp「Magnetic Pill Navbar」移植成分段切换：浅色轨道里一颗白色药丸跟着选中项滑动（v0.34 起 Glide 滑块，代替 layoutId）。
 * 用在 网格 / 列表 / 时间线 / 月历、外观 跟随系统 / 白 / 黑 这类二选一、四选一。
 */
export function Seg<T extends string>({ id, value, options, onPick, className = '', role = 'tablist', label }: { id: string; value: T; options: Array<[T, ReactNode]>; onPick: (v: T) => void; className?: string; role?: 'tablist' | 'radiogroup'; label?: string }) {
  return (
    <div className={`rw-seg ${className}`} role={role} aria-label={label}>
      {options.map(([k, text]) => {
        const on = k === value;
        return (
          <button key={k} type="button" role={role === 'tablist' ? 'tab' : 'radio'} aria-selected={role === 'tablist' ? on : undefined} aria-checked={role === 'radiogroup' ? on : undefined} className={on ? 'on' : ''} onClick={() => onPick(k)}>
            {on && <Glide id={`seg-${id}`} className="rw-seg-pill" />}
            <span className="rw-seg-t">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
