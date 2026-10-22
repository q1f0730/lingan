// 活的 ASCII 麦田：纯函数、确定性的模拟（不碰 DOM、不用 Math.random / Date.now）。
// 思路来自阿卡迪亚 meadow（每格一根弹簧 + 风 + 指针推力 + 阵风 + 飘絮），拾穗版重写成麦田：
// 远处一片麦浪（亮带随风滚过）、近处成排麦秆与麦穗、地平线上一棵树、偶尔飘起麦芒和种子，夜里是萤火。
import type { Phase } from '../phases';
import { PHASES } from '../phases';

/** 麦田用到的全部字符；格子里存下标（0 = 空） */
export const GLYPHS = " .,'`\"|/\\()_-~^:;*+o•·%@#=vVwYyl!i";
export const gi = (ch: string): number => GLYPHS.indexOf(ch);

export const SPRING_K = 24;
export const SPRING_C = 4.2;
export const MAX_BEND = 1.8;
export const SETTLED = 0.1;
const MOTES = 48;

export interface FieldLayout {
  horizon: number; // 地平线所在行（以上是天）
  wheatTop: number; // 近处密麦从这一行开始
}

export function fieldLayout(rows: number): FieldLayout {
  return { horizon: Math.round(rows * 0.5), wheatTop: Math.round(rows * 0.66) };
}

export interface Pointer {
  x: number; // 格
  y: number;
  vx: number; // 格/秒
  vy: number;
}

export interface FieldInput {
  pointer: Pointer | null;
  bursts: Array<{ x: number; y: number }>;
  breeze: number; // -1..1，滚动带来的风
}

export const noInput = (): FieldInput => ({ pointer: null, bursts: [], breeze: 0 });

interface Gust {
  x: number;
  dir: 1 | -1;
  strength: number;
  age: number;
}

export interface FieldState {
  cols: number;
  rows: number;
  seed: number;
  phase: Phase;
  layout: FieldLayout;
  t: number;
  breeze: number;
  bend: Float32Array;
  vel: Float32Array;
  target: Float32Array;
  force: Float32Array;
  colWind: Float32Array;
  stalkTop: Int16Array; // 每列麦秆顶（-1 = 这列没有麦子）
  layer: Uint8Array; // 每列在第几排：0 后 1 中 2 前
  gusts: Gust[];
  pointer: Pointer | null;
  pointerAge: number;
  lastGustT: number;
  // 飘絮池
  mx: Float32Array;
  my: Float32Array;
  mvx: Float32Array;
  mvy: Float32Array;
  mlife: Float32Array;
  mkind: Uint8Array; // 0 空 1 种子 2 麦芒 3 萤火
  nextAmbient: number;
  rngState: number;
  deviation: number;
  active: boolean;
  chars: Uint8Array;
  colors: Uint8Array;
}

