// 浏览器端：把麦田的字符/颜色网格画到 canvas 上，只重画和上一帧不同的格子。
// 每个（字符, 颜色）只在图集里画一次，之后 drawImage 盖章，比几千次 fillText 便宜得多。
import { GLYPHS } from './wheat';

export const FIELD_FONT = '"Glean Mono", "JetBrains Mono", ui-monospace, Consolas, monospace';
export const FIELD_WEIGHT = 800;

export interface PainterOptions {
  cols: number;
  rows: number;
  cellW: number; // 设备像素，整数
  cellH: number;
  colors: string[];
}

export interface Painter {
  paint: (chars: Uint8Array, colors: Uint8Array) => number;
  invalidate: () => void;
}

export function createPainter(canvas: HTMLCanvasElement, o: PainterOptions): Painter {
  const ctx = canvas.getContext('2d');
  const n = o.cols * o.rows;
  const prevC = new Uint8Array(n);
  const prevK = new Uint8Array(n);
  let fresh = true;
  const nColor = o.colors.length;
  const perRow = 64;
  const slots = GLYPHS.length * nColor;
  const atlas = document.createElement('canvas');
  atlas.width = perRow * o.cellW;
  atlas.height = Math.ceil(slots / perRow) * o.cellH;
  const actx = atlas.getContext('2d');
  const ready = new Uint8Array(slots);
  if (actx) {
    actx.font = `${FIELD_WEIGHT} ${Math.round(o.cellH * 0.86)}px ${FIELD_FONT}`;
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
  }
  const sprite = (g: number, c: number) => {
    const slot = g * nColor + c;
    if (!ready[slot] && actx) {
      ready[slot] = 1;
      const sx = (slot % perRow) * o.cellW;
      const sy = Math.floor(slot / perRow) * o.cellH;
      actx.save();
      actx.beginPath();
      actx.rect(sx, sy, o.cellW, o.cellH);
      actx.clip();
      actx.fillStyle = o.colors[c] ?? '#000';
      actx.fillText(GLYPHS.charAt(g), sx + o.cellW / 2, sy + o.cellH / 2);
      actx.restore();
    }
    return slot;
  };
  return {
    paint(chars, colors) {
      if (!ctx) return 0;
      let touched = 0;
      if (fresh) ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < n; i++) {
        const c = chars[i];
        const k = colors[i];
        if (!fresh && c === prevC[i] && k === prevK[i]) continue;
        const had = prevC[i];
        prevC[i] = c;
        prevK[i] = k;
        if (fresh && !c) continue;
        touched++;
        const dx = (i % o.cols) * o.cellW;
        const dy = Math.floor(i / o.cols) * o.cellH;
        if (!fresh && had) ctx.clearRect(dx, dy, o.cellW, o.cellH);
        if (!c) continue;
        const slot = sprite(c, k);
        ctx.drawImage(atlas, (slot % perRow) * o.cellW, Math.floor(slot / perRow) * o.cellH, o.cellW, o.cellH, dx, dy, o.cellW, o.cellH);
      }
      fresh = false;
      return touched;
    },
    invalidate() {
      fresh = true;
    },
  };
}
