import { useEffect, useRef, useState } from 'react';
import { emptyFrames, gridFor, lumToChar, prefersReducedMotion, revealTimes, SPINNER } from '../lib/ascii';

// 每张图每次打开 App 只显影一次，之后直接显示照片，避免滚动时反复动
const played = new Set<string>();
const DURATION = 1100;

/** 图片 ASCII 显影：先是一层字符雾，再从中心向外“显影”成真正的照片。支持 reduced-motion。 */
export function AsciiImage({ src, alt, id, className }: { src: string; alt: string; id?: number; className?: string }) {
  const key = `${id ?? ''}:${src.length}:${src.slice(-24)}`;
  const skip = played.has(key) || prefersReducedMotion();
  const [done, setDone] = useState(skip);
  const wrap = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (done) return;
    const el = wrap.current;
    const im = img.current;
    const cv = cvs.current;
    if (!el || !im || !cv) return;
    let raf = 0;
    let cancelled = false;
    let started = false;

    const finish = () => {
      played.add(key);
      if (!cancelled) setDone(true);
    };

    const start = () => {
      if (started || cancelled) return;
      started = true;
      try {
        const w = Math.max(1, im.clientWidth);
        const h = Math.max(1, im.clientHeight);
        const { cols, rows } = gridFor(im.naturalWidth || w, im.naturalHeight || h, w < 260 ? 36 : 48);
        const small = document.createElement('canvas');
        small.width = cols;
        small.height = rows;
        const sc = small.getContext('2d', { willReadFrequently: true });
        if (!sc) return finish();
        sc.drawImage(im, 0, 0, cols, rows);
        const data = sc.getImageData(0, 0, cols, rows).data;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        const g = cv.getContext('2d');
        if (!g) return finish();
        g.scale(dpr, dpr);
        const cw = w / cols;
        const ch = h / rows;
        g.fillStyle = '#100d0c';
        g.fillRect(0, 0, w, h);
        g.font = `${Math.max(6, ch * 1.05)}px ui-monospace, "JetBrains Mono", Consolas, monospace`;
        g.textBaseline = 'middle';
        g.textAlign = 'center';
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const o = (y * cols + x) * 4;
            const lum = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
            const c = lumToChar(1 - lum); // 亮处字符更密：像暗房里的光
            if (c === ' ') continue;
            g.fillStyle = (x * 7 + y * 13) % 11 === 0 ? '#e0452a' : `rgba(239,230,218,${0.35 + lum * 0.65})`;
            g.fillText(c, x * cw + cw / 2, y * ch + ch / 2);
          }
        }
        el.classList.add('ascii-on');
        const times = revealTimes(cols, rows, (id ?? 1) * 97 + cols);
        const t0 = performance.now();
        let last = -1;
        const step = (now: number) => {
          if (cancelled) return;
          const t = Math.min(1, (now - t0) / DURATION);
          const p = 1 - Math.pow(1 - t, 2.2);
          for (let i = 0; i < times.length; i++) {
            const ti = times[i];
            if (ti > last && ti <= p) {
              const x = i % cols;
              const y = (i / cols) | 0;
              g.clearRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
            }
          }
          last = p;
          if (t < 1) raf = requestAnimationFrame(step);
          else finish();
        };
        raf = requestAnimationFrame(step);
      } catch {
        finish();
      }
    };

    const ready = () => {
      if (!im.complete || !im.naturalWidth) return;
      if (typeof IntersectionObserver === 'undefined') return start();
      const io = new IntersectionObserver(
        (es) => {
          if (es.some((e) => e.isIntersecting)) {
            io.disconnect();
            start();
          }
        },
        { threshold: 0.15 },
      );
      io.observe(el);
      cleanups.push(() => io.disconnect());
    };
    const cleanups: Array<() => void> = [];
    if (im.complete && im.naturalWidth) ready();
    else {
      im.addEventListener('load', ready, { once: true });
      im.addEventListener('error', finish, { once: true });
      cleanups.push(() => im.removeEventListener('load', ready));
    }
    // 兜底：4 秒内没能开始（比如在屏幕外）就保持隐藏等进入视野；图片出错则直接显示
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanups.forEach((f) => f());
    };
  }, [done, key, id]);

  return (
    <div ref={wrap} className={`ascii-wrap${done ? ' ascii-done' : ''}`}>
      <img ref={img} className={className} src={src} alt={alt} loading={done ? 'lazy' : undefined} />
      {!done && <canvas ref={cvs} className="ascii-canvas" aria-hidden />}
    </div>
  );
}

/** 暗房里“冲洗中”的 ASCII 小转圈 */
export function AsciiLoader({ text = '冲洗中' }: { text?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setI((n) => (n + 1) % SPINNER.length), 90);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="loading mono" role="status">
      <span className="spin-ch" aria-hidden>
        {SPINNER[i]}
      </span>{' '}
      {text}…
    </div>
  );
}

/** 空状态：一格底片从噪点里慢慢显出 ◉ */
export function AsciiEmpty() {
  const frames = useRef(emptyFrames()).current;
  const [i, setI] = useState(prefersReducedMotion() ? frames.length - 1 : 0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setI((n) => (n + 1) % (frames.length + 6)), 260);
    return () => clearInterval(t);
  }, [frames]);
  return (
    <pre className="ascii-empty mono" aria-hidden>
      {frames[Math.min(i, frames.length - 1)]}
    </pre>
  );
}

/** 点击“显影”时，按钮上散开一团 ASCII 雾 */
export function FogBurst() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || prefersReducedMotion()) return;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    const chars = '.:-=+*#%@';
    const N = Math.min(70, Math.round(w / 8));
    const ps = Array.from({ length: N }, (_, k) => ({
      x: (k / N) * w + Math.random() * 8,
      y: h * (0.35 + Math.random() * 0.5),
      vx: (Math.random() - 0.5) * 30,
      vy: -(20 + Math.random() * 60),
      c: chars[Math.floor(Math.random() * chars.length)],
      s: 11 + Math.random() * 10,
    }));
    const t0 = performance.now();
    let raf = 0;
    const T = 950;
    const step = (now: number) => {
      const t = (now - t0) / T;
      g.clearRect(0, 0, w, h);
      if (t >= 1) return;
      g.textAlign = 'center';
      for (const p of ps) {
        const dt = t * (T / 1000);
        g.globalAlpha = Math.max(0, 0.85 * (1 - t));
        g.fillStyle = '#efe6da';
        g.font = `${p.s}px ui-monospace, Consolas, monospace`;
        g.fillText(p.c, p.x + p.vx * dt, p.y + p.vy * dt);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="fog-burst" aria-hidden />;
}
