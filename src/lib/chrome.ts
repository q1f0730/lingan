import type { Theme } from './theme';

/**
 * v0.27 系统外框：
 * - 0401 软键盘：算出键盘盖住了多少（visualViewport），写进 --kb；键盘开着时 html[data-kb] 让底栏只留速记条、贴住键盘顶。
 * - 0410 全面屏：安卓原生把状态栏 / 手势条 / 刘海的尺寸写进 --safe-t/-b/-l/-r（WebView 的 env() 在边到边模式下常是 0）。
 * - 0416 状态栏 / 窗口标题栏跟着白 / 黑主题走（安卓 LinganChrome 桥、Windows 窗口主题、网页 theme-color）。
 */

export const KB_MIN = 80;

/** 视觉视口被键盘顶掉的高度（布局视口不跟着缩的浏览器 / iOS） */
export function keyboardInset(innerH: number, vvH: number, vvTop: number): number {
  const v = Math.round(innerH - vvH - vvTop);
  return v >= KB_MIN ? v : 0;
}

/** 布局视口自己缩了（安卓 adjustResize / interactive-widget=resizes-content）：比同宽度下见过的最高矮一截就是键盘开着 */
export function resizedByKeyboard(innerH: number, tallest: number): boolean {
  return tallest - innerH >= 150;
}

export interface Insets {
  t: number;
  b: number;
  l: number;
  r: number;
}

export function parseInsets(raw: string | null | undefined): Insets | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Insets>;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 400 ? Math.round(x) : 0);
    return { t: n(o.t), b: n(o.b), l: n(o.l), r: n(o.r) };
  } catch {
    return null;
  }
}

export function applyInsets(ins: Insets, root: HTMLElement = document.documentElement) {
  root.style.setProperty('--safe-t', ins.t + 'px');
  root.style.setProperty('--safe-b', ins.b + 'px');
  root.style.setProperty('--safe-l', ins.l + 'px');
  root.style.setProperty('--safe-r', ins.r + 'px');
  root.dataset.edge = '1';
}

interface ChromeBridge {
  insets?: () => string;
  setTheme?: (dark: boolean, bg: string) => void;
  secure?: (on: boolean) => void;
}
const bridge = (): ChromeBridge | null => (typeof window !== 'undefined' ? ((window as unknown as { LinganChrome?: ChromeBridge }).LinganChrome ?? null) : null);

/** v0.44 0567 安卓「最近任务」里不显示画面（FLAG_SECURE，也不能截屏）：glean.secure '1' 开 / '0' 关 / 没设 = 设了上锁 PIN 就开 */
export const SECURE_KEY = 'glean.secure';
export function secureOn(): boolean {
  try {
    const v = localStorage.getItem(SECURE_KEY);
    return v ? v === '1' : !!localStorage.getItem('glean.lock.v1');
  } catch {
    return false;
  }
}
export const hasSecure = () => !!bridge()?.secure;
export function applySecure(): void {
  bridge()?.secure?.(secureOn());
}

/** 启动时调一次：接上键盘与安全区 */
export function initChrome(): () => void {
  if (typeof window === 'undefined') return () => {};
  const root = document.documentElement;
  const b = bridge();
  applySecure();
  const ins = parseInsets(b?.insets?.());
  if (ins) applyInsets(ins);
  let tallest = window.innerHeight;
  let lastW = window.innerWidth;
  let raf = 0;
  const update = () => {
    raf = 0;
    const vv = window.visualViewport;
    if (window.innerWidth !== lastW) {
      lastW = window.innerWidth;
      tallest = window.innerHeight;
    }
    const focusedInput = (() => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    })();
    if (!focusedInput) tallest = Math.max(tallest, window.innerHeight);
    const kb = vv ? keyboardInset(window.innerHeight, vv.height, vv.offsetTop) : 0;
    const open = focusedInput && (kb > 0 || resizedByKeyboard(window.innerHeight, tallest));
    root.style.setProperty('--kb', kb + 'px');
    if (open) root.dataset.kb = '1';
    else delete root.dataset.kb;
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  const vv = window.visualViewport;
  vv?.addEventListener('resize', kick);
  vv?.addEventListener('scroll', kick);
  window.addEventListener('resize', kick);
  document.addEventListener('focusin', kick);
  document.addEventListener('focusout', () => setTimeout(kick, 50));
  const onIns = (e: Event) => {
    const d = (e as CustomEvent<Insets>).detail;
    if (d) applyInsets(d);
  };
  window.addEventListener('glean:insets', onIns);
  update();
  return () => {
    vv?.removeEventListener('resize', kick);
    vv?.removeEventListener('scroll', kick);
    window.removeEventListener('resize', kick);
    document.removeEventListener('focusin', kick);
    window.removeEventListener('glean:insets', onIns);
  };
}

export const THEME_BG: Record<Theme, string> = { light: '#f7f5f1', dark: '#17161a' };

/** 0416：主题一变，网页 theme-color、安卓状态栏 / 导航栏图标深浅、Windows 标题栏一起变 */
export function syncSystemTheme(theme: Theme, isTauri: boolean) {
  if (typeof document === 'undefined') return;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[theme]);
  const b = bridge();
  if (b?.setTheme) {
    try {
      b.setTheme(theme === 'dark', THEME_BG[theme]);
    } catch {
      /* 旧版原生没有这个桥 */
    }
    return;
  }
  if (isTauri && !/android/i.test(navigator.userAgent)) {
    // v0.33：直接调窗口插件命令（等同 getCurrentWindow().setTheme），不再为这一行加载 13KB 的 window 模块
    void import('@tauri-apps/api/core')
      .then((m) => m.invoke('plugin:window|set_theme', { label: (window as unknown as { __TAURI_INTERNALS__: { metadata: { currentWindow: { label: string } } } }).__TAURI_INTERNALS__.metadata.currentWindow.label, value: theme }))
      .catch(() => {});
  }
}
