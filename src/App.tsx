import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureForm, emptyDraft, type Draft } from './components/CaptureForm';
import { ClipOffer, QuickBar, QuickWindow } from './components/QuickBar';
import { ConfirmLayer, type ConfirmReq } from './components/Confirm';
import { Detail } from './components/Detail';
import { Sheet } from './components/Sheet';
import { addItem, db, deleteItem, restoreItem, snapshotItem, touchItems, updateItem } from './lib/db';
import { getOriginalDataUrl } from './lib/imagestore';
import { enrichItem } from './lib/enrich';
import { detectMotionLevel } from './lib/motion';
import { onQuickFocus, onTrayGo } from './lib/desktop';
import { shareToDraft, takeShared } from './lib/share';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { Ctx, type ConfirmOpts, type View } from './lib/store';
import { resolveTheme, type Theme } from './lib/theme';
import { TYPE_LABEL, type Item } from './lib/types';
import { shortDate } from './lib/studio';
import { Library } from './views/Library';
import { Onboarding, needsOnboarding } from './views/Onboarding';
import { Loading } from './components/DisplayTitle';

// v0.20：首屏只需要穗仓；其余四页拆成单独的包，首屏画完后空闲时预取（点过去时通常已经在内存里）。
// 省下的首包体积抵掉 Framer Motion 带来的增量，冷启动不变慢。
const loadDevelop = () => import('./views/Develop');
const loadBranches = () => import('./views/Branches');
const loadTaste = () => import('./views/Taste');
const loadSettings_ = () => import('./views/SettingsView');
const Develop = lazy(() => loadDevelop().then((m) => ({ default: m.Develop })));
const Branches = lazy(() => loadBranches().then((m) => ({ default: m.Branches })));
const Taste = lazy(() => loadTaste().then((m) => ({ default: m.Taste })));
const SettingsView = lazy(() => loadSettings_().then((m) => ({ default: m.SettingsView })));
export function prefetchViews() {
  void loadDevelop();
  void loadBranches();
  void loadTaste();
  void loadSettings_();
}
import { MotionRoot } from './components/rw/MotionRoot';
import { NAV, NavBar } from './components/rw/NavBar';
import { Toasts, type ToastT } from './components/rw/Toasts';
import { ThemeToggle } from './components/rw/ThemeToggle';
import { IconSearch } from './components/rw/icons';

/** 打开穗仓里的秒搜（侧栏 / 顶栏的搜索按钮、Ctrl+K 都走这里） */
export const SEARCH_EVENT = 'glean:search';

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

