// v0.13 虚拟滚动：只挂载视口上下各约一屏内的卡片。页面本身滚动（window），不改样式结构。v0.16 网格图块固定 4:5，估算即准。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { columnCount, layoutList, layoutMasonry, listRange, visibleIndexes } from '../lib/virtual';

declare global {
  interface Window {
    __gleanVirtual?: { masonry?: { total: number; mounted: number; cols: number }; timeline?: { total: number; mounted: number } };
  }
}
const vstat: NonNullable<Window['__gleanVirtual']> = {};
if (typeof window !== 'undefined') window.__gleanVirtual = vstat;

/** 容器相对于视口的可见窗口（含 overscan），滚动 / 尺寸变化时按帧更新 */
function useViewportWindow(ref: React.RefObject<HTMLElement | null>, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      cb.current();
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(on) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}

function windowOf(el: HTMLElement | null, overscan: number): [number, number] {
  const vh = window.innerHeight || 800;
  if (!el) return [0, vh + overscan];
  const top = el.getBoundingClientRect().top;
  return [-top - overscan, -top + vh + overscan];
}

/** 量高度：ResizeObserver 盯着挂载的格子，高度变了按帧合并一次重排 */
function useMeasure(onBatch: (changes: Array<[string, number, number]>) => void) {
  // 量到的高度连同当时的宽度一起记：宽度不同（如首帧还没定位、整宽排着）的高度不能拿来用
  const pending = useRef(new Map<string, [number, number]>());
  const raf = useRef(0);
  const ob = useRef<ResizeObserver | null>(null);
  const batch = useRef(onBatch);
  batch.current = onBatch;
  const flush = useCallback(() => {
    raf.current = 0;
    const ch = [...pending.current.entries()].map(([k, [h, w]]) => [k, h, w] as [string, number, number]);
    pending.current.clear();
    if (ch.length) batch.current(ch);
  }, []);
  // ResizeObserver 要在 ref 回调里就可用（ref 回调早于 useEffect），所以懒创建
  const getOb = useCallback(() => {
    if (!ob.current && typeof ResizeObserver !== 'undefined') {
      ob.current = new ResizeObserver((es) => {
        for (const e of es) {
          const el = e.target as HTMLElement;
          const k = el.dataset.vkey;
          if (k && el.isConnected) pending.current.set(k, [el.offsetHeight, el.getBoundingClientRect().width]);
        }
        if (!raf.current) raf.current = requestAnimationFrame(flush);
      });
    }
    return ob.current;
  }, [flush]);
  useEffect(
    () => () => {
      ob.current?.disconnect();
      ob.current = null;
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );
  // React 19 ref 回调可返回清理函数：卸载时取消观察，不留着已经滚出去的节点
  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const k = el.dataset.vkey;
    if (k && el.offsetHeight) pending.current.set(k, [el.offsetHeight, el.getBoundingClientRect().width]);
    if (!raf.current && pending.current.size) raf.current = requestAnimationFrame(flush);
    const o = getOb();
    o?.observe(el);
    return () => o?.unobserve(el);
  }, [flush, getOb]);
}

/** 读当前断点下的列参数（v0.20 Rewamp：手机 2 列、间距 10px；桌面 ≥1024px 主区按宽度 3–4 列、间距 14px；图块 4:5 圆角） */
function gridParams(_el: HTMLElement | null) {
  const desktop = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches;
  return desktop ? { maxCols: 4, minCol: 210, gapX: 14, gapY: 14 } : { maxCols: 2, minCol: 120, gapX: 10, gapY: 10 };
}

