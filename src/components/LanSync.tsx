// v0.32 设置 · 局域网直连（ROADMAP「手机电脑同一片麦田」+ 0645 二维码配对）。
// 电脑：开柜子 → 显示一次性二维码；手机：扫码（相机，或从相册选二维码截图）→ 配对并同步。
// 同步引擎、二维码生成（lib/qrcode.ts）只在点按钮时动态加载；识别用系统 BarcodeDetector 或安卓原生 ZXing（LinganQr 桥）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store';
import { readLan, type LanCfg as Lan } from '../lib/syncsummary';

const when = (t?: number) => {
  if (!t) return '—';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const canHost = () => typeof window !== 'undefined' && (!!(window as { __gleanLanHost?: unknown }).__gleanLanHost || ('__TAURI_INTERNALS__' in window && !/Android/i.test(navigator.userAgent)));

/** 从一帧图像里认二维码：先用系统的 BarcodeDetector（有 Google 服务的安卓 / Chrome 才有），
 * 没有就交给安卓原生的 ZXing（LinganQr 桥，APK 里自带，不占网页包体积）；都没有返回 null（网页版：改用粘贴链接） */
type QrBridge = { decode(jpegB64: string): string };
function canScan(): boolean {
  const w = window as unknown as { BarcodeDetector?: unknown; LinganQr?: QrBridge };
  return !!(w.BarcodeDetector || w.LinganQr);
}
async function decode(src: CanvasImageSource, w: number, h: number): Promise<string | null> {
  const win = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(s: CanvasImageSource): Promise<Array<{ rawValue: string }>> }; LinganQr?: QrBridge };
  if (win.BarcodeDetector) {
    try {
      const r = await new win.BarcodeDetector({ formats: ['qr_code'] }).detect(src);
      if (r[0]?.rawValue) return r[0].rawValue;
    } catch {
      /* 系统的不行就退到原生 */
    }
  }
  if (!win.LinganQr) return null;
  const scale = Math.min(1, 1000 / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * scale));
  cv.height = Math.max(1, Math.round(h * scale));
  const g = cv.getContext('2d');
  if (!g) return null;
  g.drawImage(src, 0, 0, cv.width, cv.height);
  const b64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1] || '';
  return win.LinganQr.decode(b64) || null;
}

