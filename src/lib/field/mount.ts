// 浏览器接线：网格尺寸、DPR、输入（指针/触摸/点击空地/滚动）、暂停与静止帧。
import type { Phase } from '../phases';
import { createLoop, FULL_RATES, LITE_RATES, type FieldLoop } from './loop';
import { createPainter, FIELD_FONT, FIELD_WEIGHT, type Painter } from './paint';
import { createField, fieldPalette, noInput, renderField, setFieldPhase, settleField, stepField, type FieldInput, type FieldState } from './wheat';

export interface MountOptions {
  phase: Phase;
  still: boolean; // 减少动态效果 / 用户关闭：一帧静止画面，无循环无监听
  lite: boolean; // 低端机：更粗的格子、更低帧率、DPR 1
}

export interface FieldHandle {
  setPhase: (p: Phase) => void;
  destroy: () => void;
}

export interface FieldStats {
  cols: number;
  rows: number;
  frames: number;
  painted: number;
  still: boolean;
  interval: number | null;
}

declare global {
  interface Window {
    __gleanField?: FieldStats;
  }
}

/** 点到这些东西上不算「空地」 */
const SOLID = 'button, a, input, textarea, select, label, summary, .paper, .card, .sheet, .nav, .quick, .chip, .toast, .clip-offer, [role="dialog"]';

export function mountField(canvas: HTMLCanvasElement, opts: MountOptions): FieldHandle {
  let phase = opts.phase;
  let state: FieldState | null = null;
  let painter: Painter | null = null;
  let loop: FieldLoop | null = null;
  let cellW = 8;
  let cellH = 13;
  let input: FieldInput = noInput();
  let last: { x: number; y: number; t: number } | null = null;
  let lastScroll = { y: window.scrollY, t: performance.now() };
  let scrollBreeze = 0;
  let dead = false;
  const stats: FieldStats = { cols: 0, rows: 0, frames: 0, painted: 0, still: opts.still, interval: null };
  window.__gleanField = stats;

  const build = () => {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const cssH = opts.lite ? 16 : vw < 700 ? 13 : 15;
    const cssW = Math.round(cssH * 0.6 * 10) / 10;
    const dpr = opts.lite ? 1 : Math.min(vw > 1200 ? 1.5 : 2, window.devicePixelRatio || 1);
    cellW = cssW;
    cellH = cssH;
    const cols = Math.ceil(vw / cssW);
    const rows = Math.ceil(vh / cssH);
    const dW = Math.max(1, Math.round(cssW * dpr));
    const dH = Math.max(1, Math.round(cssH * dpr));
    canvas.width = cols * dW;
    canvas.height = rows * dH;
    canvas.style.width = `${(cols * dW) / dpr}px`;
    canvas.style.height = `${(rows * dH) / dpr}px`;
    const prevT = state?.t ?? 3.2;
    state = createField({ cols, rows, phase, t: prevT });
    painter = createPainter(canvas, { cols, rows, cellW: dW, cellH: dH, colors: fieldPalette(phase) });
    stats.cols = cols;
    stats.rows = rows;
    renderField(state);
    stats.painted = painter.paint(state.chars, state.colors);
    stats.frames++;
  };

  const repaintAll = () => {
    if (!state || !canvas.width) return;
    painter = createPainter(canvas, { cols: state.cols, rows: state.rows, cellW: canvas.width / state.cols, cellH: canvas.height / state.rows, colors: fieldPalette(phase) });
    renderField(state);
    stats.painted = painter.paint(state.chars, state.colors);
  };

  build();
  // 字体到了再画一次（图集换成 Glean Mono）
  document.fonts?.load(`${FIELD_WEIGHT} 13px ${FIELD_FONT}`).then(() => !dead && repaintAll(), () => {});

  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(() => {
      build();
      loop?.wake();
    }, 160);
  };
  window.addEventListener('resize', onResize);

  if (opts.still) {
    return {
      setPhase(p) {
        phase = p;
        if (state) {
          setFieldPhase(state, p);
          settleField(state, 3.2);
        }
        repaintAll();
      },
      destroy() {
        dead = true;
        window.removeEventListener('resize', onResize);
      },
    };
  }

  const toCell = (cx: number, cy: number) => ({ x: cx / cellW, y: cy / cellH });
  const sample = (cx: number, cy: number) => {
    const now = performance.now();
    const p = toCell(cx, cy);
    if (last && now - last.t < 200) {
      const dt = Math.max(8, now - last.t) / 1000;
      input.pointer = { x: p.x, y: p.y, vx: (p.x - last.x) / dt, vy: (p.y - last.y) / dt };
    } else input.pointer = { x: p.x, y: p.y, vx: 0, vy: 0 };
    last = { x: p.x, y: p.y, t: now };
    loop?.wake();
  };
  const onMove = (e: PointerEvent) => sample(e.clientX, e.clientY);
  const onTouch = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) sample(t.clientX, t.clientY);
  };
  const onDown = (e: PointerEvent) => {
    const el = e.target as Element | null;
    if (el && el.closest && el.closest(SOLID)) return;
    const p = toCell(e.clientX, e.clientY);
    if (state && p.y >= state.layout.horizon - 3) {
      input.bursts.push(p);
      loop?.wake();
    }
  };
  const onScroll = () => {
    const now = performance.now();
    const dy = window.scrollY - lastScroll.y;
    const dt = Math.max(16, now - lastScroll.t);
    lastScroll = { y: window.scrollY, t: now };
    scrollBreeze = Math.max(-1, Math.min(1, (dy / dt) * 0.6));
    loop?.wake();
  };

  loop = createLoop({
    rates: opts.lite ? LITE_RATES : FULL_RATES,
    now: () => performance.now(),
    schedule: (cb, ms) => window.setTimeout(() => requestAnimationFrame(cb), ms),
    cancel: (id) => clearTimeout(id),
    tick: (dt) => {
      if (!state || !painter) return false;
      input.breeze = scrollBreeze;
      scrollBreeze *= 0.85;
      stepField(state, dt, input);
      input = noInput();
      renderField(state);
      stats.painted = painter.paint(state.chars, state.colors);
      stats.frames++;
      stats.interval = loop?.interval() ?? null;
      return state.active;
    },
  });

  const onVis = () => (document.visibilityState === 'hidden' ? loop?.pause() : loop?.play());
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('touchmove', onTouch, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVis);
  if (document.visibilityState !== 'hidden') loop.play();

  return {
    setPhase(p) {
      phase = p;
      if (state) setFieldPhase(state, p);
      repaintAll();
      loop?.wake();
    },
    destroy() {
      dead = true;
      loop?.pause();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
