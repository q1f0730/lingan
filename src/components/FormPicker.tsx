import '../styles/works.css';
import type { WorkForm } from '../lib/types';
import { FORM_ORDER, FORMS } from '../lib/works';

/** v0.29 0302 形态选择：立项 / 新建空白作品时用 */
export function FormPicker({ onPick, busy }: { onPick: (f: WorkForm) => void; busy?: boolean }) {
  return (
    <div className="work-forms" role="group" aria-label="选一个形态">
      {FORM_ORDER.map((f) => (
        <button key={f} className="work-form" data-form={f} disabled={busy} onClick={() => onPick(f)}>
          <span className="work-form-name">{FORMS[f].label}</span>
          <span className="work-form-hint">{FORMS[f].hint}</span>
        </button>
      ))}
    </div>
  );
}
