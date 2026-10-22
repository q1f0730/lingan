// 拾穗的一天：清晨 / 白天 / 黄昏 / 夜晚。页面（CSS 变量）和麦田（画布颜色）都从这里取色，
// 所以纸、字、麦子永远是一套。思路来自阿卡迪亚 theme/phases.ts，色值为拾穗重调（麦金为主）。
// 每段只有一个强调色；__tests__/phases.test.ts 检查正文/弱文字/强调文字在纸片上过 WCAG AA。

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';
export type PhasePref = 'auto' | Phase;
export const PHASE_ORDER: Phase[] = ['dawn', 'day', 'dusk', 'night'];
export const PHASE_LABEL: Record<Phase, string> = { dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜晚' };
export const PHASE_WHISPER: Record<Phase, string> = {
  dawn: 'Glean what the night left behind',
  day: 'Glean what the day left behind',
  dusk: 'Gather before the light goes',
  night: 'The field keeps what you gleaned',
};

/** 本地时间 → 一天中的哪一段。清晨 5–8 点，白天 8–17 点，黄昏 17–19:30，其余夜晚。 */
export function phaseAt(d: Date = new Date()): Phase {
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= 300 && m < 480) return 'dawn';
  if (m >= 480 && m < 1020) return 'day';
  if (m >= 1020 && m < 1170) return 'dusk';
  return 'night';
}

/** 距离下一段开始还有多少毫秒（用于定时切换） */
export function msToNextPhase(d: Date = new Date()): number {
  const m = d.getHours() * 60 + d.getMinutes();
  const bounds = [300, 480, 1020, 1170, 1440 + 300];
  const next = bounds.find((b) => b > m) ?? 1440 + 300;
  return Math.max(1000, (next - m) * 60000 - d.getSeconds() * 1000 - d.getMilliseconds());
}

export function resolvePhase(pref: PhasePref | undefined, d: Date = new Date()): Phase {
  return pref && pref !== 'auto' ? pref : phaseAt(d);
}

export interface PhaseUi {
  dark: boolean;
  paper: string; // 页面底色（纸）
  paperDeep: string;
  ink: string;
  inkSoft: string;
  inkFaint: string; // 只用于装饰/提示，不承载必须读的正文
  line: string;
  accent: string; // 唯一强调色：标记、焦点环、选中
  accentInk: string; // 强调色作为文字时（在纸片上过 AA）
  accentSoft: string;
  panel: string; // 纸片
  panelSolid: string;
  shadow: string;
  titleInk: string;
  titleHalo: string;
  buttonBg: string;
  buttonInk: string;
  skyTop: string; // 页面上方的天
  skyLow: string; // 地平线附近
  ground: string; // 麦田下方的地色
  gold: string[]; // 热力图 0..4（麦金深浅）
}

export interface PhaseInk {
  sky: string; // 云
  far: string[]; // 远处麦田（淡 → 深）
  stalk: string[]; // 麦秆，近处更深（上 → 下）
  ear: string[]; // 麦穗：亮 / 中 / 深
  tree: string[]; // 树冠、树叶、树干
  mote: string[]; // 飘起的种子 / 萤火：[主, 次]
  flower: string; // 田里零星的花（强调色）
}

export interface PhaseTokens {
  ui: PhaseUi;
  ink: PhaseInk;
}

const LIGHT = {
  dark: false,
  paper: '#f5efe2',
  paperDeep: '#ece3d0',
  ink: '#221d16',
  inkSoft: '#574d40',
  inkFaint: '#8d806c',
  line: '#ddd0b8',
  panel: 'rgba(252, 249, 242, 0.95)',
  panelSolid: '#fcf9f2',
  shadow: '0 1px 2px rgba(70, 52, 24, 0.06), 0 10px 30px -12px rgba(70, 52, 24, 0.22)',
} as const;

