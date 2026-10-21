import { useEffect, useState } from 'react';
import { decodeFrame, detectMotionLevel, magnetOffset, revealCount, typeDuration, type MotionLevel } from '../lib/motion';

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
      if (now - last > 45) {
        last = now;
        setShown(decodeFrame(text, p, seedBase + Math.floor(now / 45)));
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
export function TypeReveal({ text, className }: { text: string; className?: string }) {
  const [n, setN] = useState(() => (level() === 'off' ? text.length : 0));
  useEffect(() => {
    if (level() === 'off') {
      setN(text.length);
      return;
    }
    const total = typeDuration(text.length) * (level() === 'lite' ? 0.6 : 1);
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
        text
      ) : (
        <>
          {chars.slice(0, n).join('')}
          <span className="tw-rest">{chars.slice(n).join('')}</span>
        </>
      )}
    </p>
  );
}

/** 全局按钮效果（只挂一次）：点击涟漪（full/lite）+ 鼠标靠近主按钮磁吸（仅 full 且有精确指针） */
export function useButtonFx() {
  useEffect(() => {
    const lv = level();
    if (lv === 'off') return;
    const down = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.btn, .nav-add, .fab') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2;
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      el.appendChild(s);
      setTimeout(() => s.remove(), 650);
    };
    document.addEventListener('pointerdown', down, { passive: true });
    let magnet: HTMLElement | null = null;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = (e.target as HTMLElement | null)?.closest?.('.btn.primary, .btn.big, .nav-add') as HTMLElement | null;
        if (magnet && magnet !== el) {
          magnet.style.removeProperty('--mx');
          magnet.style.removeProperty('--my');
          magnet = null;
        }
        if (!el) return;
        magnet = el;
        const r = el.getBoundingClientRect();
        const o = magnetOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), Math.max(r.width, r.height), 5);
        el.style.setProperty('--mx', o.x + 'px');
        el.style.setProperty('--my', o.y + 'px');
      });
    };
    if (lv === 'full' && window.matchMedia?.('(pointer: fine)').matches) document.addEventListener('pointermove', move, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      cancelAnimationFrame(raf);
    };
  }, []);
}
