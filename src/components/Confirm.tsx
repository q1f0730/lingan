import { m } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { ConfirmOpts } from '../lib/store';

export type ConfirmReq = ConfirmOpts & { resolve: (ok: boolean) => void };

/** 确认弹层：浮起的圆角卡片（手机贴底、桌面居中），弹簧进场；危险操作主按钮是柔和的红色药丸「删掉」，次按钮「留着」。Esc / 点外面 = 留着 */
export function ConfirmLayer({ req, onDone }: { req: ConfirmReq | null; onDone: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!req) return;
    okRef.current?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        req.resolve(false);
        onDone();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [req, onDone]);
  if (!req) return null;
  const close = (ok: boolean) => {
    req.resolve(ok);
    onDone();
  };
  return (
    <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <m.div className="confirm" role="alertdialog" aria-modal="true" aria-label={req.title} initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
        <h2 className="confirm-title">{req.title}</h2>
        {req.body && <p className="confirm-body">{req.body}</p>}
        <div className="confirm-actions">
          <button ref={okRef} className={`btn primary confirm-ok${req.danger ? ' danger' : ''}`} onClick={() => close(true)}>
            {req.ok}
          </button>
          <button className="btn text confirm-cancel" onClick={() => close(false)}>
            {req.cancel || '取消'}
          </button>
        </div>
      </m.div>
    </div>
  );
}