// —— 确定性随机与噪声 ——
export function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function smooth(t: number) {
  return t * t * (3 - 2 * t);
}
export function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function rnd(s: FieldState): number {
  s.rngState = (s.rngState + 0x6d2b79f5) >>> 0;
  let t = s.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// —— 调色板：下标 → 颜色 ——
export const C = {
  none: 0,
  sky: 1,
  far0: 2,
  far1: 3,
  far2: 4,
  stalk0: 5, // .. stalk5 = 10
  ear0: 11,
  ear1: 12,
  ear2: 13,
  tree0: 14,
  tree1: 15,
  tree2: 16,
  mote0: 17,
  mote1: 18,
  flower: 19,
} as const;

export function fieldPalette(phase: Phase): string[] {
  const k = PHASES[phase].ink;
  return ['transparent', k.sky, ...k.far, ...k.stalk, ...k.ear, ...k.tree, ...k.mote, k.flower];
}

export interface FieldOptions {
  cols: number;
  rows: number;
  phase: Phase;
  seed?: number;
  t?: number;
}

export function createField(o: FieldOptions): FieldState {
  const n = o.cols * o.rows;
  const seed = o.seed ?? 11;
  const layout = fieldLayout(o.rows);
  const stalkTop = new Int16Array(o.cols);
  const layer = new Uint8Array(o.cols);
  const band = o.rows - layout.wheatTop;
  for (let x = 0; x < o.cols; x++) {
    const h = hash(x, 1, seed);
    // 三排：后排矮小、中排、前排高大；少数列空着露出地面
    const L = h < 0.08 ? 3 : h < 0.42 ? 0 : h < 0.74 ? 1 : 2;
    layer[x] = L;
    const base = L === 0 ? 0 : L === 1 ? Math.round(band * 0.16) : Math.round(band * 0.3);
    stalkTop[x] = L === 3 ? -1 : layout.wheatTop + base + Math.floor(hash(x, 2, seed) * 3);
  }
  const s: FieldState = {
    cols: o.cols,
    rows: o.rows,
    seed,
    phase: o.phase,
    layout,
    t: 0,
    breeze: 0,
    bend: new Float32Array(n),
    vel: new Float32Array(n),
    target: new Float32Array(n),
    force: new Float32Array(n),
    colWind: new Float32Array(o.cols),
    stalkTop,
    layer,
    gusts: [],
    pointer: null,
    pointerAge: Infinity,
    lastGustT: -Infinity,
    mx: new Float32Array(MOTES),
    my: new Float32Array(MOTES),
    mvx: new Float32Array(MOTES),
    mvy: new Float32Array(MOTES),
    mlife: new Float32Array(MOTES),
    mkind: new Uint8Array(MOTES),
    nextAmbient: 1.5,
    rngState: seed * 7919,
    deviation: 0,
    active: false,
    chars: new Uint8Array(n),
    colors: new Uint8Array(n),
  };
  settleField(s, o.t ?? 0);
  if (o.phase === 'night') for (let i = 0; i < 9; i++) spawnFirefly(s);
  return s;
}

/** 跳到时刻 t，所有麦子停在风吹着的位置（静止帧 / 首帧用） */
export function settleField(s: FieldState, t: number) {
  s.t = t;
  computeTargets(s);
  s.bend.set(s.target);
  s.vel.fill(0);
  s.deviation = 0;
  s.active = false;
}

/** 换时段：只换颜色和萤火，不重置麦子 */
export function setFieldPhase(s: FieldState, phase: Phase) {
  if (s.phase === phase) return;
  s.phase = phase;
  for (let i = 0; i < MOTES; i++) if (s.mkind[i] === 3) s.mkind[i] = 0;
  if (phase === 'night') for (let i = 0; i < 9; i++) spawnFirefly(s);
}

function computeTargets(s: FieldState) {
  const { cols, rows, layout, t, seed } = s;
  for (let x = 0; x < cols; x++)
    s.colWind[x] = 0.42 * (0.62 * Math.sin(0.12 * x - 0.85 * t) + 0.38 * (noise2(x * 0.04 - t * 0.16, 2.3, seed + 5) * 2 - 1)) + 0.12;
  const lean = s.breeze * 0.45;
  const span = Math.max(1, rows - layout.horizon);
  for (let y = layout.horizon; y < rows; y++) {
    // 越往上（越靠穗）摆得越大；远处整体小一点
    const near = y >= layout.wheatTop;
    const rowF = near ? 1.05 - (0.55 * (y - layout.wheatTop)) / Math.max(1, rows - layout.wheatTop) : 0.45 + (0.25 * (y - layout.horizon)) / span;
    const o = y * cols;
    for (let x = 0; x < cols; x++) s.target[o + x] = s.colWind[x] * rowF + lean;
  }
}

function pushFromPointer(s: FieldState, p: Pointer) {
  const { cols, rows, layout, force } = s;
  const R = 6;
  const speed = Math.hypot(p.vx, p.vy);
  const k = 30 + Math.min(70, speed * 1.2);
  const y0 = Math.max(layout.horizon, Math.floor(p.y - R / 1.6));
  const y1 = Math.min(rows - 1, Math.ceil(p.y + R / 1.6));
  const x0 = Math.max(0, Math.floor(p.x - R));
  const x1 = Math.min(cols - 1, Math.ceil(p.x + R));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x - p.x;
      const dy = (y - p.y) * 1.6;
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      const f = 1 - d / R;
      const away = dx === 0 ? 0 : Math.sign(dx);
      force[y * cols + x] += (away * k + p.vx * 1.6) * f * f;
    }
}

function throwGust(s: FieldState, p: Pointer) {
  if (Math.abs(p.vx) < 28 || s.t - s.lastGustT < 0.35 || p.y < s.layout.horizon - 4) return;
  s.lastGustT = s.t;
  if (s.gusts.length > 3) s.gusts.shift();
  s.gusts.push({ x: p.x, dir: p.vx > 0 ? 1 : -1, strength: Math.min(1.6, Math.abs(p.vx) / 45), age: 0 });
}

