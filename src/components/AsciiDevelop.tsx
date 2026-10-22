import { useEffect, useRef, useState } from 'react';
import { gridFor, inkOnPaper, lumToChar, prefersReducedMotion, revealTimes, SPINNER, sproutFrames } from '../lib/ascii';

// 每张图每次打开 App 只显影一次，之后直接显示照片，避免滚动时反复动
const played = new Set<string>();
const DURATION = 1500;
// v0.13：同时最多两张在显影，快速滚动时其余直接显示照片，避免一屏十几个 rAF 同时跑
const MAX_ACTIVE = 2;
let active = 0;
const MONO = '"Glean Mono", "JetBrains Mono", ui-monospace, Consolas, monospace';

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 图片 ASCII 显影：先是纸上一层用图片自身颜色写成的字符，再从中心向外慢慢显成照片。支持减少动态效果。 */
export function AsciiImage({ src, alt, id, className, playKey, ratio }: { src: string; alt: string; id?: number; className?: string; playKey?: string; ratio?: number }) {
  const key = playKey ?? `${id ?? ''}:${src.length}:${src.slice(-24)}`;
  const skip = played.has(key) || prefersReducedMotion();
  const [done, setDone] = useState(skip);
  const [fresh, setFresh] = useState(false);
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
    let counted = false;

    const finish = (developed = false) => {
      if (counted) {
        counted = false;
        active--;
      }
      played.add(key);
      if (cancelled) return;
      if (developed) setFresh(true);
      setDone(true);
    };

    const start = () => {
      if (started || cancelled) return;
      started = true;
      if (active >= MAX_ACTIVE) return finish();
      active++;
      counted = true;
      try {
        const w = Math.max(1, im.clientWidth);
        const h = Math.max(1, im.clientHeight);
        const { cols, rows } = gridFor(im.naturalWidth || w, im.naturalHeight || h, w < 260 ? 38 : 52);
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
        const dark = document.documentElement.dataset.sky === 'dark';
        g.fillStyle = cssVar('--panel-solid', dark ? '#191f2e' : '#fcf9f2');
        g.fillRect(0, 0, w, h);
        g.font = `700 ${Math.max(6, ch * 1.02)}px ${MONO}`;
        g.textBaseline = 'middle';
        g.textAlign = 'center';
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const o = (y * cols + x) * 4;
            const r = data[o];
            const gg = data[o + 1];
            const b = data[o + 2];
            const lum = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
            // 浅纸：暗处字符密；夜晚深纸：亮处字符密
            const c = lumToChar(dark ? 1 - lum : lum * 0.94);
            if (c === ' ') continue;
            g.fillStyle = inkOnPaper(r, gg, b, dark);
            g.fillText(c, x * cw + cw / 2, y * ch + ch / 2);
          }
        }
        el.classList.add('ascii-on');
        const times = revealTimes(cols, rows, (id ?? 1) * 97 + cols);
        const t0 = performance.now();
        let last = -1;
        let lastPaint = 0;
        const step = (now: number) => {
          if (cancelled) return;
          const t = Math.min(1, (now - t0) / DURATION);
          if (now - lastPaint >= 33 || t >= 1) {
            lastPaint = now;
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
          }
          if (t < 1) raf = requestAnimationFrame(step);
          else finish(true);
        };
        raf = requestAnimationFrame(step);
      } catch {
        finish();
      }
    };

    const cleanups: Array<() => void> = [];
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
    if (im.complete && im.naturalWidth) ready();
    else {
      im.addEventListener('load', ready, { once: true });
      im.addEventListener('error', () => finish(), { once: true });
      cleanups.push(() => im.removeEventListener('load', ready));
    }
    return () => {
      cancelled = true;
      if (counted) {
        counted = false;
        active--;
      }
      cancelAnimationFrame(raf);
      cleanups.forEach((f) => f());
    };
  }, [done, key, id]);

  return (
    <div ref={wrap} className={`ascii-wrap${done ? ' ascii-done' : ''}${fresh ? ' ascii-fresh' : ''}`}>
      <img ref={img} className={className} src={src} alt={alt} decoding="async" loading={done ? 'lazy' : undefined} style={ratio ? { aspectRatio: String(ratio) } : undefined} />
      {!done && <canvas ref={cvs} className="ascii-canvas" aria-hidden />}
    </div>
  );
}

/** 等待：一排种子轻轻起伏 */
export function AsciiLoader({ text = '去田里拾' }: { text?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setI((n) => (n + 1) % SPINNER.length), 220);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="loading" role="status">
      <span className="spin-ch" aria-hidden>
        {SPINNER[i]}
      </span>{' '}
      {text}…
    </div>
  );
}

/** 空状态：一根麦子慢慢长出来，停在完整的穗上 */
export function AsciiEmpty() {
  const frames = useRef(sproutFrames()).current;
  const [i, setI] = useState(prefersReducedMotion() ? frames.length - 1 : 0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setI((n) => (n >= frames.length - 1 ? n : n + 1)), 280);
    return () => clearInterval(t);
  }, [frames]);
  return (
    <pre className="ascii-empty" aria-hidden>
      {frames[Math.min(i, frames.length - 1)]}
    </pre>
  );
}

/** 点「嫁接」时，几粒种子从按钮上轻轻飞起 */
export function SeedBurst() {
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
    const color = cssVar('--accent', '#3f8a2f');
    const gold = cssVar('--gold-3', '#b88c2c');
    const chars = "·'`,.";
    const N = Math.min(26, Math.round(w / 14));
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ps = Array.from({ length: N }, (_, k) => ({
      x: w / 2 + (r() - 0.5) * Math.min(220, w * 0.5),
      y: h * 0.62,
      vx: (r() - 0.5) * 50,
      vy: -(30 + r() * 45),
      c: chars[k % chars.length],
      s: 13 + r() * 6,
      col: k % 3 === 0 ? color : gold,
    }));
    const t0 = performance.now();
    let raf = 0;
    const T = 1400;
    const step = (now: number) => {
      const t = (now - t0) / T;
      g.clearRect(0, 0, w, h);
      if (t >= 1) return;
      g.textAlign = 'center';
      for (const p of ps) {
        const dt = t * (T / 1000);
        g.globalAlpha = Math.max(0, 0.9 * (1 - t));
        g.fillStyle = p.col;
        g.font = `700 ${p.s}px ${MONO}`;
        g.fillText(p.c, p.x + p.vx * dt, p.y + p.vy * dt + 18 * dt * dt);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="seed-burst" aria-hidden />;
}
