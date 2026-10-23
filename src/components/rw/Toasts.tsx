import { AnimatePresence, m } from 'framer-motion';

export interface ToastT {
  id: number;
  msg: string;
  kind: 'ok' | 'err';
  action?: { label: string; run: () => void };
  ms: number;
}

/**
 * 轻提示：深色胶囊从底部弹起（AnimatePresence + 弹簧，照 Rewamp 导航提示气泡的 y/scale 进出），
 * 带撤销的那条底部有一根倒计时细线。手机浮在速记与导航上方，桌面在右下角。
 */
export function Toasts({ toasts, dismiss }: { toasts: ToastT[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <m.div
            key={t.id}
            layout
            className={`toast ${t.kind}${t.action ? ' has-action' : ''}`}
            style={{ ['--ms' as string]: `${t.ms}ms` }}
            initial={{ opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <span className="toast-dot" aria-hidden />
            <span className="toast-msg">{t.msg}</span>
            {t.action && (
              <button
                className="toast-act"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            {t.action && <i className="toast-timer" aria-hidden />}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
