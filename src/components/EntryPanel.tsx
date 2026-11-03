import { useEffect, useState } from 'react';
import { getEntry, keyFromEvent, prettyKey, setAutostart, setKeys, shotNow, type EntryState, type Hotkeys } from '../lib/entry';
import { useApp } from '../lib/store';

/** v0.33 设置 → 极速采集（桌面版）：开机静默启动 0516、热键可改 + 冲突检测 0515、带上选中文字 0004、摘抄热键 0507
 *  v0.36：0005 框选截图热键、0020 识别旧图里的字（系统 OCR） */
export function EntryPanel() {
  const { toast } = useApp();
  const [st, setSt] = useState<EntryState | null>(null);
  const [rec, setRec] = useState<keyof Hotkeys | null>(null);
  const [ocr, setOcr] = useState('');
  useEffect(() => {
    void getEntry().then(setSt, () => {});
  }, []);
  async function put(keys: Hotkeys) {
    const r = await setKeys(keys);
    setSt(r);
    const e = r.errors[0];
    if (e) toast(`${prettyKey(keys[e[0] as 'quick'] || '')}：${e[1]}`, 'err');
  }
  useEffect(() => {
    if (!rec || !st) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRec(null);
      const k = e.key === 'Backspace' && rec !== 'quick' ? '' : keyFromEvent(e);
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
  async function backfill() {
    if (ocr) return;
    setOcr('…');
    const { ocrBackfill, OCR_HINT } = await import('../lib/ocr');
    const r = await ocrBackfill((n, t) => setOcr(`${n} / ${t}`));
    setOcr('');
    toast(r.nolang ? OCR_HINT : `认完 ${r.done} 张，${r.found} 张里有字，秒搜能搜到了`, r.nolang ? 'err' : 'ok');
  }
  const keyRow = (a: 'quick' | 'excerpt' | 'shot', title: string, note: string) => (
    <button className={`trow cap-switch cap-key-${a}`} onClick={() => setRec(rec === a ? null : a)}>
      <span className="tc tc-title">{title}</span>
      <span className="tc tc-src">{rec === a ? '按下新组合 · Esc 取消' + (a !== 'quick' ? ' · 退格关掉' : '') : err(a) || note}</span>
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
      {keyRow('shot', '框选截图热键', '调系统截图框一块，截完小窗带着图，补一句就存；图里的字自动认出来')}
      <button className="trow cap-switch cap-shot-now" onClick={() => void shotNow()}>
        <span className="tc tc-title">现在截一张</span>
        <span className="tc tc-src">托盘菜单「框选截图拾」也行</span>
        <span className="tc tc-date">截</span>
      </button>
      <button className="trow cap-switch cap-ocr" onClick={() => void backfill()}>
        <span className="tc tc-title">识别旧图里的字</span>
        <span className="tc tc-src">Windows 自带 OCR，离线、不发给任何人；手机上收的图在这里补认</span>
        <span className="tc tc-date">{ocr || '认'}</span>
      </button>
    </div>
  );
}
