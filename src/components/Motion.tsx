import { useEffect, useState, type ReactNode } from 'react';
import { decodeFrame, detectMotionLevel, revealCount, typeDuration, type MotionLevel } from '../lib/motion';

let cached: MotionLevel | null = null;
export function level(): MotionLevel {
  if (!cached) cached = detectMotionLevel();
  return cached;
}

/** 标题文字解码（乱码 → 原文）。off 档直接显示原文；DOM 里始终有完整文字给读屏用 */
export function DecodeText({ text, ms = 700 }: { text: string; ms?: number }) {
  const [shown, setShown] = useState(() => (level() === 'off' ? text : decodeFrame(text, 0, 7)));
  useEffect(() => {
    if (level() === 'off') {
      setShown(text);
      return;
    }
    const total = level() === 'lite' ? ms * 0.6 : ms;
    const seedBase = text.length * 31 + 7;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = (now - t0) / total;
      if (p >= 1) {
        setShown(text);
        return;
      }
      if (now - last > 70) {
        last = now;
        setShown(decodeFrame(text, p, seedBase + Math.floor(now / 70)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms]);
  return (
    <span className="decode" aria-label={text}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}

/** 逐字浮现：全文始终在 DOM（版面不跳），未浮现部分透明 */
export function TypeReveal({ text, className, done: doneContent }: { text: string; className?: string; /** 浮现完之后换成这份内容（如带高亮的正文） */ done?: ReactNode }) {
  const [n, setN] = useState(() => (level() === 'off' ? text.length : 0));
  useEffect(() => {
    if (level() === 'off') {
      setN(text.length);
      return;
    }
    const total = typeDuration(text.length) * (level() === 'lite' ? 0.8 : 1.4);
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = (now - t0) / total;
      if (p >= 1) {
        setN(text.length);
        return;
      }
      if (now - last > 40) {
        last = now;
        setN(revealCount(text.length, p));
      }
      raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  const chars = Array.from(text);
  const done = n >= chars.length;
  return (
    <p className={className}>
      {done ? (
        (doneContent ?? text)
      ) : (
        <>
          {chars.slice(0, n).join('')}
          <span className="tw-rest">{chars.slice(n).join('')}</span>
        </>
      )}
    </p>
  );
}

/** 全局按钮效果（只挂一次）：按下时一圈很淡的水波（full/lite）。拾穗版不做磁吸。 */
export function useButtonFx() {
  useEffect(() => {
    if (level() === 'off') return;
    const down = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.btn, .nav-add') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2;
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      el.appendChild(s);
      setTimeout(() => s.remove(), 900);
    };
    document.addEventListener('pointerdown', down, { passive: true });
    return () => document.removeEventListener('pointerdown', down);
  }, []);
}
