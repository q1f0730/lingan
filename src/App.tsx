import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hidden } from './lib/lock';
import { CaptureForm, emptyDraft, type Draft } from './components/CaptureForm';
import { ClipOffer, QuickBar, QuickWindow } from './components/QuickBar';
import { ConfirmLayer, type ConfirmReq } from './components/Confirm';
import { Sheet } from './components/Sheet';
import { addItem, alive, db, inboxEnabled, touchItems, trashItems, untrashItems, updateItem } from './lib/db';
import { notifyDupe, savedMsg } from './lib/dupnotice';
import { getOriginalDataUrl } from './lib/imagestore';
import { enrichItem } from './lib/enrich';
import { detectMotionLevel } from './lib/motion';
import { isTauriEnv, onQuickFocus, onTrayGo } from './lib/desktop';
import { shareToDraft, takeGo, takeShared } from './lib/share';
import { afterAdd } from './components/QuickBar';
import { NowPlayingTray } from './components/NowPlaying';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { Ctx, type ConfirmOpts, type View } from './lib/store';
import { resolveTheme, type Theme } from './lib/theme';
import { TYPE_LABEL, type Item } from './lib/types';
import { shortDate } from './lib/studio';
import { Library } from './views/Library';
import { needsOnboarding } from './lib/onboard';
const Onboarding = lazy(() => import('./views/Onboarding').then((m) => ({ default: m.Onboarding })));
import { Loading } from './components/DisplayTitle';
import { ErrorBoundary } from './components/ErrorBoundary';
import { collectDiagnostics } from './lib/diagcollect';
import { isSafeMode, setErrView, setSafeMode } from './lib/errlog';
import { onVaultError } from './lib/settings';
import { initChrome, syncSystemTheme } from './lib/chrome';

// v0.20：首屏只需要穗仓；其余四页拆成单独的包，首屏画完后空闲时预取（点过去时通常已经在内存里）。
// 省下的首包体积抵掉 Framer Motion 带来的增量，冷启动不变慢。
const loadDevelop = () => import('./views/Develop');
const loadBranches = () => import('./views/Branches');
const loadTaste = () => import('./views/Taste');
const loadSettings_ = () => import('./views/SettingsView');
// v0.29 作品工坊：懒加载，空闲时预取
const loadWorks = () => import('./views/Works');
const Works = lazy(() => loadWorks().then((m) => ({ default: m.Works })));
const Develop = lazy(() => loadDevelop().then((m) => ({ default: m.Develop })));
const Branches = lazy(() => loadBranches().then((m) => ({ default: m.Branches })));
const Taste = lazy(() => loadTaste().then((m) => ({ default: m.Taste })));
const SettingsView = lazy(() => loadSettings_().then((m) => ({ default: m.SettingsView })));
// v0.27：详情页（带就地编辑、标签补全）和拖放 / 长按菜单也拆出首包：首屏画完空闲时预取 / 挂上
const loadDetail = () => import('./components/Detail');
const Detail = lazy(() => loadDetail().then((m) => ({ default: m.Detail })));
const DropIn = lazy(() => import('./components/DropIn').then((m) => ({ default: m.DropIn })));
const CardMenu = lazy(() => import('./components/CardMenu').then((m) => ({ default: m.CardMenu })));
// v0.28 0408 待嫁接篮：首屏之后才挂
const Basket = lazy(() => import('./components/Basket'));
// v0.34 分享出去：卡片菜单 / 新枝发 glean:share 事件才拉分享面板
const SharePanel = lazy(() => import('./components/SharePanel'));
export const IDLE_READY = 'glean:idle-ready';
export function prefetchViews() {
  void loadDetail();
  window.dispatchEvent(new Event(IDLE_READY));
  void loadDevelop();
  void loadBranches();
  void loadTaste();
  void loadSettings_();
  void loadWorks();
}
import { MotionRoot } from './components/rw/MotionRoot';
import { NAV, NavBar } from './components/rw/NavBar';
import { Toasts, type ToastT } from './components/rw/Toasts';
import { ThemeToggle } from './components/rw/ThemeToggle';
import { IconSearch } from './components/rw/icons';
import { outboundOff } from './lib/gate';

/** 打开穗仓里的秒搜（侧栏 / 顶栏的搜索按钮、Ctrl+K 都走这里） */
export const SEARCH_EVENT = 'glean:search';