export function LanSync({ version }: { version: string }) {
  const [cfg, setCfg] = useState<Lan | null>(readLan);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [qr, setQr] = useState<{ svg: string; expires: number; where: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [left, setLeft] = useState(0);
  const [paste, setPaste] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { confirm: ask } = useApp();
  const lib = () => import('../lib/sync');

  useEffect(() => {
    const on = () => setCfg(readLan());
    const paired = () => {
      setQr(null);
      setMsg('手机配好了，正在合并。');
    };
    window.addEventListener('glean:sync', on);
    window.addEventListener('glean:lan-paired', paired);
    return () => {
      window.removeEventListener('glean:sync', on);
      window.removeEventListener('glean:lan-paired', paired);
    };
  }, []);
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((qr.expires - Date.now()) / 1000));
      setLeft(s);
      if (!s) setQr(null);
    }, 1000);
    return () => clearInterval(t);
  }, [qr]);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr('');
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setErr((e as Error)?.message || String(e));
    } finally {
      setBusy('');
    }
  }, []);

  const stopCam = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setScanning(false);
  };
  useEffect(() => stopCam, []);

  const pairWith = (text: string) =>
    run('配对中…', async () => {
      const m = await lib();
      const st = await m.lanPair(text, version);
      setMsg(`已连上电脑。${m.describe(st)}`);
    });

  const showQr = () =>
    run('生成二维码…', async () => {
      await (await lib()).lanHostStart(version);
      await showQrInner();
    });

  const enable = () =>
    run('开启中…', async () => {
      await (await lib()).lanHostStart(version);
      await showQrInner();
    });
  const showQrInner = async () => {
    const m = await lib();
    const o = await m.lanOffer();
    const { qrSvg } = await import('../lib/qrcode');
    setLeft(600);
    setQr({ svg: qrSvg(o.text), expires: o.expires, where: `${o.hosts[0]}:${o.port}` });
  };

  const scan = () =>
    run('打开相机…', async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('这里开不了相机：改用「从相册选二维码截图」');
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        throw new Error('相机没打开：在系统设置里允许拾穗用相机');
      }
      setScanning(true);
      requestAnimationFrame(() => {
        const v = video.current;
        if (!v || !stream.current) return;
        v.srcObject = stream.current;
        void v.play().catch(() => undefined);
        let stop = false;
        const tickScan = async () => {
          if (stop || !stream.current) return;
          if (v.videoWidth) {
            const text = await decode(v, v.videoWidth, v.videoHeight).catch(() => null);
            if (text && /^glean:\/\/lan\?/i.test(text)) {
              stop = true;
              stopCam();
              void pairWith(text);
              return;
            }
          }
          setTimeout(() => void tickScan(), 250);
        };
        void tickScan();
      });
    });

  const fromPhoto = (f: File | undefined) => {
    if (!f) return;
    void run('认二维码…', async () => {
      const bmp = await createImageBitmap(f);
      const text = await decode(bmp, bmp.width, bmp.height);
      bmp.close?.();
      if (!text) throw new Error('没认出二维码：把整个二维码截进来');
      await (await lib()).lanPair(text, version).then(async (st) => setMsg(`已连上电脑。${(await lib()).describe(st)}`));
    });
  };

  const syncNow = () =>
    run('同步中…', async () => {
      const m = await lib();
      setMsg(m.describe(await m.runLanSync({ appVersion: version, onProgress: (p) => setBusy(p) })));
    });
  const off = () =>
    run('断开中…', async () => {
      if (!(await ask({ title: '断开局域网直连？', body: cfg?.role === 'host' ? '关掉柜子、忘掉局域网数据钥；手机要重新扫码。已有的穗不动。' : '忘掉电脑和局域网数据钥。已有的穗不动。', ok: '断开', cancel: '算了', danger: true }))) return;
      setQr(null);
      await (await lib()).lanDisconnect();
    });

  const status = busy ? <p className="meta-text sync-busy" aria-live="polite">{busy}</p> : err ? <p className="meta-text sync-err lan-err" role="alert">{err}</p> : msg ? <p className="meta-text sync-msg lan-msg" aria-live="polite">{msg}</p> : null;

  const scanner = (
    <>
      {scanning && (
        <div className="lan-scan">
          <video ref={video} className="lan-video" playsInline muted aria-label="相机取景" />
          <p className="meta-text">把电脑上的二维码放进框里</p>
          <button className="btn text lan-scan-stop" onClick={stopCam}>
            不扫了
          </button>
        </div>
      )}
      <input ref={file} className="lan-file" type="file" accept="image/*" hidden onChange={(e) => {
          fromPhoto(e.target.files?.[0]);
          e.target.value = '';
        }} />
    </>
  );

  // ── 没开 ──
  if (!cfg) {
    const host = canHost();
    return (
      <section className="set-sec lan-panel" id="set-lan">
        <h2 className="sec-title">局域网直连</h2>
        <p className="meta-text">同一个 Wi-Fi 下手机和电脑直接同步，不经过任何服务器，只传对方没有的。电脑开着拾穗，手机扫它显示的二维码。</p>
        <div className="actions">
          {host ? (
            <button className="btn primary lan-enable" onClick={enable} disabled={!!busy}>
              在这台电脑上开启
            </button>
          ) : (
            canScan() && (
              <>
                <button className="btn primary lan-scan-btn" onClick={scan} disabled={!!busy || scanning}>
                  扫码连接电脑
                </button>
                <button className="btn text lan-photo" onClick={() => file.current?.click()} disabled={!!busy}>
                  从相册选二维码截图
                </button>
              </>
            )
          )}
        </div>
        {!host && (
          <label className="field">
            <span className="label">{canScan() ? '或粘贴扫出来的链接' : '用相机或扫码工具扫电脑上的二维码，把链接粘贴到这里'}</span>
            <div className="inline">
              <input className="lan-paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="glean://lan?v=1&…" autoComplete="off" spellCheck={false} />
              <button type="button" className="btn text lan-paste-go" onClick={() => pairWith(paste)} disabled={!!busy || !/^\s*glean:\/\/lan\?/i.test(paste)}>
                连接
              </button>
            </div>
          </label>
        )}
        <p className="hint meta-text">{host ? 'Windows 防火墙询问时，勾「专用网络」并允许。' : '电脑上：设置 → 局域网直连 → 在这台电脑上开启。'}</p>
        {scanner}
        {status}
      </section>
    );
  }

  const ok = cfg.last?.ok !== false;
  return (
    <section className="set-sec lan-panel" id="set-lan">
      <h2 className="sec-title">局域网直连</h2>
      <div className="sync-state">
        <span className="sync-big num lan-big">{cfg.role === 'host' ? (cfg.hosts[0] ? `${cfg.hosts[0]}:${cfg.port}` : '没连局域网') : when(cfg.lastAt)}</span>
        <span className="meta-text lan-who">{cfg.role === 'host' ? `这台是电脑（${cfg.name}）· 柜子开着 · 端到端加密` : `连的电脑：${cfg.name} · ${cfg.hosts[0]}:${cfg.port}`}</span>
      </div>
      <p className={`meta-text sync-last lan-last${ok ? '' : ' sync-err'}`}>{cfg.last ? `${ok ? `上次（${when(cfg.last.at)}）：` : '上次失败：'}${cfg.last.msg}` : '还没同步过。'}</p>
      {qr && (
        <div className="lan-qr-box">
          <div className="lan-qr" role="img" aria-label="配对二维码" dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <div className="lan-qr-text">
            <p className="meta-text">手机：设置 → 局域网直连 → 扫码连接电脑。</p>
            <p className="meta-text lan-qr-left">
              <span className="num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span> 内有效，用一次作废 · {qr.where}
            </p>
            <button className="btn text lan-qr-hide" onClick={() => setQr(null)}>
              收起二维码
            </button>
          </div>
        </div>
      )}
      <div className="actions">
        {cfg.role === 'host' ? (
          <button className="btn primary lan-show-qr" onClick={showQr} disabled={!!busy}>
            {qr ? '换一个二维码' : '显示配对二维码'}
          </button>
        ) : (
          <button className="btn primary lan-now" onClick={syncNow} disabled={!!busy}>
            立即同步
          </button>
        )}
        {cfg.role === 'host' ? (
          <button className="btn text lan-now" onClick={syncNow} disabled={!!busy}>
            立即同步
          </button>
        ) : (
          <button className="btn text lan-rescan" onClick={() => (canScan() ? void scan() : setPaste(paste ? '' : ' '))} disabled={!!busy || scanning}>
            {canScan() ? '重新扫码' : '重新配对'}
          </button>
        )}
        <button className="btn text faint lan-off" onClick={off} disabled={!!busy}>
          断开
        </button>
      </div>
      {cfg.role === 'peer' && paste !== '' && (
        <label className="field">
          <span className="label">扫出来的配对链接</span>
          <div className="inline">
            <input className="lan-paste" value={paste.trim()} onChange={(e) => setPaste(e.target.value || ' ')} autoComplete="off" spellCheck={false} />
            <button type="button" className="btn text lan-paste-go" onClick={() => pairWith(paste)} disabled={!!busy || !/^\s*glean:\/\/lan\?/i.test(paste)}>
              连接
            </button>
          </div>
        </label>
      )}
      {cfg.role === 'peer' && (
        <label className="check">
          <input className="lan-auto" type="checkbox" checked={cfg.auto} onChange={(e) => void lib().then((m) => m.setLanAuto(e.target.checked))} /> 打开、回到前台时和每 10 分钟找电脑同步
        </label>
      )}
      <p className="hint meta-text">{cfg.role === 'host' ? '手机推来的修改马上合并；这台的修改每分钟放进柜子一次。柜子里只有密文。' : '电脑换了 IP 连不上时，重新扫一次它的二维码。'}</p>
      {scanner}
      {status}
    </section>
  );
}
