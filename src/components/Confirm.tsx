import { m } from './rw/lite';
import { useEffect, useRef, useState } from 'react';
import type { ConfirmOpts } from '../lib/store';

export type ConfirmReq = ConfirmOpts & { resolve: (ok: boolean) => void };

/** 确认弹层：浮起的圆角卡片（手机贴底、桌面居中），弹簧进场；危险操作主按钮是柔和的红色药丸「删掉」，次按钮「留着」。Esc / 点外面 = 留着 */
export function ConfirmLayer({ req, onDone }: { req: ConfirmReq | null; onDone: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    setWhy(null);
    setText('');
  }, [req]);
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
    if (ok && req.reasons) req.reasons.onPick(why, why === req.reasons.custom ? text.trim() : undefined);
    req.resolve(ok);
    onDone();
  };
  const r = req.reasons;
  return (
    <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <m.div className="confirm" role="alertdialog" aria-modal="true" aria-label={req.title} initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
        <h2 className="confirm-title">{req.title}</h2>
        {req.body && <p className="confirm-body">{req.body}</p>}
        {r && (
          <div className="confirm-reasons">
            <span className="label">为什么不要（可不选）</span>
            <div className="chips reason-chips" role="radiogroup" aria-label="为什么不要">
              {r.options.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={why === o.id} className={`chip reason${why === o.id ? ' on' : ''}`} data-reason={o.id} onClick={() => setWhy(why === o.id ? null : o.id)}>
                  {o.label}
                </button>
              ))}
              {r.custom && (
                <button type="button" role="radio" aria-checked={why === r.custom} className={`chip reason${why === r.custom ? ' on' : ''}`} data-reason={r.custom} onClick={() => setWhy(why === r.custom ? null : r.custom!)}>
                  自定义
                </button>
              )}
            </div>
            {r.custom && why === r.custom && (
              <input className="line-input reason-input" autoFocus maxLength={40} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && close(true)} placeholder="一句话：哪里不对" aria-label="自定义理由" />
            )}
          </div>
        )}
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