function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const f = () => setOn(navigator.onLine !== false);
    window.addEventListener('online', f);
    window.addEventListener('offline', f);
    return () => {
      window.removeEventListener('online', f);
      window.removeEventListener('offline', f);
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
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState<number[] | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const [onboard, setOnboard] = useState<boolean | null>(null);
  const [quickWin, setQuickWin] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const theme = useTheme(settings.theme);
  const desktop = useMedia('(min-width: 1024px)');
  const online = useOnline();
  const motion = useMemo(detectMotionLevel, []);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17161a' : '#f7f5f1');
  }, [theme]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);
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
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmReq({ ...o, resolve })), []);

  const setSettings = useCallback((s: Settings) => {
    saveSettings(s);
    setSettingsState(s);
  }, []);

  const openCapture = useCallback(() => setCapture({ draft: emptyDraft() }), []);
  const openItem = useCallback((it: Item) => {
    setDetail(it);
    // v0.14 打开即「碰过」：每日一穗按它找很久没碰的旧穗
    if (it.id != null) void touchItems([it.id]).catch(() => {});
  }, []);
  const developFrom = useCallback((ids: number[]) => {
    setPreset(ids);
    setDetail(null);
    setView('develop');
  }, []);
  const go = useCallback((v: View) => {
    setDetail(null);
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

  // 安卓分享菜单 → 直接拾进穗仓
  useEffect(() => {
    const pull = async () => {
      const d = shareToDraft(takeShared());
      if (!d) return;
      const id = await addItem(d);
      toast('已拾进穗仓');
      enrichItem(id, settingsRef.current).then((err) => {
        if (err) toast('AI 整理失败：' + err, 'err');
      });
    };
    void pull();
    const vis = () => {
      if (document.visibilityState === 'visible') void pull();
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('focus', vis);
    };
  }, [toast]);

  // 托盘菜单：打开穗仓 / 今日一穗 / 设置
  useEffect(() => {
    let off = () => {};
    let dead = false;
    onTrayGo((v) => {
      setCapture(null);
      setDetail(null);
      if (v === 'settings') setView('settings');
      else {
        setView('library');
        if (v === 'daily') setTimeout(() => document.querySelector('.daily-ear')?.scrollIntoView({ block: 'start' }), 300);
      }
    }).then((f) => (dead ? f() : (off = f)));
    return () => {
      dead = true;
      off();
    };
  }, []);

  // 全局速记小窗（托盘 / Ctrl+Shift+L 唤出；浏览器里由 glean:quick 事件唤出）
  useEffect(() => {
    const on = () => setQuickWin(true);
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

  // 快捷键：N = 速记展开
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || capture || detail || confirmReq) return;
      if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openCapture();
      }
      // 侧栏标着的 Alt+1…4 / Alt+, 切页
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
  }, [capture, detail, confirmReq, openCapture, go]);

  async function onSave(d: Draft) {
    setSaving(true);
    try {
      let id: number;
      if (capture?.editId) {
        id = capture.editId;
        // 原图在 images 表：只有真的换了 / 删了图才动它（带 image 键），否则不碰
        const imageChanged = (capture.origImage || undefined) !== (d.image || undefined);
        const { image, ...rest } = d;
        await updateItem(id, { ...rest, ...(imageChanged ? { image: image || undefined, caption: undefined } : {}), embedding: undefined, embedModel: undefined });
        toast('已更新');
      } else {
        id = await addItem(d);
        toast('已拾进穗仓');
      }
      setCapture(null);
      setDetail(null);
      enrichItem(id, settingsRef.current).then((err) => {
        if (err) toast('AI 整理失败：' + err, 'err');
      });
    } catch (e) {
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(it: Item) {
    if (!it.id) return;
    const used = (await db.developments.toArray()).filter((d) => d.itemIds.includes(it.id!)).length;
    const ok = await confirm({
      title: `删掉「${it.title}」？`,
      body: used ? `它是 ${used} 根新枝的来源。删掉以后，这些新枝的「因为这几穗」里会少它一穗。` : '删掉以后 5 秒内可以撤销。',
      ok: '删掉',
      cancel: '留着',
      danger: true,
    });
    if (!ok) return;
    const snap = await snapshotItem(it.id);
    await deleteItem(it.id);
    setDetail(null);
    setCapture(null);
    toast('已删掉 1 穗', 'ok', snap ? { label: '撤销', run: () => void restoreItem(snap).then(() => toast('已放回穗仓')) } : undefined);
  }

  if (onboard) return (
    <Ctx.Provider value={ctx}>
      <MotionRoot level={motion}>
        <Onboarding onDone={() => setOnboard(false)} />
      </MotionRoot>
    </Ctx.Provider>
  );

  return (
    <Ctx.Provider value={ctx}>
      <MotionRoot level={motion}>
      <div className={`app${desktop ? ' is-desktop' : ' is-mobile'}`}>
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
          {!online && (
            <div className="offline-bar" role="status">
              <span className="offline-dot" aria-hidden />
              离线 · 拾穗照常保存，嫁接会改用离线方式
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
            <Suspense fallback={<Loading />}>
              {view === 'library' && <Library />}
              {view === 'develop' && <Develop preset={preset} clearPreset={() => setPreset(null)} />}
              {view === 'branches' && <Branches />}
              {view === 'taste' && <Taste />}
              {view === 'settings' && <SettingsView />}
            </Suspense>
          </main>
          <footer className="colophon">© 2026 Q1f730</footer>
        </div>
        {!desktop && (
          <div className="dock">
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
            <Detail
              it={detail}
              onEdit={() => editDetail(detail)}
              onDelete={() => onDelete(detail)}
              onDevelop={() => developFrom([detail.id!])}
              onWhen={async (ts) => {
                await updateItem(detail.id!, { createdAt: ts });
                const fresh = await db.items.get(detail.id!);
                if (fresh) setDetail(fresh);
                toast('时间已改');
              }}
              onReAI={async () => {
                const err = await enrichItem(detail.id!, settings, true);
                toast(err ? 'AI 整理失败：' + err : 'AI 已重新整理', err ? 'err' : 'ok');
                const fresh = await db.items.get(detail.id!);
                if (fresh) setDetail(fresh);
              }}
            />
          )}
        </Sheet>

        {quickWin && <QuickWindow onClose={() => setQuickWin(false)} />}
        {!capture && !detail && <ClipOffer />}
        <ConfirmLayer req={confirmReq} onDone={() => setConfirmReq(null)} />

        <Toasts toasts={toasts} dismiss={(id) => setToasts((x) => x.filter((y) => y.id !== id))} />
      </div>
      </MotionRoot>
    </Ctx.Provider>
  );

  async function editDetail(it: Item) {
    const { id, createdAt: _c, updatedAt: _u, thumb: _t, thumbW: _w, thumbH: _h, thumbTodo: _td, thumbFail: _f, hasImage: _hi, ...rest } = it;
    void _c, void _u, void _t, void _w, void _h, void _td, void _f, void _hi;
    // 编辑时才把原图读出来给表单预览
    const origImage = id != null && (it.hasImage || it.image) ? await getOriginalDataUrl(db, id) : undefined;
    setCapture({ draft: { ...rest, image: origImage }, editId: id, origImage });
  }
}