/** 自检用：localStorage glean.debug.crash = 页面名 时让该页抛错，验证错误兜底（e2e 用） */
function CrashProbe({ view }: { view: string }) {
  let want: string | null = null;
  try {
    want = localStorage.getItem('glean.debug.crash');
  } catch {
    /* ignore */
  }
  if (want && want === view) throw new Error(`crash probe: ${view}`);
  return null;
}

function useMedia(q: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** 白 / 黑：设置里固定，或跟随系统 */
function useTheme(pref: Settings['theme']): Theme {
  const sysDark = useMedia('(prefers-color-scheme: dark)');
  return resolveTheme(pref, sysDark);
}

// v0.34 0905：出站总开关关着时，离线黑条也出来，写「出站已关」
function useOnline(): boolean | 'gate' {
  const st = (): boolean | 'gate' => (outboundOff() ? 'gate' : typeof navigator === 'undefined' || navigator.onLine !== false);
  const [on, setOn] = useState(st);
  useEffect(() => {
    const f = () => setOn(st());
    for (const e of ['online', 'offline', 'glean:gate']) window.addEventListener(e, f);
    return () => {
      for (const e of ['online', 'offline', 'glean:gate']) window.removeEventListener(e, f);
    };
  }, []);
  return on;
}

export default function App() {
  const [view, setView] = useState<View>('library');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const [capture, setCapture] = useState<{ draft: Draft; editId?: number; origImage?: string } | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  // v0.28 0402 桌面三栏（≥1500px 的穗仓）：单击在右栏预览，双击 / 「整页」才开整页详情
  const [preview, setPreview] = useState<Item | null>(null);
  const [seq, setSeq] = useState<number[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState<number[] | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const [shareReq, setShareReq] = useState<{ item: number } | { dev: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setShareReq((e as CustomEvent).detail);
    window.addEventListener('glean:share', on);
    return () => window.removeEventListener('glean:share', on);
  }, []);
  const [onboard, setOnboard] = useState<boolean | null>(null);
  const [quickWin, setQuickWin] = useState(false);
  const [quickText, setQuickText] = useState('');
  // 首屏画完、空闲后才挂拖放 / 长按菜单（main.tsx afterFirstPaint → prefetchViews 发 IDLE_READY；兜底 4 秒）
  const [idle, setIdle] = useState(false);
  // v0.40 菜单真正开始监听之前就右键一张卡：拦下系统菜单、记住是哪一穗和位置，立刻挂菜单并补开（以前这一下会弹出浏览器自己的菜单）。
  // 「开始监听」以 CardMenu 的 onLive 为准，不是 idle：idle 之后 CardMenu 块还要下载 / 解析，中间那一下右键以前会丢（整套 e2e 的 v034 卡住就是它）
  const [early, setEarly] = useState<{ id: number; x: number; y: number; n: number } | null>(null);
  const menuLive = useRef(false);
  const onMenuLive = useCallback(() => void (menuLive.current = true), []);
  useEffect(() => {
    const on = () => setIdle(true);
    const ctx = (e: MouseEvent) => {
      if (menuLive.current) return;
      const el = (e.target as Element | null)?.closest?.('[data-item-id]') as HTMLElement | null;
      if (!el || !el.closest('.main')) return;
      const id = Number(el.dataset.itemId);
      if (!Number.isFinite(id)) return;
      e.preventDefault();
      setEarly((p) => ({ id, x: e.clientX, y: e.clientY, n: (p?.n || 0) + 1 }));
      on();
    };
    window.addEventListener(IDLE_READY, on);
    document.addEventListener('contextmenu', ctx);
    const t = setTimeout(on, 4000);
    return () => {
      window.removeEventListener(IDLE_READY, on);
      document.removeEventListener('contextmenu', ctx);
      clearTimeout(t);
    };
  }, []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const theme = useTheme(settings.theme);
  const desktop = useMedia('(min-width: 1024px)');
  const wide = useMedia('(min-width: 1500px)');
  const pane = wide && view === 'library';
  const paneRef = useRef(pane);
  paneRef.current = pane;
  useEffect(() => {
    if (!pane) setPreview(null);
  }, [pane]);
  const online = useOnline();
  const safe = useMemo(isSafeMode, []);
  const motion = useMemo(() => (safe ? 'off' : detectMotionLevel()), [safe]);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // v0.27 0416：状态栏 / 窗口标题栏跟着主题
    syncSystemTheme(theme, isTauriEnv());
  }, [theme]);
  // v0.27 0401 / 0410：软键盘高度、安卓全面屏安全区
  useEffect(() => initChrome(), []);
  // v0.27 0403：切页后回来，回到原来的那张卡和滚动位置（不再一律回顶）。记「锚点卡 + 它离顶的距离」，
  // 懒加载 / 虚拟列表 / 上方模块晚到导致页面高度变化时，按锚点卡追位置，而不是死认像素。
  const scrollPos = useRef<Partial<Record<View, { y: number; id?: string; top?: number }>>>({});
  const viewRef = useRef(view);
  const restoring = useRef(false);
  useEffect(() => {
    let raf = 0;
    const anchorAt = () => {
      for (const y of [140, 220, 320]) {
        for (const fx of [0.5, 0.25, 0.75]) {
          const el = document.elementFromPoint(window.innerWidth * fx, y)?.closest<HTMLElement>('.main [data-item-id]');
          if (el) return { id: el.dataset.itemId, top: el.getBoundingClientRect().top };
        }
      }
      return {};
    };
    const on = () => {
      if (raf || restoring.current) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (restoring.current || document.body.style.overflow === 'hidden') return;
        scrollPos.current[viewRef.current] = window.scrollY > 0 ? { y: window.scrollY, ...anchorAt() } : { y: 0 };
      });
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      window.removeEventListener('scroll', on);
      cancelAnimationFrame(raf);
    };
  }, []);
  useEffect(() => {
    viewRef.current = view;
    setErrView(view);
    const want = scrollPos.current[view];
    if (!want || !want.y) {
      window.scrollTo(0, 0);
      return;
    }
    // 最多追 1.5 秒；连续 12 帧不用再动就停；用户自己一动就停
    restoring.current = true;
    let n = 0;
    let still = 0;
    let raf = 0;
    const tick = () => {
      const el = want.id ? document.querySelector<HTMLElement>(`.main [data-item-id="${want.id}"]`) : null;
      let moved = false;
      if (el && want.top != null) {
        const d = el.getBoundingClientRect().top - want.top;
        if (Math.abs(d) > 2) {
          window.scrollBy(0, d);
          moved = true;
        }
      } else if (Math.abs(window.scrollY - want.y) > 2) {
        window.scrollTo(0, want.y);
        moved = true;
      }
      still = moved ? 0 : still + 1;
      if (still >= 12 || ++n > 90) {
        restoring.current = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = () => {
      restoring.current = false;
      cancelAnimationFrame(raf);
    };
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchstart', stop, { once: true, passive: true });
    return () => {
      stop();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
    };
  }, [view]);
  // v0.27 0417：别的窗口 / 标签页改了设置（主题等），这里跟着变；穗本身由 Dexie 跨窗口通知自动刷新
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === 'lingan.settings.v1') setSettingsState(loadSettings());
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  // 第一次打开（空仓、没走过引导）才出引导；老用户升级不打扰
  useEffect(() => {
    let alive = true;
    needsOnboarding().then((n) => alive && setOnboard(n));
    return () => {
      alive = false;
    };
  }, []);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok', action?: ToastT['action']) => {
    const id = Date.now() + Math.random();
    const ms = action ? 5000 : kind === 'err' ? 6000 : 2600;
    setToasts((t) => [...t.slice(-2), { id, msg, kind, action, ms }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  useEffect(() => onVaultError(() => toast('密钥没能写进系统钥匙串，请到设置里重新保存一次', 'err')), [toast]);
  // v0.26 0605：上次写不进库、暂存着的穗补进来了
  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<{ done: number; left: number }>).detail;
      toast(`上次没存进去的 ${r.done} 穗已补进穗仓${r.left ? `（还有 ${r.left} 穗等空间腾出来）` : ''}`);
    };
    window.addEventListener('glean:replayed', on);
    return () => window.removeEventListener('glean:replayed', on);
  }, [toast]);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmReq({ ...o, resolve })), []);

  const setSettings = useCallback((s: Settings) => {
    saveSettings(s);
    setSettingsState(s);
  }, []);

  const openCapture = useCallback(() => setCapture({ draft: emptyDraft() }), []);
  // v0.27 0403：关掉详情回到刚才那张卡（翻过上一穗 / 下一穗就回到最后看的那张），并轻轻标一下
  const lastOpened = useRef<number | null>(null);
  useEffect(() => {
    if (detail) {
      lastOpened.current = detail.id ?? null;
      return;
    }
    const id = lastOpened.current;
    lastOpened.current = null;
    if (id == null) return;
    requestAnimationFrame(() => {
      const all = Array.from(document.querySelectorAll<HTMLElement>(`.main [data-item-id="${id}"]`));
      // 只认穗仓里的卡片 / 列表行 / 时间线帧（秒搜结果、回顾里的链接不抢焦点）
      const el = all.find((e) => /\b(card|trow|tl-frame)\b/.test(e.className) && !e.closest('.search-view'));
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ block: 'center' });
      el.focus?.({ preventScroll: true });
      el.classList.add('was-open');
      setTimeout(() => el.classList.remove('was-open'), 1600);
    });
  }, [detail]);
  const openItem = useCallback((it: Item, list?: number[], opts?: { full?: boolean }) => {
    if (paneRef.current && !opts?.full) {
      setPreview(it);
      setDetail(null);
    } else setDetail(it);
    setSeq(list && list.length > 1 ? list : null);
    // v0.14 打开即「碰过」：每日一穗按它找很久没碰的旧穗
    if (it.id != null) void touchItems([it.id]).catch(() => {});
  }, []);
  // v0.23 0113 详情页上一穗 / 下一穗：按打开时那个视图的顺序翻（桌面 ← / →，手机左右滑）
  const stepDetail = useCallback(
    async (dir: 1 | -1) => {
      const cur = detail || preview;
      if (!cur?.id || !seq) return;
      let i = seq.indexOf(cur.id);
      for (let k = 0; k < seq.length; k++) {
        i += dir;
        if (i < 0 || i >= seq.length) return;
        const next = await db.items.get(seq[i]);
        if (next && alive(next)) {
          if (detail) setDetail(next);
          else setPreview(next);
          void touchItems([next.id!]).catch(() => {});
          return;
        }
      }
    },
    [detail, preview, seq],
  );
  const developFrom = useCallback((ids: number[]) => {
    setPreset(ids);
    setDetail(null);
    setView('develop');
  }, []);
  const go = useCallback((v: View) => {
    setDetail(null);
    setPreview(null);
    setView(v);
  }, []);
  const openSearch = useCallback(() => {
    setDetail(null);
    setView('library');
    setTimeout(() => window.dispatchEvent(new Event(SEARCH_EVENT)), 0);
  }, []);

  const ctx = useMemo(
    () => ({ settings, setSettings, toast, confirm, openItem, openCapture, go, developFrom, theme, desktop }),
    [settings, setSettings, toast, confirm, openItem, openCapture, go, developFrom, theme, desktop],
  );

  // 安卓：旧版分享桥（升级过渡）+ v0.22 极速拾收件箱（半屏面板 / 选字菜单 / 磁贴 / 通知 / 小部件写进来的穗）
  const goRef = useRef<(v: string) => void>(() => {});
  useEffect(() => {
    let alive = true;
    const hasInbox = typeof window !== 'undefined' && 'LinganInbox' in window;
    const pull = async () => {
      const d = shareToDraft(takeShared());
      if (d) {
        const id = await addItem(d, db, { inbox: true });
        toast(savedMsg());
        void notifyDupe(id, toast);
        enrichItem(id, settingsRef.current).then((err) => {
          if (err) toast('AI 整理失败：' + err, 'err');
        });
      }
      // 极速拾收件箱只在安卓有：没桥就不加载这部分代码（首包不变大）
      const r = hasInbox ? await (await import('./lib/capture')).drainInbox(db) : null;
      if (!alive) return;
      if (r && r.added.length) {
        const one = r.added.length === 1 ? r.added[0].draft : null;
        toast(one ? `极速拾 · 收进「${one.title.slice(0, 16)}」${one.source ? ' · 来自 ' + one.source : ''}${inboxEnabled() ? ' · 在待理' : ''}` : `极速拾 · 收进 ${r.added.length} 穗${inboxEnabled() ? ' · 在待理' : ''}`);
        if (one) void notifyDupe(r.added[0].id, toast);
        for (const a of r.added) afterAdd(a.id, a.draft, settingsRef.current, (m) => toast(m, 'err'));
      }
      const go = takeGo();
      if (go) goRef.current(go);
    };
    void pull();
    // 面板上的「最近用过的标签」：一打开就先同步一次
    if (hasInbox) void import('./lib/capture').then((m) => m.pushHints(db));
    const vis = () => {
      if (document.visibilityState === 'visible') void pull();
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', vis);
    // v0.23 后台同步：App 在后台、WebView 还活着时，原生收件箱一有新条目就发 glean:inbox，马上收进来（不等回到前台）
    let busy = false;
    const bg = () => {
      if (busy) return;
      busy = true;
      void pull().finally(() => (busy = false));
    };
    window.addEventListener('glean:inbox', bg);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('focus', vis);
      window.removeEventListener('glean:inbox', bg);
    };
  }, [toast]);

  // v0.25 安卓 / 桌面：空闲时才加载 本地 API（按设置开）+ 每天一次的更新检查；网页版不加载这块
  useEffect(() => {
    if (!isTauriEnv()) return;
    let off = () => {};
    let dead = false;
    const t = setTimeout(() => {
      void import('./lib/agentboot')
        .then((m) => m.boot({ toast, confirm, version: __APP_VERSION__ }))
        .then((f) => (dead ? f() : (off = f)))
        .catch(() => {});
    }, 4000);
    return () => {
      dead = true;
      clearTimeout(t);
      off();
    };
  }, [toast, confirm]);

  // v0.28 0402 三栏里双击卡片 = 开整页详情
  useEffect(() => {
    if (!pane) return;
    const h = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-item-id]') as HTMLElement | null;
      if (!el || !el.closest('.main') || el.closest('.search-view')) return;
      const id = Number(el.dataset.itemId);
      if (!Number.isFinite(id)) return;
      void db.items.get(id).then((it) => it && !it.deletedAt && (setPreview(null), setDetail(it)));
    };
    document.addEventListener('dblclick', h);
    return () => document.removeEventListener('dblclick', h);
  }, [pane]);

  // 托盘菜单：打开穗仓 / 今日一穗 / 设置
  useEffect(() => {
    let off = () => {};
    let dead = false;
    const goTo = (v: string) => {
      // v0.33 0510 glean:// 深链接（托盘 / 单实例 / 安卓 intent 都走这里）
      if (/^glean:/i.test(v)) return void window.dispatchEvent(new CustomEvent('glean:link', { detail: v }));
      setCapture(null);
      setDetail(null);
      if (v === 'settings') setView('settings');
      else {
        setView('library');
        if (v === 'daily') setTimeout(() => document.querySelector('.daily-ear')?.scrollIntoView({ block: 'start' }), 300);
        if (v === 'search') setTimeout(() => window.dispatchEvent(new Event(SEARCH_EVENT)), 300);
      }
    };
    goRef.current = goTo;
    onTrayGo(goTo).then((f) => (dead ? f() : (off = f)));
    return () => {
      dead = true;
      off();
    };
  }, []);

  // v0.33 深链接 / 系统入口：路由代码懒加载（桌面与安卓在空闲后起 entryboot）
  const linkCtx = useRef<unknown>(null);
  linkCtx.current = { openItem, developFrom, toast, settings, goTo: (v: string) => goRef.current(v), quick: (t: string) => (setQuickText(t), setQuickWin(true)) };
  useEffect(() => {
    const on = (e: Event) => void import('./lib/deeplink').then((m) => m.routeLink(String((e as CustomEvent).detail || ''), linkCtx.current as never));
    window.addEventListener('glean:link', on);
    if (idle && isTauriEnv()) void import('./lib/entryboot').then((m) => m.boot(linkCtx as never));
    return () => window.removeEventListener('glean:link', on);
  }, [idle]);

  // 全局速记小窗（托盘 / Ctrl+Shift+L 唤出；浏览器里由 glean:quick 事件唤出）
  useEffect(() => {
    const on = (t?: unknown) => (setQuickText(typeof t == 'string' ? t : ''), setQuickWin(true));
    window.addEventListener('glean:quick', on);
    let off = () => {};
    let dead = false;
    onQuickFocus(on).then((f) => (dead ? f() : (off = f)));
    return () => {
      dead = true;
      off();
      window.removeEventListener('glean:quick', on);
    };
  }, []);

  // 快捷键：N = 速记展开；详情里 ← / → 翻上一穗 / 下一穗
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (preview && !detail && !capture && !confirmReq && e.key === 'Escape') {
        setPreview(null);
        return;
      }
      if ((detail || preview) && !capture && !confirmReq && seq && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void stepDetail(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (capture || detail || confirmReq) return;
      // v0.27 0406：Ctrl+N 打开完整表单（浏览器里可能被浏览器自己抢走，桌面版一定好用）
      if ((e.key === 'n' || e.key === 'N') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        openCapture();
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openCapture();
      }
      // 侧栏标着的 Alt+1…5 / Alt+, 切页
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const hit = NAV.find((n) => n.key === e.key || (n.key !== ',' && e.code === 'Digit' + n.key) || (n.key === ',' && e.code === 'Comma'));
        if (hit) {
          e.preventDefault();
          go(hit.v);
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [capture, detail, preview, confirmReq, openCapture, go, seq, stepDetail]);

  async function onSave(d: Draft) {
    setSaving(true);
    try {
      let id: number;
      if (capture?.editId) {
        id = capture.editId;
        // 原图在 images 表：只有真的换了 / 删了图才动它（带 image 键），否则不碰
        const imageChanged = (capture.origImage || undefined) !== (d.image || undefined);
        const { image, ...rest } = d;
        // v0.23 编辑过 = 整理过：出待理
        await updateItem(id, { ...rest, ...(imageChanged ? { image: image || undefined, caption: undefined } : {}), embedding: undefined, embedModel: undefined, inbox: undefined });
        toast('已更新');
      } else {
        // 展开速记里填好再存的：算整理过，直接进穗仓
        id = await addItem(d);
        toast('已拾进穗仓');
        void notifyDupe(id, toast);
      }
      setCapture(null);
      setDetail(null);
      enrichItem(id, settingsRef.current).then((err) => {
        if (err) toast('AI 整理失败：' + err, 'err');
      });
    } catch (e) {
      // v0.26 0605：写不进库但已暂存（下次打开自动补上）：表单照常关掉
      if ((e as { name?: string } | null)?.name === 'PendingWriteError') {
        setCapture(null);
        toast((e as Error).message, 'err');
      } else toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(it: Item) {
    if (!it.id) return;
    const used = (await db.developments.toArray()).filter((d) => alive(d) && d.itemIds.includes(it.id!)).length;
    const ok = await confirm({
      title: `删掉「${it.title}」？`,
      body: used ? `它是 ${used} 根新枝的来源。删掉以后，这些新枝的「因为这几穗」里会少它一穗。会先放进回收站，30 天内可以在设置里恢复。` : '会先放进回收站，30 天内可以在设置里恢复。',
      ok: '删掉',
      cancel: '留着',
      danger: true,
    });
    if (!ok) return;
    // v0.21 删除 = 立墓碑进回收站（原图、来源都不动），撤销 = 拔掉墓碑
    const id = it.id;
    await trashItems([id]);
    setDetail(null);
    setPreview((p) => (p?.id === id ? null : p));
    setCapture(null);
    toast('已删掉 1 穗（在回收站）', 'ok', { label: '撤销', run: () => void untrashItems([id]).then(() => toast('已放回穗仓')) });
  }

  if (onboard) return (
    <Ctx.Provider value={ctx}>
      <MotionRoot level={motion}>
        <Suspense fallback={null}>
          <Onboarding onDone={() => setOnboard(false)} />
        </Suspense>
      </MotionRoot>
    </Ctx.Provider>
  );

  return (
    <Ctx.Provider value={ctx}>
      <MotionRoot level={motion}>
      <div className={`app${desktop ? ' is-desktop' : ' is-mobile'}${pane && preview ? ' has-preview' : ''}`}>
        {desktop && (
          <aside className="sidebar" aria-label="侧栏">
            <button className="logo" onClick={() => go('library')} aria-label="拾穗 · GLEAN，回到穗仓">
              <span className="logo-mark" aria-hidden>
                拾
              </span>
              <span className="logo-text">
                拾穗 <span className="logo-en">GLEAN</span>
              </span>
            </button>
            <NavBar view={view} go={go} layout="side" />
            <button className="side-search" onClick={openSearch}>
              <IconSearch size={17} />
              <span>搜索</span>
              <kbd>Ctrl K</kbd>
            </button>
            {idle && (
              <Suspense fallback={null}>
                <Basket where="side" />
              </Suspense>
            )}
            <div className="side-foot">
              <div className="side-theme">
                <span className="meta-text">{theme === 'dark' ? '黑' : '白'}</span>
                <ThemeToggle dark={theme === 'dark'} onChange={(d) => setSettings({ ...settings, theme: d ? 'dark' : 'light' })} />
              </div>
              <p className="side-tip meta-text">
                按 <kbd>N</kbd> 展开速记，<kbd>Ctrl Shift L</kbd> 在任何程序里唤出
              </p>
            </div>
          </aside>
        )}
        <div className="shell">
          {safe && (
            <div className="safe-bar" role="status">
              安全模式 · 动效和后台任务已关
              <button className="btn text safe-exit" onClick={() => { setSafeMode(false); location.reload(); }}>
                退出安全模式
              </button>
            </div>
          )}
          {online !== true && (
            <div className="offline-bar" role="status">
              <span className="offline-dot" aria-hidden />
              {online === 'gate' ? '出站已关 · 只用本地功能，不往外网发任何东西' : settings.preset === 'local' ? '离线 · 拾穗照常保存，本地模型照常嫁接' : '离线 · 拾穗照常保存，嫁接会改用离线方式'}
            </div>
          )}
          <header className="topbar">
            {desktop ? (
              <>
                <QuickBar where="top" />
                <span className="topbar-hint meta-text">回车即存 · 链接自动认出歌和电影</span>
              </>
            ) : (
              <>
                <button className="logo" onClick={() => go('library')} aria-label="拾穗 · GLEAN，回到穗仓">
                  <span className="logo-mark" aria-hidden>
                    拾
                  </span>
                  <span className="logo-text">
                    拾穗 <span className="logo-en">GLEAN</span>
                  </span>
                </button>
                <button className="top-search" onClick={openSearch} aria-label="搜索">
                  <IconSearch size={19} />
                </button>
              </>
            )}
          </header>
          <main className="main">
            <ErrorBoundary scope="view" name={view} resetKey={view} copyDiag={collectDiagnostics}>
              <Suspense fallback={<Loading />}>
                <CrashProbe view={view} />
                {view === 'library' && <Library />}
                {view === 'develop' && <Develop preset={preset} clearPreset={() => setPreset(null)} />}
                {view === 'branches' && <Branches />}
                {view === 'works' && <Works />}
                {view === 'taste' && <Taste />}
                {view === 'settings' && <SettingsView />}
              </Suspense>
            </ErrorBoundary>
          </main>
          <footer className="colophon">© 2026 Q1f730</footer>
        </div>
        {pane && preview && (
          <aside className="preview-pane" aria-label="预览">
            <style>{`.main [data-item-id="${preview.id}"]{outline:2px solid var(--fg);outline-offset:2px}`}</style>
            <header className="preview-head">
              <span className="label">{`${preview.sample ? '示例 · ' : ''}${TYPE_LABEL[preview.type]} · ${shortDate(preview.createdAt)}`}</span>
              <span className="preview-acts">
                <button className="btn text preview-full" onClick={() => (setDetail(preview), setPreview(null))} title="整页打开（双击卡片也行）">
                  整页
                </button>
                <button className="btn text preview-close" onClick={() => setPreview(null)} aria-label="关掉预览（Esc）">
                  ✕
                </button>
              </span>
            </header>
            <Suspense fallback={<Loading />}>
              <Detail key={preview.id} {...detailProps(preview, setPreview)} />
            </Suspense>
          </aside>
        )}
        {!desktop && (
          <div className="dock">
            {idle && (
              <Suspense fallback={null}>
                <Basket where="dock" />
              </Suspense>
            )}
            <QuickBar where="dock" />
            <NavBar view={view} go={go} layout="dock" />
          </div>
        )}

        <Sheet open={!!capture} onClose={() => setCapture(null)} title={capture?.editId ? '编辑穗' : '速记'} variant={capture?.editId ? 'page' : 'capture'}>
          {capture && <CaptureForm initial={capture.draft} onSave={onSave} onCancel={() => setCapture(null)} saving={saving} editing={!!capture.editId} onDelete={capture.editId ? () => db.items.get(capture.editId!).then((it) => it && onDelete(it)) : undefined} />}
        </Sheet>

        <Sheet
          open={!!detail && !capture}
          onClose={() => setDetail(null)}
          title={detail ? `${detail.sample ? '示例 · ' : ''}${TYPE_LABEL[detail.type]} · ${shortDate(detail.createdAt)}` : ''}
          variant="page"
          aside={
            detail ? (
              <button className="sheet-act" onClick={() => editDetail(detail)}>
                编辑
              </button>
            ) : null
          }
        >
          {detail && (
            <Suspense fallback={<Loading />}>
            <Detail {...detailProps(detail, setDetail)} />
            </Suspense>
          )}
        </Sheet>

        {quickWin && <QuickWindow key={quickText} initial={quickText} onClose={() => setQuickWin(false)} />}
        {idle && (
          <Suspense fallback={null}>
            <DropIn blocked={!!capture || !!detail || !!confirmReq || quickWin} />
            <CardMenu
          early={early}
          onLive={onMenuLive}
          blocked={!!capture || !!detail || !!confirmReq || quickWin}
          onAct={(a, it) => {
            if (a === 'open') openItem(it);
            else if (a === 'edit') void editDetail(it);
            else if (a === 'graft') developFrom([it.id!]);
            else if (a === 'delete') void onDelete(it);
          }}
            />
          </Suspense>
        )}
        {shareReq && (
          <Suspense fallback={null}>
            <SharePanel req={shareReq} onClose={() => setShareReq(null)} />
          </Suspense>
        )}
        <NowPlayingTray />
        {!capture && !detail && <ClipOffer />}
        <ConfirmLayer req={confirmReq} onDone={() => setConfirmReq(null)} />

        <Toasts toasts={toasts} dismiss={(id) => setToasts((x) => x.filter((y) => y.id !== id))} />
      </div>
      </MotionRoot>
    </Ctx.Provider>
  );

  function detailProps(cur: Item, set: (it: Item) => void) {
    return {
      it: cur,
      pos: seq && cur.id != null ? { i: seq.indexOf(cur.id), n: seq.length } : undefined,
      onStep: seq ? (dir: 1 | -1) => void stepDetail(dir) : undefined,
      onEdit: () => void editDetail(cur),
      onDelete: () => void onDelete(cur),
      onDevelop: () => developFrom([cur.id!]),
      onWhen: async (ts: number) => {
        await updateItem(cur.id!, { createdAt: ts });
        const fresh = await db.items.get(cur.id!);
        if (fresh) set(fresh);
        toast('时间已改');
      },
      onReAI: async () => {
        const err = await enrichItem(cur.id!, settings, true);
        toast(err ? 'AI 整理失败：' + err : 'AI 已重新整理', err ? 'err' : 'ok');
        const fresh = await db.items.get(cur.id!);
        if (fresh) set(fresh);
      },
    };
  }

  async function editDetail(it0: Item) {
    // 详情里可能刚改过（加标签 / 留下 / 合并）：编辑前读最新的
    const it = (it0.id != null ? await db.items.get(it0.id) : null) || it0;
    // v0.39 0907 上锁且没解锁：不给编辑（表单里会露内容）
    if (hidden(it)) return toast('这一穗上锁了：先输 PIN 解锁', 'err');
    const { id, createdAt: _c, updatedAt: _u, thumb: _t, thumbW: _w, thumbH: _h, thumbTodo: _td, thumbFail: _f, hasImage: _hi, dup: _dp, inbox: _ib, ...rest } = it;
    void _c, void _u, void _t, void _w, void _h, void _td, void _f, void _hi, void _dp, void _ib;
    // 编辑时才把原图读出来给表单预览
    const origImage = id != null && (it.hasImage || it.image) ? await getOriginalDataUrl(db, id) : undefined;
    setCapture({ draft: { ...rest, image: origImage }, editId: id, origImage });
  }
}
