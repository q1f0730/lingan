// v0.30 设置 · 出站：ROADMAP v0.25「发出去前看一眼」的开关（关 / 每次 / 只看一次）+ 0906 出站清单（本月按域名汇总、最近 20 次）。
import { useEffect, useState } from 'react';
import { clearLog, KIND_LABEL, monthSummary, previewMode, readLog, setPreviewMode, type PreviewMode } from '../lib/outbound';
import '../styles/v030.css';

const MODES: Array<{ id: PreviewMode; label: string }> = [
  { id: 'off', label: '不看' },
  { id: 'once', label: '只看一次' },
  { id: 'always', label: '每次' },
];
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);

export function OutboundPanel() {
  const [mode, setMode] = useState<PreviewMode>(previewMode);
  const [log, setLog] = useState(readLog);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setLog(readLog());
    window.addEventListener('glean:outbound', on);
    return () => window.removeEventListener('glean:outbound', on);
  }, []);
  const sum = monthSummary(log);
  const recent = [...log].reverse().slice(0, 20);
  const pick = (m: PreviewMode) => {
    setPreviewMode(m);
    setMode(m);
  };
  return (
    <section className="set-sec outbound" id="set-out">
      <h2 className="sec-title">出站</h2>
      <p className="meta-text">拾穗什么时候往外发东西、发给谁、发了哪几类。只记域名、种类、字段类别和大小，不记内容、不记密钥，只存在本机。</p>
      <div className="field out-mode">
        <span className="label">调模型前，发出去前看一眼</span>
        <div className="seg out-seg" role="radiogroup" aria-label="发出去前看一眼">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} data-mode={m.id} className={mode === m.id ? 'on' : ''} onClick={() => pick(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="meta-text out-mode-note">{mode === 'off' ? '直接发。' : mode === 'once' ? '这次打开 App 后第一次调模型时看一眼，之后直接发。' : '每次调模型前都弹出这次要发的全部文字；图片像素默认不上传，要勾选。'}</p>
      </div>
      <div className="out-month">
        <span className="label">本月发出去了什么</span>
        {sum.length ? (
          <div className="table out-table">
            <div className="thead">
              <span className="tc">去哪</span>
              <span className="tc">次数</span>
              <span className="tc">发了</span>
            </div>
            {sum.map((g) => (
              <div key={g.host} className="trow static out-row" data-host={g.host}>
                <span className="tc tc-title out-host">{g.host}</span>
                <span className="tc num out-n">
                  {g.n}
                  {g.fail ? <span className="dim"> · 失败 {g.fail}</span> : null}
                </span>
                <span className="tc out-fields meta-text">
                  {g.fields.join(' / ')} · {g.kinds.map((k) => KIND_LABEL[k]).join('、')} · {kb(g.bytes)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="meta-text out-none">这个月还没有往外发过东西。</p>
        )}
      </div>
      {log.length > 0 && (
        <div className="actions">
          <button className="btn text out-recent" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
            {open ? '收起' : `最近 ${Math.min(20, log.length)} 次`}
          </button>
          <button className="btn text faint out-clear" onClick={() => (clearLog(), setLog([]))}>
            清空记录
          </button>
        </div>
      )}
      {open && (
        <ol className="out-list">
          {recent.map((r, i) => (
            <li key={i} className={r.ok ? '' : 'fail'}>
              <span className="num">{new Date(r.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> {r.host} · {KIND_LABEL[r.kind]} · {r.fields.join(' / ')} · {kb(r.bytes)}
              {r.stripped ? ` · 拿掉了 ${r.stripped} 张图` : ''}
              {r.ok ? '' : ' · 没成'}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