function rollGusts(s: FieldState, dt: number) {
  const { cols, rows, layout, force } = s;
  for (const g of s.gusts) {
    g.age += dt;
    g.x += g.dir * 26 * dt;
    const a = g.strength * Math.max(0, 1 - g.age / 1.8) * 60;
    const x0 = Math.max(0, Math.floor(g.x - 3));
    const x1 = Math.min(cols - 1, Math.ceil(g.x + 3));
    for (let x = x0; x <= x1; x++) {
      const f = 1 - Math.abs(x - g.x) / 3.5;
      if (f <= 0) continue;
      for (let y = layout.horizon; y < rows; y++) force[y * cols + x] += g.dir * a * f;
    }
  }
  s.gusts = s.gusts.filter((g) => g.age < 1.8 && g.x > -4 && g.x < cols + 4);
}

function spawnMote(s: FieldState, kind: 1 | 2, x: number, y: number, vx: number, vy: number, life: number) {
  for (let i = 0; i < MOTES; i++)
    if (!s.mkind[i]) {
      s.mkind[i] = kind;
      s.mx[i] = x;
      s.my[i] = y;
      s.mvx[i] = vx;
      s.mvy[i] = vy;
      s.mlife[i] = life;
      return true;
    }
  return false;
}

function spawnFirefly(s: FieldState) {
  for (let i = 0; i < MOTES; i++)
    if (!s.mkind[i]) {
      s.mkind[i] = 3;
      s.mx[i] = rnd(s) * s.cols;
      s.my[i] = s.layout.horizon + 1 + rnd(s) * (s.rows - s.layout.horizon - 2);
      s.mvx[i] = (rnd(s) - 0.5) * 1.2;
      s.mvy[i] = (rnd(s) - 0.5) * 0.8;
      s.mlife[i] = 1e9;
      return;
    }
}

function stepMotes(s: FieldState, dt: number, bursts: FieldInput['bursts']): boolean {
  for (const b of bursts) {
    const n = 9;
    for (let k = 0; k < n; k++) spawnMote(s, k % 3 === 0 ? 2 : 1, b.x + (rnd(s) - 0.5) * 2, b.y, (rnd(s) - 0.5) * 9, -(5 + rnd(s) * 9), 1.8 + rnd(s) * 1.4);
  }
  if (s.phase !== 'night') {
    s.nextAmbient -= dt;
    if (s.nextAmbient <= 0) {
      s.nextAmbient = 2.2 + rnd(s) * 3.5;
      const x = rnd(s) * s.cols;
      spawnMote(s, rnd(s) < 0.4 ? 2 : 1, x, s.layout.wheatTop + rnd(s) * 2, 2 + rnd(s) * 3, -(1.2 + rnd(s) * 1.6), 5 + rnd(s) * 4);
    }
  }
  let bursting = false;
  for (let i = 0; i < MOTES; i++) {
    const k = s.mkind[i];
    if (!k) continue;
    if (k === 3) {
      // 萤火：慢慢游走，留在田里
      s.mvx[i] += (Math.sin(s.t * 0.7 + i * 1.7) * 0.6 - s.mvx[i]) * dt * 0.8;
      s.mvy[i] += (Math.cos(s.t * 0.5 + i * 2.3) * 0.4 - s.mvy[i]) * dt * 0.8;
      s.mx[i] = (s.mx[i] + s.mvx[i] * dt + s.cols) % s.cols;
      s.my[i] = clamp(s.my[i] + s.mvy[i] * dt, s.layout.horizon + 1, s.rows - 2);
      continue;
    }
    const wind = s.colWind[clamp(Math.round(s.mx[i]), 0, s.cols - 1)] || 0;
    s.mvx[i] += (wind * 6 + s.breeze * 4 - s.mvx[i]) * dt * 0.9;
    s.mvy[i] += 1.4 * dt; // 很轻的重力：先升后缓缓落
    s.mvy[i] = Math.min(s.mvy[i], 1.6);
    s.mx[i] += s.mvx[i] * dt;
    s.my[i] += s.mvy[i] * dt;
    s.mlife[i] -= dt;
    if (s.mlife[i] <= 0 || s.mx[i] < -1 || s.mx[i] > s.cols + 1 || s.my[i] < 0 || s.my[i] >= s.rows) s.mkind[i] = 0;
    else if (s.mlife[i] < 6 && Math.abs(s.mvy[i]) > 2) bursting = true;
  }
  return bursting;
}

