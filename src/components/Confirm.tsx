import { useEffect, useRef } from 'react';
import type { ConfirmOpts } from '../lib/store';

export type ConfirmReq = ConfirmOpts & { resolve: (ok: boolean) => void };

/** 确认弹层（m31）：贴底白板，顶部 1px 黑线；主按钮黑底「删掉」，次按钮文字「留着」。Esc / 点外面 = 留着 */
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
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={req.title}>
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
      </div>
    </div>
  );
}
