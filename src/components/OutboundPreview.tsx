// v0.30 ROADMAP v0.25「发出去前看一眼」：调模型前弹一张纸片，显示这次会发出去的全部文字、是否含图片（默认不上传）。
// 只在打开了预览、真的要发请求时才加载（自己挂一个 React 根，首屏和 App 都不碰它）。
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KIND_LABEL, type PreviewAnswer, type PreviewReq } from '../lib/outbound';
import '../styles/v030.css';

function Paper({ req, done }: { req: PreviewReq; done: (a: PreviewAnswer) => void }) {
  const [img, setImg] = useState(false);
  return (
    <div className="confirm-backdrop out-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done({ ok: false, images: false })}>
      <div className="confirm out-paper" role="alertdialog" aria-modal="true" aria-label="发出去前看一眼">
        <h2 className="confirm-title">发出去前看一眼</h2>
        <p className="out-meta meta-text">
          发给 <b>{req.host}</b> · {KIND_LABEL[req.kind]}
          {req.model ? ` · ${req.model}` : ''}
          {typeof req.temperature === 'number' ? ` · 温度 ${req.temperature}` : ''} · {req.text.length} 字
        </p>
        <pre className="out-text" tabIndex={0}>
          {req.text}
        </pre>
        {req.images > 0 ? (
          <label className="out-img">
            <input type="checkbox" checked={img} onChange={(e) => setImg(e.target.checked)} />
            <span>这次上传图片像素（{req.images} 张）。不勾就只发文字。</span>
          </label>
        ) : (
          <p className="out-noimg meta-text">不含图片。</p>
        )}
        <div className="confirm-actions">
          <button className="btn primary confirm-ok out-send" autoFocus onClick={() => done({ ok: true, images: img })}>
            发出去
          </button>
          <button className="btn text confirm-cancel out-cancel" onClick={() => done({ ok: false, images: false })}>
            不发了
          </button>
        </div>
      </div>
    </div>
  );
}

let chain: Promise<unknown> = Promise.resolve();
/** 一次只弹一张（嫁接两步、并发的看图排队来） */
export function showPreview(req: PreviewReq): Promise<PreviewAnswer> {
  const run = () =>
    new Promise<PreviewAnswer>((resolve) => {
      const host = document.createElement('div');
      host.className = 'out-host';
      document.body.appendChild(host);
      const root = createRoot(host);
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish({ ok: false, images: false });
      const finish = (a: PreviewAnswer) => {
        window.removeEventListener('keydown', onKey);
        root.unmount();
        host.remove();
        resolve(a);
      };
      window.addEventListener('keydown', onKey);
      root.render(<Paper req={req} done={finish} />);
    });
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
