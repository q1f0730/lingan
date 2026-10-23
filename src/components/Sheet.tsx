import { m } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconPlus } from './rw/icons';

/**
 * v0.20 Rewamp：覆盖层是一张浮起的大圆角面板，进场用弹簧（y + 透明度），背后是暖灰半透明遮罩。
 * - 手机：page（详情 / 编辑）从底部升起铺满，顶部留一条拖拽把手；capture（速记展开）是贴底的半屏抽屉。
 * - 桌面：page 是居中的宽面板（详情左图右文两栏），capture 是右上角弹出的 520px 卡片。
 * 只做进场、不做退场动画：关掉立刻消失，避免两层叠在一起时点错。
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  variant = 'page',
  aside,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: 'page' | 'capture';
  aside?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    // 整页层盖住时，底下页面别跟着滚
    const prev = document.body.style.overflow;
    if (variant === 'page') document.body.style.overflow = 'hidden';
    ref.current?.scrollTo?.(0, 0);
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, variant]);
  if (!open) return null;
  return (
    <div className={`sheet-backdrop v-${variant}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <m.div
        ref={ref}
        className={`sheet v-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 28, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      >
        <span className="sheet-grip" aria-hidden />
        <header className="sheet-head">
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconPlus size={18} className="icon-x" />
            <span>{variant === 'page' ? '返回' : '收起'}</span>
          </button>
          <h2 className="sheet-title">{title}</h2>
          <span className="sheet-aside">{aside}</span>
        </header>
        <div className="sheet-body">{children}</div>
      </m.div>
    </div>
  );
}
