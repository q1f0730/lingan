import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureForm, emptyDraft, type Draft } from './components/CaptureForm';
import { safeHost } from './components/ItemCard';
import { ClipOffer } from './components/QuickBar';
import { level, useButtonFx } from './components/Motion';
import { Field } from './components/Field';
import { IcGear, IcGraft, IcPlus, IcSheaf, IcSprout, IcTaste } from './components/Icons';
import { Sheet } from './components/Sheet';
import { formatWhen, fromLocalInput, toLocalInput } from './lib/quick';
import { addItem, db, deleteItem, touchItems, updateItem } from './lib/db';
import { getOriginalDataUrl } from './lib/imagestore';
import { useOriginalSrc } from './lib/useImage';
import { enrichItem } from './lib/enrich';
import { msToNextPhase, phaseCssVars, PHASES, resolvePhase, type Phase } from './lib/phases';
import { shareToDraft, takeShared } from './lib/share';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { Ctx, type View } from './lib/store';
import { TYPE_LABEL, type Item } from './lib/types';
import { Branches } from './views/Branches';
import { Develop } from './views/Develop';
import { Library } from './views/Library';
import { SettingsView } from './views/SettingsView';
import { Taste } from './views/Taste';

const NAV: Array<{ v: View; label: string; Icon: typeof IcSheaf }> = [
  { v: 'library', label: '穗仓', Icon: IcSheaf },
  { v: 'develop', label: '嫁接', Icon: IcGraft },
  { v: 'branches', label: '新枝', Icon: IcSprout },
  { v: 'taste', label: '口味', Icon: IcTaste },
  { v: 'settings', label: '设置', Icon: IcGear },
];