export function stepField(s: FieldState, dtIn: number, input: FieldInput) {
  const dt = clamp(dtIn, 0, 0.25);
  s.t += dt;
  s.breeze += (clamp(input.breeze, -1, 1) - s.breeze) * Math.min(1, dt * 3);
  s.pointerAge += dt;
  if (input.pointer) {
    s.pointer = input.pointer;
    s.pointerAge = 0;
    throwGust(s, input.pointer);
  }
  if (s.pointer && s.pointerAge < 0.12) pushFromPointer(s, s.pointer);
  rollGusts(s, dt);
  computeTargets(s);
  const start = s.layout.horizon * s.cols;
  const end = s.cols * s.rows;
  const n = Math.max(1, Math.ceil(dt * 40));
  const h = dt / n;
  const { bend, vel, target, force } = s;
  let dev = 0;
  for (let k = 0; k < n; k++)
    for (let i = start; i < end; i++) {
      const b = bend[i];
      const v = vel[i] + (SPRING_K * (target[i] - b) - SPRING_C * vel[i] + force[i]) * h;
      vel[i] = v;
      bend[i] = clamp(b + v * h, -MAX_BEND, MAX_BEND);
      if (k === n - 1) {
        const d = Math.abs(target[i] - bend[i]) + Math.abs(v) * 0.04;
        if (d > dev) dev = d;
      }
    }
  force.fill(0, start, end);
  s.deviation = dt > 0 ? dev : s.deviation;
  const bursting = stepMotes(s, dt, input.bursts);
  s.active = s.deviation > SETTLED || s.gusts.length > 0 || bursting || s.pointerAge < 0.4 || Math.abs(s.breeze) > 0.05;
}

// —— 树 ——
const TREE = [
  '   .:;;:.   ',
  ' .;%@@@%;:. ',
  ';%@@@@@@@%;.',
  " ';%@@@%;'  ",
  '    |||     ',
  '   /|||\\    ',
];

function stalkGlyph(b: number, v: number): number {
  if (b > 0.8) return G_SLASH2;
  if (b > 0.2) return G_SLASH;
  if (b < -0.8) return G_BACK2;
  if (b < -0.2) return G_BACK;
  return v < 0.12 ? G_L : v < 0.2 ? G_EXCL : G_PIPE;
}
const G_L = gi('l');
const G_EXCL = gi('!');
const G_PIPE = gi('|');
const G_SLASH = gi('/');
const G_BACK = gi('\\');
const G_SLASH2 = gi(')');
const G_BACK2 = gi('(');

