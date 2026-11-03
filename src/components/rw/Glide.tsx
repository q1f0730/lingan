import { useLayoutEffect, useRef } from 'react';

// v0.34：代替 Framer Motion 的 layoutId（domMax 特性包约 46KB）——导航气泡 / 分段药丸从上一个选中项滑到新的选中项。
// 记住同一 id 上一次相对轨道（按钮的父元素）的位置，新的一块挂上时从旧位置做一次 FLIP（WAAPI，弹簧感的缓动）。
// 减少动态效果（data-motion="off" 或系统设置）时直接到位。
const last = new Map<string, [number, number, number, number]>();

function rel(el: HTMLElement): [number, number, number, number] {
  const r = el.getBoundingClientRect();
  const c = el.parentElement?.parentElement?.getBoundingClientRect() || { left: 0, top: 0 };
  return [r.left - c.left, r.top - c.top, r.width, r.height];
}

export function Glide({ id, className }: { id: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const now = rel(el);
    const p = last.get(id);
    last.set(id, now);
    const still = document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!p || still || !now[2] || !now[3] || typeof el.animate !== 'function') return;
    const [dx, dy, sx, sy] = [p[0] - now[0], p[1] - now[1], p[2] / now[2], p[3] / now[3]];
    if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(sx - 1) + Math.abs(sy - 1) < 0.01) return;
    el.animate([{ transformOrigin: '0 0', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.22,1.12,.36,1)' });
    return () => {
      if (el.isConnected) last.set(id, rel(el));
    };
  });
  return <span ref={ref} className={className} aria-hidden />;
}
