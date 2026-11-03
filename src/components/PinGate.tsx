// v0.39 0907 上锁的穗：输 PIN 才显示（解锁 5 分钟，切到后台就重新锁上）
import { useState } from 'react';

export function PinGate({ onClose, title = '这一穗上锁了' }: { onClose?: () => void; title?: string }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    const P = await import('../lib/lockpin');
    const wait = P.waitLeft();
    if (wait) {
      setErr(`输错太多次，${wait} 秒后再试`);
      setBusy(false);
      return;
    }
    const ok = await P.checkPin(pin);
    setBusy(false);
    if (!ok) {
      setPin('');
      setErr(P.waitLeft() ? '输错太多次，30 秒后再试' : 'PIN 不对');
    }
  }
  return (
    <form className="pin-gate" onSubmit={go}>
      <div className="label">上锁</div>
      <h2 className="detail-title">{title}</h2>
      <p className="meta-text">输入这台设备上的 PIN，解锁 5 分钟；切到后台就重新锁上。</p>
      <input className="pin-input" type="password" inputMode="numeric" autoComplete="off" aria-label="PIN" maxLength={12} value={pin} onChange={(e) => (setPin(e.target.value.replace(/\D/g, '')), setErr(''))} autoFocus />
      {err && <p className="error pin-err">{err}</p>}
      <div className="actions">
        <button className="btn primary pin-go" type="submit" disabled={busy || pin.length < 4}>
          {busy ? '核对中…' : '解锁'}
        </button>
        {onClose && (
          <button className="btn text" type="button" onClick={onClose}>
            算了
          </button>
        )}
      </div>
    </form>
  );
}