export const PHASES: Record<Phase, PhaseTokens> = {
  dawn: {
    ui: {
      ...LIGHT,
      accent: '#d9661f',
      accentInk: '#a9470f',
      accentSoft: '#f9dfc8',
      titleInk: '#2b1d12',
      titleHalo: 'rgba(255, 222, 190, 0.95)',
      buttonBg: '#2b2018',
      buttonInk: '#fcf8f0',
      skyTop: '#e9c9b2',
      skyLow: '#f6e3cf',
      ground: '#e6d3a8',
      gold: ['#ece2cc', '#efcf94', '#e3ad5c', '#c98a34', '#9c6420'],
    },
    ink: {
      sky: 'rgba(255, 246, 236, 0.8)',
      far: ['#d8c08d', '#c8aa6c', '#b7965a'],
      stalk: ['#b08a45', '#9c773a', '#876531', '#715328', '#5b421f', '#463217'],
      ear: ['#f0b860', '#d99a3c', '#b57a28'],
      tree: ['#4a3d2c', '#5d4c35', '#4a3427'],
      mote: ['#f6c27a', '#fff1dc'],
      flower: '#e2702b',
    },
  },
  day: {
    ui: {
      ...LIGHT,
      accent: '#3f8a2f',
      accentInk: '#2f6a22',
      accentSoft: '#dcebcf',
      titleInk: '#1b2210',
      titleHalo: 'rgba(250, 248, 230, 0.95)',
      buttonBg: '#232b17',
      buttonInk: '#fcf9f0',
      skyTop: '#b9cdd2',
      skyLow: '#eef0e2',
      ground: '#e4d6a6',
      gold: ['#ebe3cd', '#ead190', '#d9b056', '#b88c2c', '#86621a'],
    },
    ink: {
      sky: 'rgba(255, 255, 255, 0.78)',
      far: ['#cdbb7c', '#b9a560', '#a08d4c'],
      stalk: ['#a99447', '#94803a', '#7d6c30', '#675a27', '#51471f', '#3b3417'],
      ear: ['#e9c25a', '#d0a43a', '#ae8526'],
      tree: ['#2c3d22', '#3b5129', '#4a3622'],
      mote: ['#f3dc8f', '#fffbe8'],
      flower: '#4f9c3a',
    },
  },
  dusk: {
    ui: {
      ...LIGHT,
      paper: '#f5ece3',
      accent: '#c43f63',
      accentInk: '#a2284b',
      accentSoft: '#f5d6dc',
      titleInk: '#2b1519',
      titleHalo: 'rgba(255, 220, 206, 0.95)',
      buttonBg: '#2c1b1e',
      buttonInk: '#fcf8f0',
      skyTop: '#d9b3b5',
      skyLow: '#f4ddcf',
      ground: '#dfc39c',
      gold: ['#ece0d0', '#eccb95', '#dca35c', '#bb7d35', '#8c561f'],
    },
    ink: {
      sky: 'rgba(255, 238, 228, 0.8)',
      far: ['#d4b48c', '#c09d72', '#a8865e'],
      stalk: ['#a98249', '#94703d', '#7e5f33', '#694e2a', '#543e21', '#3f2e19'],
      ear: ['#efb26a', '#d48f46', '#ad6c30'],
      tree: ['#3a2a24', '#4c372d', '#3b2a20'],
      mote: ['#f2a8a0', '#fde9dc'],
      flower: '#d04a6c',
    },
  },
  night: {
    ui: {
      dark: true,
      paper: '#141a26',
      paperDeep: '#1b2232',
      ink: '#efe9d8',
      inkSoft: '#c3bca9',
      inkFaint: '#8c8879',
      line: '#323c52',
      accent: '#f3d34a',
      accentInk: '#f3d34a',
      accentSoft: '#3b3822',
      panel: 'rgba(25, 31, 46, 0.95)',
      panelSolid: '#191f2e',
      shadow: '0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px -12px rgba(0, 0, 0, 0.6)',
      titleInk: '#f8f2de',
      titleHalo: 'rgba(243, 211, 74, 0.28)',
      buttonBg: '#efe6c6',
      buttonInk: '#141a26',
      skyTop: '#0e1320',
      skyLow: '#1d2536',
      ground: '#1a1f22',
      gold: ['#232b3c', '#4a4630', '#7d6f34', '#b89c3c', '#f3d34a'],
    },
    ink: {
      sky: '#2a3348',
      far: ['#3b4438', '#465040', '#525b47'],
      stalk: ['#6d6a4c', '#625f44', '#57543c', '#4b4834', '#3f3c2c', '#333124'],
      ear: ['#a59a62', '#8f8552', '#787045'],
      tree: ['#0b1014', '#11181c', '#0e0f10'],
      mote: ['#f3d34a', '#fff3a8'],
      flower: '#f3d34a',
    },
  },
};

/** 把一段的 ui 色写成 CSS 变量 */
export function phaseCssVars(p: Phase): Record<string, string> {
  const u = PHASES[p].ui;
  const v: Record<string, string> = {
    '--paper': u.paper,
    '--paper-deep': u.paperDeep,
    '--ink': u.ink,
    '--ink-soft': u.inkSoft,
    '--ink-faint': u.inkFaint,
    '--line': u.line,
    '--accent': u.accent,
    '--accent-ink': u.accentInk,
    '--accent-soft': u.accentSoft,
    '--panel': u.panel,
    '--panel-solid': u.panelSolid,
    '--shadow': u.shadow,
    '--title-ink': u.titleInk,
    '--title-halo': u.titleHalo,
    '--btn-bg': u.buttonBg,
    '--btn-ink': u.buttonInk,
    '--sky-top': u.skyTop,
    '--sky-low': u.skyLow,
    '--ground': u.ground,
  };
  u.gold.forEach((c, i) => (v[`--gold-${i}`] = c));
  return v;
}

// —— WCAG 对比度 ——
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
export function parseColor(c: string): [number, number, number] {
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = c.match(/rgba?\(([^)]+)\)/);
  if (r) {
    const [a, b, d] = r[1].split(',').map((x) => parseFloat(x));
    return [a, b, d];
  }
  throw new Error('bad color ' + c);
}
export function luminance(c: string): number {
  const [r, g, b] = parseColor(c);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