/** 状态 → 每格的字符下标与颜色下标（chars / colors） */
export function renderField(s: FieldState) {
  const { cols, rows, layout, chars, colors, t, seed, bend } = s;
  chars.fill(0);
  colors.fill(0);
  const put = (x: number, y: number, ch: number, c: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const i = y * cols + x;
    chars[i] = ch;
    colors[i] = c;
  };
  const night = s.phase === 'night';
  // 天：云（白天）或星（夜晚）
  const cloudTop = Math.max(1, Math.round(layout.horizon * 0.12));
  const cloudBot = Math.round(layout.horizon * 0.55);
  for (let y = cloudTop; y < cloudBot; y++) {
    for (let x = 0; x < cols; x++) {
      if (night) {
        const h = hash(x, y, seed + 99);
        if (h > 0.985) {
          const tw = Math.sin(t * (0.6 + h * 2) + x) > -0.4;
          if (tw) put(x, y, h > 0.995 ? gi('*') : gi('·'), C.mote1);
        }
        continue;
      }
      // 白天的云交给 CSS（柔和、模糊、只走合成层），画布上只留零星几点
      if (hash(x, y, seed + 3) > 0.996 && Math.sin(t * 0.3 + x) > 0) put(x, y, gi('·'), C.sky);
    }
  }
  // 地平线：一条若有若无的远树线
  for (let x = 0; x < cols; x++) {
    const h = noise2(x * 0.18, 1.5, seed + 7);
    if (h > 0.35) put(x, layout.horizon - 1, h > 0.62 ? gi('^') : gi('_'), C.far2);
    else put(x, layout.horizon - 1, gi('.'), C.far1);
  }
  // 树
  const tx = Math.round(cols * (cols < 70 ? 0.74 : 0.8)) - 6;
  for (let r = 0; r < TREE.length; r++) {
    const line = TREE[r];
    const y = layout.horizon - TREE.length + r + 1;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === ' ') continue;
      const trunk = r >= 4;
      put(tx + c, y, gi(ch), trunk ? C.tree2 : ch === '@' ? C.tree0 : C.tree1);
    }
  }
  // 远处麦田：稀疏短笔画 + 随风滚动的亮带（麦浪）
  for (let y = layout.horizon; y < layout.wheatTop; y++) {
    const depth = (y - layout.horizon) / Math.max(1, layout.wheatTop - layout.horizon);
    for (let x = 0; x < cols; x++) {
      if (chars[y * cols + x]) continue;
      const h = hash(x, y, seed + 13);
      if (h > 0.28 + depth * 0.5) continue;
      const b = bend[y * cols + x];
      const wave = Math.sin(0.16 * x - 1.05 * t + y * 0.55 + b * 1.4);
      let ch = b > 0.3 ? gi('`') : b < -0.3 ? gi(',') : gi("'");
      if (depth > 0.55 && h < 0.18) ch = b > 0.3 ? gi('/') : b < -0.3 ? gi('\\') : gi('|');
      const c = wave > 0.72 ? C.ear0 : depth < 0.33 ? C.far0 : depth < 0.66 ? C.far1 : C.far2;
      put(x, y, ch, c);
      if (h < 0.006) put(x, y, gi('o'), C.flower);
    }
  }
  // 近处麦子：三排，每列一根麦秆；穗的长短随排数（后排 1 格、中排 2 格、前排 3 格），随弯曲偏移
  const bandH = rows - layout.wheatTop;
  const EAR = [[gi(':')], [gi('%'), gi('#')], [gi('%'), gi('@'), gi('%')]];
  for (let L = 0; L < 3; L++) {
    for (let x = 0; x < cols; x++) {
      if (s.layer[x] !== L) continue;
      const top = s.stalkTop[x];
      const ear = EAR[L];
      for (let y = top + ear.length; y < rows; y++) {
        const i = y * cols + x;
        const v = hash(x, y, seed + 31);
        const depth = (y - layout.wheatTop) / Math.max(1, bandH);
        const shade = C.stalk0 + Math.min(5, Math.floor(depth * 5 + L * 0.6));
        if (v > 0.93) continue; // 秆上偶尔断开，透气
        put(x, y, stalkGlyph(bend[i], v), shade);
        // 叶子
        if (v < 0.035 && y > top + 2) put(x + (bend[i] >= 0 ? 1 : -1), y, bend[i] >= 0 ? gi('/') : gi('\\'), shade);
      }
      const bt = bend[Math.max(0, top) * cols + x];
      const wave = Math.sin(0.14 * x - 1.1 * t + bt * 1.2);
      const earC = wave > 0.6 ? C.ear0 : hash(x, 5, seed) > 0.5 ? C.ear1 : C.ear2;
      for (let k = 0; k < ear.length; k++) {
        const lift = ear.length - k; // 越靠上偏得越多
        put(x + Math.round(bt * (0.5 + lift * 0.45)), top + k, ear[k], k === 0 && L === 0 ? C.ear0 : earC);
      }
      // 麦芒
      if (L > 0 && hash(x, 7, seed) > 0.35) put(x + Math.round(bt * (1 + ear.length * 0.45)), top - 1, bt > 0.3 ? gi('`') : bt < -0.3 ? gi(',') : gi("'"), C.ear0);
    }
  }
  // 空列：零星矮草
  for (let x = 0; x < cols; x++) {
    if (s.layer[x] !== 3) continue;
    for (let y = layout.wheatTop + Math.round(bandH * 0.4); y < rows; y++) {
      const i = y * cols + x;
      if (!chars[i] && hash(x, y, seed + 21) < 0.4) put(x, y, stalkGlyph(bend[i], 0.5), C.stalk0 + 2);
    }
  }
  // 飘絮
  for (let i = 0; i < s.mkind.length; i++) {
    const k = s.mkind[i];
    if (!k) continue;
    const x = Math.round(s.mx[i]);
    const y = Math.round(s.my[i]);
    if (k === 3) {
      const on = Math.sin(t * 1.6 + i * 2.1) > -0.2;
      if (on) put(x, y, gi('•'), Math.sin(t * 1.6 + i * 2.1) > 0.6 ? C.mote1 : C.mote0);
    } else put(x, y, k === 2 ? (s.mvx[i] > 0 ? gi('`') : gi("'")) : gi('·'), k === 2 ? C.ear0 : C.mote0);
  }
}

/** 格子坐标下这里是不是麦田（地平线以下） */
export function inField(s: FieldState, y: number) {
  return y >= s.layout.horizon - 2;
}