/** 当前时段：设置里固定，或跟随本地时间（到点自动切换） */
function usePhase(pref: Settings['phase']): Phase {
  const [phase, setPhase] = useState<Phase>(() => resolvePhase(pref));
  useEffect(() => {
    setPhase(resolvePhase(pref));
    if (pref !== 'auto') return;
    let t = 0;
    const arm = () => {
      t = window.setTimeout(() => {
        setPhase(resolvePhase('auto'));
        arm();
      }, msToNextPhase());
    };
    arm();
    const onVis = () => document.visibilityState === 'visible' && setPhase(resolvePhase('auto'));
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [pref]);
  return phase;
}

export default function App() {
  const [view, setView] = useState<View>('library');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; kind: 'ok' | 'err' }>>([]);
  const [capture, setCapture] = useState<{ draft: Draft; editId?: number; origImage?: string } | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState<number[] | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const phase = usePhase(settings.phase);
  const motion = level();

  useButtonFx();
  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(phaseCssVars(phase))) root.style.setProperty(k, v);
    root.dataset.phase = phase;
    root.dataset.sky = PHASES[phase].ui.dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PHASES[phase].ui.paper);
  }, [phase]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 2600);
  }, []);

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
    setView('develop');
  }, []);

  const ctx = useMemo(
    () => ({ settings, setSettings, toast, openItem, openCapture, go: setView, developFrom, phase }),
    [settings, setSettings, toast, openItem, openCapture, developFrom, phase],
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

  // 快捷键：N = 速记
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || capture || detail) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openCapture();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [capture, detail, openCapture]);

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
    if (!confirm(`删除「${it.title}」？`)) return;
    await deleteItem(it.id);
    setDetail(null);
    toast('已删除');
  }

  return (
    <Ctx.Provider value={ctx}>
      <Field phase={phase} still={motion === 'off' || settings.fieldStill} lite={motion === 'lite'} />
      <div className="app">
        <nav className="nav" aria-label="主导航">
          <div className="brand">
            <span className="brand-name">拾穗</span>
            <span className="brand-sub">Glean</span>
          </div>
          {NAV.map((n, idx) => [
            idx === 2 && (
              <button key="add" className="nav-add" onClick={openCapture} aria-label="速记">
                <IcPlus />
              </button>
            ),
            <button key={n.v} className={`nav-btn${view === n.v ? ' on' : ''}`} onClick={() => setView(n.v)} aria-current={view === n.v ? 'page' : undefined}>
              <n.Icon />
              <span>{n.label}</span>
            </button>,
          ])}
          <button className="nav-write" onClick={openCapture}>
            <IcPlus /> 拾一穗
          </button>
        </nav>
        <main className="main">
          {view === 'library' && <Library />}
          {view === 'develop' && <Develop preset={preset} clearPreset={() => setPreset(null)} />}
          {view === 'branches' && <Branches />}
          {view === 'taste' && <Taste />}
          {view === 'settings' && <SettingsView />}
        </main>

        <Sheet open={!!capture} onClose={() => setCapture(null)} title={capture?.editId ? '编辑这一穗' : '速记'}>
          {capture && <CaptureForm initial={capture.draft} onSave={onSave} onCancel={() => setCapture(null)} saving={saving} />}
        </Sheet>

        <Sheet open={!!detail && !capture} onClose={() => setDetail(null)} title={detail ? `${detail.sample ? '示例 · ' : ''}${TYPE_LABEL[detail.type]} · ${formatWhen(detail.createdAt)}` : ''}>
          {detail && (
            <Detail
              it={detail}
              onEdit={async () => {
                const { id, createdAt: _c, updatedAt: _u, thumb: _t, thumbW: _w, thumbH: _h, thumbTodo: _td, thumbFail: _f, hasImage: _hi, ...rest } = detail;
                void _c, void _u, void _t, void _w, void _h, void _td, void _f, void _hi;
                // 编辑时才把原图读出来给表单预览
                const origImage = id != null && (detail.hasImage || detail.image) ? await getOriginalDataUrl(db, id) : undefined;
                setCapture({ draft: { ...rest, image: origImage }, editId: id, origImage });
              }}
              onDelete={() => onDelete(detail)}
              onDevelop={() => {
                setDetail(null);
                developFrom([detail.id!]);
              }}
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

        {!capture && !detail && <ClipOffer />}

        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.msg}
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function Detail({ it, onEdit, onDelete, onDevelop, onReAI, onWhen }: { it: Item; onEdit: () => void; onDelete: () => void; onDevelop: () => void; onReAI: () => void; onWhen: (ts: number) => void }) {
  const full = useOriginalSrc(it);
  return (
    <div className="detail">
      {full && <img className="detail-img" src={full} alt={it.title} decoding="async" />}
      <h2 className="detail-title">{it.title}</h2>
      {(it.creator || it.year) && (
        <div className="card-sub">
          {it.creator}
          {it.creator && it.year ? ' · ' : ''}
          {it.year}
        </div>
      )}
      {it.content && <p className="detail-content">{it.content}</p>}
      {it.url && (
        <a className="detail-url" href={it.url} target="_blank" rel="noreferrer">
          ↗ {safeHost(it.url)}
        </a>
      )}
      {it.why && (
        <blockquote className="detail-why">
          <span className="label">为什么打动我</span>
          {it.why}
        </blockquote>
      )}
      {it.caption && (
        <div className="detail-caption">
          <span className="label">AI 看到的</span>
          {it.caption}
        </div>
      )}
      {it.tags.length > 0 && (
        <div className="tags">
          {it.tags.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="when-row">
        <label>
          拾于{' '}
          <input
            type="datetime-local"
            className="when-input"
            aria-label="记录时间"
            defaultValue={toLocalInput(it.createdAt)}
            key={it.createdAt}
            onChange={(e) => {
              const t = fromLocalInput(e.target.value);
              if (t && Math.abs(t - it.createdAt) >= 60000) onWhen(t);
            }}
          />
        </label>
        {it.embedding ? <span className="dim"> · 已向量化</span> : null}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onDevelop}>
          以此嫁接
        </button>
        <button className="btn ghost" onClick={onEdit}>
          编辑
        </button>
        <button className="btn ghost" onClick={onReAI}>
          AI 重新整理
        </button>
        <button className="btn ghost danger" onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
  );
}