/** 瀑布 / 双列虚拟滚动 */
export function VirtualMasonry<T>({
  items,
  keyOf,
  estimate,
  render,
  cellStyle,
  overscan = 700,
  threshold = 60,
}: {
  items: T[];
  keyOf: (it: T) => string | number;
  estimate: (it: T, colWidth: number) => number;
  render: (it: T, index: number) => ReactNode;
  cellStyle?: (index: number) => CSSProperties | undefined;
  overscan?: number;
  /** 不超过这么多张时全部挂载（少量卡片没必要虚拟化，搜索 / 定位也更直观） */
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // key → 量到的高度和当时的格宽；格宽对不上（换断点、首帧整宽）就不用，退回估算
  const heights = useRef(new Map<string, { h: number; w: number }>());
  const [width, setWidth] = useState(0);
  const [ver, setVer] = useState(0);
  const [win, setWin] = useState<[number, number]>(() => [0, (typeof window !== 'undefined' ? window.innerHeight : 800) + overscan]);

  const p = gridParams(ref.current);
  const cols = columnCount(width, p.maxCols, p.minCol, p.gapX);
  const colWidth = cols > 0 && width > 0 ? (width - p.gapX * (cols - 1)) / cols : 0;
  const hs = items.map((it) => {
    const m = heights.current.get(String(keyOf(it)));
    return m && Math.abs(m.w - colWidth) < 1.5 ? m.h : estimate(it, colWidth || 180);
  });
  void ver;
  const { cells, height } = layoutMasonry(hs, cols, colWidth, p.gapX, p.gapY);
  const vis = items.length <= threshold ? items.map((_, i) => i) : width ? visibleIndexes(cells, win[0], win[1]) : items.slice(0, 12).map((_, i) => i);
  vstat.masonry = { total: items.length, mounted: vis.length, cols };

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    setWidth((x) => (Math.abs(x - w) > 0.5 ? w : x));
    const [a, b] = windowOf(el, overscan);
    // 量化到 40px，滚动时少重渲染
    const qa = Math.floor(a / 40) * 40;
    const qb = Math.ceil(b / 40) * 40;
    setWin((x) => (x[0] === qa && x[1] === qb ? x : [qa, qb]));
  }, [overscan]);
  useLayoutEffect(sync, [sync]);
  useViewportWindow(ref, sync);

  const measure = useMeasure((changes) => {
    let dirty = false;
    for (const [k, h, w] of changes) {
      const old = heights.current.get(k);
      if (!old || Math.abs(old.h - h) > 0.5 || Math.abs(old.w - w) > 0.5) {
        heights.current.set(k, { h, w });
        dirty = true;
      }
    }
    if (dirty) setVer((v) => v + 1);
  });

  return (
    <div ref={ref} className="masonry virtual" style={{ position: 'relative', height: width ? height : undefined }}>
      {vis.map((i) => {
        const it = items[i];
        const c = cells[i];
        const k = String(keyOf(it));
        return (
          <div
            key={k}
            ref={measure}
            data-vkey={k}
            className="masonry-cell"
            style={width ? { position: 'absolute', top: c.top, left: c.left, width: colWidth, margin: 0, ...cellStyle?.(i) } : cellStyle?.(i)}
          >
            {render(it, i)}
          </div>
        );
      })}
    </div>
  );
}

/** 竖排列表虚拟滚动（时间线：一天一行） */
export function VirtualList<T>({
  items,
  keyOf,
  estimate,
  render,
  className,
  rowClassName,
  gap,
  overscan = 800,
  threshold = 30,
}: {
  items: T[];
  keyOf: (it: T) => string | number;
  estimate: (it: T) => number;
  render: (it: T, index: number) => ReactNode;
  className?: string;
  rowClassName?: string;
  gap: number;
  overscan?: number;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [ver, setVer] = useState(0);
  const [win, setWin] = useState<[number, number]>(() => [0, (typeof window !== 'undefined' ? window.innerHeight : 800) + overscan]);
  void ver;
  const hs = items.map((it) => heights.current.get(String(keyOf(it))) ?? estimate(it));
  const { tops, height } = layoutList(hs, gap);
  const [start, end] = items.length <= threshold ? [0, items.length] : listRange(tops, hs, win[0], win[1]);
  vstat.timeline = { total: items.length, mounted: end - start };

  const sync = useCallback(() => {
    const [a, b] = windowOf(ref.current, overscan);
    const qa = Math.floor(a / 40) * 40;
    const qb = Math.ceil(b / 40) * 40;
    setWin((x) => (x[0] === qa && x[1] === qb ? x : [qa, qb]));
  }, [overscan]);
  useLayoutEffect(sync, [sync]);
  useViewportWindow(ref, sync);
  const measure = useMeasure((changes) => {
    let dirty = false;
    for (const [k, h] of changes) {
      const old = heights.current.get(k);
      if (old == null || Math.abs(old - h) > 1) {
        heights.current.set(k, h);
        dirty = true;
      }
    }
    if (dirty) setVer((v) => v + 1);
  });

  const padTop = items.length ? tops[start] : 0;
  const lastBottom = end > 0 ? tops[end - 1] + hs[end - 1] : 0;
  const padBottom = Math.max(0, height - lastBottom);
  return (
    <div ref={ref} className={className} style={{ paddingTop: padTop, paddingBottom: padBottom }}>
      {items.slice(start, end).map((it, j) => {
        const k = String(keyOf(it));
        return (
          <div key={k} ref={measure} data-vkey={k} className={rowClassName}>
            {render(it, start + j)}
          </div>
        );
      })}
    </div>
  );
}
