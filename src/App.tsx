import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureForm, emptyDraft, type Draft } from './components/CaptureForm';
import { frameNo, safeHost } from './components/ItemCard';
import { Sheet } from './components/Sheet';
import { addItem, db, updateItem } from './lib/db';
import { enrichItem } from './lib/enrich';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { Ctx, type View } from './lib/store';
import { TYPE_LABEL, type Item } from './lib/types';
import { Develop } from './views/Develop';
import { Library } from './views/Library';
import { SettingsView } from './views/SettingsView';
import { Taste } from './views/Taste';

const NAV: Array<{ v: View; label: string; icon: string }> = [
  { v: 'library', label: '灵感库', icon: '▦' },
  { v: 'develop', label: '显影', icon: '◐' },
  { v: 'taste', label: '画像', icon: '◎' },
  { v: 'settings', label: '设置', icon: '⚙' },
];

export default function App() {
  const [view, setView] = useState<View>('library');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; kind: 'ok' | 'err' }>>([]);
  const [capture, setCapture] = useState<{ draft: Draft; editId?: number } | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState<number[] | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

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
  const openItem = useCallback((it: Item) => setDetail(it), []);
  const developFrom = useCallback((ids: number[]) => {
    setPreset(ids);
    setView('develop');
  }, []);

  const ctx = useMemo(
    () => ({ settings, setSettings, toast, openItem, openCapture, go: setView, developFrom }),
    [settings, setSettings, toast, openItem, openCapture, developFrom],
  );

  // keyboard shortcut: N = new
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
        const prev = await db.items.get(id);
        const imageChanged = prev?.image !== d.image;
        await updateItem(id, { ...d, ...(imageChanged ? { caption: undefined } : {}), embedding: undefined, embedModel: undefined });
        toast('已更新');
      } else {
        id = await addItem(d);
        toast('已收进暗房 ' + frameNo(id));
      }
      setCapture(null);
      setDetail(null);
      enrichItem(id, settingsRef.current).then((err) => {
        if (err) toast('AI 加工失败：' + err, 'err');
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
    await db.items.delete(it.id);
    setDetail(null);
    toast('已删除');
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <div className="grain" aria-hidden />
        <nav className="nav" aria-label="主导航">
          <div className="brand">
            <span className="brand-dot" />
            <span className="brand-name">灵感暗房</span>
            <span className="mono brand-sub">LINGAN</span>
          </div>
          {NAV.map((n, idx) => [
            idx === 2 && (
              <button key="add" className="nav-add" onClick={openCapture} aria-label="收集">
                ＋
              </button>
            ),
            <button key={n.v} className={`nav-btn${view === n.v ? ' on' : ''}`} onClick={() => setView(n.v)} aria-current={view === n.v ? 'page' : undefined}>
              <span className="nav-ic" aria-hidden>
                {n.icon}
              </span>
              <span>{n.label}</span>
            </button>,
          ])}
        </nav>
        <main className="main">
          {view === 'library' && <Library />}
          {view === 'develop' && <Develop preset={preset} clearPreset={() => setPreset(null)} />}
          {view === 'taste' && <Taste />}
          {view === 'settings' && <SettingsView />}
        </main>
        {view !== 'settings' && (
          <button className="fab" onClick={openCapture} aria-label="收集">
            ＋
          </button>
        )}

        <Sheet open={!!capture} onClose={() => setCapture(null)} title={capture?.editId ? '编辑素材' : '收集'}>
          {capture && <CaptureForm initial={capture.draft} onSave={onSave} onCancel={() => setCapture(null)} saving={saving} />}
        </Sheet>

        <Sheet open={!!detail && !capture} onClose={() => setDetail(null)} title={detail ? `${frameNo(detail.id)} · ${TYPE_LABEL[detail.type]}` : ''}>
          {detail && <Detail it={detail} onEdit={() => { const { id, createdAt: _c, updatedAt: _u, ...rest } = detail; void _c; void _u; setCapture({ draft: rest, editId: id }); }} onDelete={() => onDelete(detail)} onDevelop={() => { setDetail(null); developFrom([detail.id!]); }} onReAI={async () => { const err = await enrichItem(detail.id!, settings, true); toast(err ? 'AI 加工失败：' + err : 'AI 已重新加工', err ? 'err' : 'ok'); const fresh = await db.items.get(detail.id!); if (fresh) setDetail(fresh); }} />}
        </Sheet>

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

function Detail({ it, onEdit, onDelete, onDevelop, onReAI }: { it: Item; onEdit: () => void; onDelete: () => void; onDevelop: () => void; onReAI: () => void }) {
  return (
    <div className="detail">
      {it.image && <img className="detail-img" src={it.image} alt={it.title} />}
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
        <a className="detail-url mono" href={it.url} target="_blank" rel="noreferrer">
          ↗ {safeHost(it.url)}
        </a>
      )}
      {it.why && (
        <blockquote className="detail-why">
          <span className="label mono">为什么打动我</span>
          {it.why}
        </blockquote>
      )}
      {it.caption && (
        <div className="detail-caption">
          <span className="label mono">AI 看到的</span>
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
      <div className="mono dim small-meta">
        收于 {new Date(it.createdAt).toLocaleString('zh-CN')}
        {it.embedding ? ' · 已向量化' : ''}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onDevelop}>
          以此显影
        </button>
        <button className="btn ghost" onClick={onEdit}>
          编辑
        </button>
        <button className="btn ghost" onClick={onReAI}>
          AI 重新加工
        </button>
        <button className="btn ghost danger" onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
  );
}
