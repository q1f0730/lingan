import { useEffect, useState } from 'react';
import { getEntry, keyFromEvent, prettyKey, setAutostart, setKeys, type EntryState, type Hotkeys } from '../lib/entry';
import { useApp } from '../lib/store';

/** v0.33 设置 → 极速采集（桌面版）：开机静默启动 0516、热键可改 + 冲突检测 0515、带上选中文字 0004、摘抄热键 0507 */
export function EntryPanel() {
  const { toast } = useApp();
  const [st, setSt] = useState<EntryState | null>(null);
  const [rec, setRec] = useState<keyof Hotkeys | null>(null);
  useEffect(() => {
    void getEntry().then(setSt, () => {});
  }, []);
  async function put(keys: Hotkeys) {
    const r = await setKeys(keys);
    setSt(r);
    const e = r.errors[0];
    if (e) toast(`${prettyKey(e[0] === 'quick' ? keys.quick : keys.excerpt)}：${e[1]}`, 'err');
  }
  useEffect(() => {
    if (!rec || !st) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRec(null);
      const k = e.key === 'Backspace' && rec === 'excerpt' ? '' : keyFromEvent(e);
      if (k === '' && e.key !== 'Backspace') return;
      setRec(null);
      void put({ ...st.keys, [rec]: k });
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, st]);
  if (!st) return null;
  const err = (a: string) => st.errors.find((x) => x[0] === a)?.[1];
  const keyRow = (a: 'quick' | 'excerpt', title: string, note: string) => (
    <button className={`trow cap-switch cap-key-${a}`} onClick={() => setRec(rec === a ? null : a)}>
      <span className="tc tc-title">{title}</span>
      <span className="tc tc-src">{rec === a ? '按下新组合 · Esc 取消' + (a === 'excerpt' ? ' · 退格关掉' : '') : err(a) || note}</span>
      <span className="tc tc-date">{st.keys[a] ? prettyKey(st.keys[a]) : '关'}</span>
    </button>
  );
  return (
    <div className="table action-table entry-panel">
      <button
        className="trow cap-switch cap-autostart"
        role="switch"
        aria-checked={st.autostart}
        onClick={() =>
          void setAutostart(!st.autostart).then(
            (on) => setSt({ ...st, autostart: on }),
            (e) => toast(String(e), 'err'),
          )
        }
      >
        <span className="tc tc-title">开机静默启动</span>
        <span className="tc tc-src">只进托盘不弹窗，第一次唤出不用等</span>
        <span className="tc tc-date">{st.autostart ? '开' : '关'}</span>
      </button>
      {keyRow('quick', '速记热键', '在任何程序里唤出小窗')}
      <button className="trow cap-switch cap-grab" role="switch" aria-checked={st.keys.grab} onClick={() => void put({ ...st.keys, grab: !st.keys.grab })}>
        <span className="tc tc-title">带上选中的文字</span>
        <span className="tc tc-src">唤出小窗时把别处选中的字填进去</span>
        <span className="tc tc-date">{st.keys.grab ? '开' : '关'}</span>
      </button>
      {keyRow('excerpt', '摘抄热键', '选中即存成摘抄，不弹窗（如 Ctrl+Shift+C，会盖过浏览器开发者工具）')}
    </div>
  );
}
