import { useEffect, useRef, type ReactNode } from 'react';

/**
 * v0.16 Studio：整页覆盖层（详情 / 编辑，左上「返回」）或贴底的速记展开层（顶部一条 1px 黑线）。
 * 无圆角、无阴影；桌面上 page 变体是多栏整页，capture 变体是顶栏下方的一块面板。
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
      <div ref={ref} className={`sheet v-${variant}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head">
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            {variant === 'page' ? '返回' : '收起'}
          </button>
          <h2 className="sheet-title">{title}</h2>
          <span className="sheet-aside">{aside}</span>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
