import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { ItemCard } from '../components/ItemCard';
import { db } from '../lib/db';
import { developOffline, developWithAI } from '../lib/develop';
import { aiReady } from '../lib/settings';
import { daySeed, mulberry32, pickItems } from '../lib/similarity';
import { useApp } from '../lib/store';
import type { Development, Idea, Item } from '../lib/types';

const TASTE_KEY = 'lingan.taste.ai';

export function Develop({ preset, clearPreset }: { preset: number[] | null; clearPreset: () => void }) {
  const { settings, toast, openItem, go } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const history = useLiveQuery(() => db.developments.orderBy('createdAt').reverse().limit(50).toArray(), []);
  const [count, setCount] = useState<2 | 3>(2);
  const [jump, setJump] = useState(0.8);
  const [theme, setTheme] = useState('');
  const [picked, setPicked] = useState<Item[] | null>(null);
  const [result, setResult] = useState<{ idea: Idea; source: 'ai' | 'offline'; id?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const h = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => clearInterval(h);
  }, [busy]);

  const byId = useMemo(() => new Map((items || []).map((i) => [i.id!, i])), [items]);

  // daily negatives: same pair all day
  const daily = useMemo(() => {
    if (!items || items.length < 2) return null;
    return pickItems(items, 2, 0.9, mulberry32(daySeed()));
  }, [items]);

  useEffect(() => {
    if (preset && items) {
      const sel = preset.map((id) => byId.get(id)).filter(Boolean) as Item[];
      if (sel.length) {
        let full = sel;
        if (sel.length < 2) {
          const rest = items.filter((i) => !sel.includes(i));
          const extra = pickItems([sel[0], ...rest], 2, jump).filter((x) => x !== sel[0]);
          full = [sel[0], ...(extra.length ? [extra[0]] : [])];
        }
        setCount(full.length >= 3 ? 3 : 2);
        setPicked(full);
        setResult(null);
      }
      clearPreset();
    }
  }, [preset, items, byId, clearPreset, jump]);

  // keep picked items fresh (edited / deleted)
  useEffect(() => {
    if (picked && items) {
      const fresh = picked.map((p) => byId.get(p.id!)).filter(Boolean) as Item[];
      if (fresh.length !== picked.length || fresh.some((f, i) => f !== picked[i])) setPicked(fresh.length ? fresh : null);
    }
  }, [items, byId, picked]);

  if (!items) return <div className="loading mono">冲洗中…</div>;

  function shuffle() {
    if (!items || items.length < 2) return;
    setPicked(pickItems(items, count, jump));
    setResult(null);
  }

  function replaceOne(idx: number) {
    if (!items || !picked) return;
    const others = picked.filter((_, i) => i !== idx);
    const pool = items.filter((i) => !picked.includes(i));
    if (!pool.length) return;
    const next = pickItems([...others, ...pool], others.length + 1, jump).find((x) => !others.includes(x)) || pool[Math.floor(Math.random() * pool.length)];
    const arr = [...picked];
    arr[idx] = next;
    setPicked(arr);
    setResult(null);
  }

  async function develop(sel: Item[]) {
    if (sel.length < 2) return;
    setBusy(true);
    setResult(null);
    let idea: Idea;
    let source: 'ai' | 'offline' = 'offline';
    try {
      if (aiReady(settings)) {
        idea = await developWithAI(settings, sel, { theme: theme.trim() || undefined, taste: localStorage.getItem(TASTE_KEY) || undefined });
        source = 'ai';
      } else {
        idea = developOffline(sel, { theme: theme.trim() || undefined });
      }
    } catch (e) {
      toast((e instanceof Error ? e.message : String(e)) + '，已改用离线显影', 'err');
      idea = developOffline(sel, { theme: theme.trim() || undefined });
    }
    const dev: Development = { itemIds: sel.map((s) => s.id!), theme: theme.trim() || undefined, jump, idea, source, createdAt: Date.now() };
    const id = await db.developments.add(dev);
    setResult({ idea, source, id });
    setBusy(false);
  }

  const shown = picked || null;
  const list = (history || []).filter((h) => !showStarred || h.starred);

  return (
    <section className="view">
      <header className="view-head">
        <div>
          <div className="kicker mono">SAFELIGHT ON · 显影室</div>
          <h1>显影</h1>
        </div>
      </header>

      {items.length < 2 ? (
        <div className="empty">
          <h2>底片不够</h2>
          <p>至少需要 2 件素材才能碰撞。</p>
          <button className="btn primary" onClick={() => go('library')}>
            去收集
          </button>
        </div>
      ) : (
        <>
          {!shown && daily && (
            <div className="daily">
              <div className="kicker mono">今日底片 · {new Date().toLocaleDateString('zh-CN')}</div>
              <div className="negatives">
                {daily.map((it) => (
                  <div key={it.id} className="negative">
                    <ItemCard item={it} compact onOpen={openItem} />
                  </div>
                ))}
              </div>
              <div className="actions">
                <button className="btn primary" onClick={() => { setPicked(daily); develop(daily); }} disabled={busy}>
                  显影今日底片
                </button>
              </div>
            </div>
          )}

          <div className="controls">
            <div className="ctrl">
              <span className="label mono">底片数</span>
              <div className="seg">
                {[2, 3].map((n) => (
                  <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n as 2 | 3)} disabled={n === 3 && items.length < 3}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="ctrl grow">
              <span className="label mono">跳跃度 {Math.round(jump * 100)}%</span>
              <input type="range" min={0} max={1} step={0.05} value={jump} onChange={(e) => setJump(parseFloat(e.target.value))} aria-label="跳跃度" />
              <span className="range-ends mono">
                <span>相近</span>
                <span>八竿子打不着</span>
              </span>
            </label>
            <label className="ctrl grow">
              <span className="label mono">方向（可空）</span>
              <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例如：一首歌的 MV / 毕业作品 / 一条文案" maxLength={80} />
            </label>
            <button className="btn" onClick={shuffle}>
              {shown ? '重新抽底片' : '抽取底片'}
            </button>
          </div>

          {shown && (
            <div className="collide darkroom">
              <div className="darkroom-head mono">
                <span>▲ {shown.length === 3 ? 'TRIPLE' : 'DUAL'} EMULSION</span>
                <span>35MM NEGATIVE</span>
                <span>SAFELIGHT: 620NM</span>
              </div>
              <div className="negatives">
                {shown.map((it, i) => (
                  <div key={it.id} className="negative">
                    <ItemCard item={it} compact onOpen={openItem} />
                    <button className="swap mono" onClick={() => replaceOne(i)} disabled={busy}>
                      ↻ 换一张
                    </button>
                  </div>
                ))}
              </div>
              <div className="exposure mono">
                <span>
                  <i className="sq" /> EXPOSURE TIME
                </span>
                <span className="timer">{String(Math.floor(elapsed / 60000)).padStart(2, '0')}:{String(Math.floor((elapsed / 1000) % 60)).padStart(2, '0')}.{Math.floor((elapsed % 1000) / 100)}s</span>
              </div>
              <button className="develop-btn mono" onClick={() => develop(shown)} disabled={busy || shown.length < 2}>
                {busy ? <span className="develop-anim">[ 显影中 DEVELOPING… ]</span> : '[ 显影 COLLIDE & DEVELOP ]'}
              </button>
              {!aiReady(settings) && (
                <p className="hint">
                  还没配置 AI，现在是离线显影（基于斜策略的结构提示）。
                  <button className="link" onClick={() => go('settings')}>
                    去设置免费模型
                  </button>
                </p>
              )}
            </div>
          )}

          {busy && <div className="tray"><div className="tray-paper" /></div>}
          {result && <IdeaCard idea={result.idea} source={result.source} devId={result.id} />}
        </>
      )}

      {history && history.length > 0 && (
        <div className="history">
          <div className="history-head">
            <div className="kicker mono">显影记录 · {history.length}</div>
            <button className={`chip${showStarred ? ' on' : ''}`} onClick={() => setShowStarred((x) => !x)}>
              ★ 只看收藏
            </button>
          </div>
          {list.map((h) => (
            <HistoryRow key={h.id} dev={h} byId={byId} />
          ))}
        </div>
      )}
    </section>
  );
}

export function IdeaCard({ idea, source, devId }: { idea: Idea; source: 'ai' | 'offline'; devId?: number }) {
  const { toast } = useApp();
  const dev = useLiveQuery(() => (devId ? db.developments.get(devId) : undefined), [devId]);
  async function copy() {
    const t = `${idea.title}\n\n${idea.bridge}\n\n${idea.idea}${idea.form ? `\n\n形式：${idea.form}` : ''}${idea.firstStep ? `\n第一步：${idea.firstStep}` : ''}`;
    try {
      await navigator.clipboard.writeText(t);
      toast('已复制');
    } catch {
      toast('复制失败，请长按选择文字', 'err');
    }
  }
  return (
    <article className="idea">
      <div className="idea-meta mono">
        <span>[ 显影成果 · № DEV-{String(devId ?? 0).padStart(2, '0')} ]</span>
        <span className="idea-src">{source === 'ai' ? 'AI EMULSION' : 'OFFLINE'}</span>
      </div>
      <h2 className="idea-title">《{idea.title.replace(/^《|》$/g, '')}》</h2>
      {idea.form && <div className="idea-form mono">FORM · {idea.form}</div>}
      {idea.bridge && (
        <div className="idea-bridge">
          <div className="label mono red">THE CREATIVE BRIDGE // 灵感对撞</div>
          {idea.bridge}
        </div>
      )}
      <div className="label mono">CREATIVE DIRECTION // 创意</div>
      <p className="idea-body">{idea.idea}</p>
      {idea.firstStep && (
        <p className="idea-step">
          <span className="mono">第一步 →</span> {idea.firstStep}
        </p>
      )}
      {idea.oblique && <p className="idea-oblique mono">斜策略：{idea.oblique}</p>}
      {idea.cliches.length > 0 && (
        <div className="cliches">
          <div className="label mono red">⊘ BANNED CLICHÉS // 已禁用的套路</div>
          <ul>
            {idea.cliches.map((c, i) => (
              <li key={i}>
                <s>{c}</s>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        <button className="btn ghost small" onClick={copy}>
          复制
        </button>
        {devId && (
          <button className="btn ghost small" onClick={() => db.developments.update(devId, { starred: !dev?.starred })}>
            {dev?.starred ? '★ 已收藏' : '☆ 收藏'}
          </button>
        )}
      </div>
    </article>
  );
}

function HistoryRow({ dev, byId }: { dev: Development; byId: Map<number, Item> }) {
  const [open, setOpen] = useState(false);
  const { toast } = useApp();
  const names = dev.itemIds.map((id) => byId.get(id)?.title || '（已删除）');
  return (
    <div className="hrow">
      <button className="hrow-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="mono dim">{new Date(dev.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        <span className="hrow-title">
          {dev.starred ? '★ ' : ''}
          {dev.idea.title}
        </span>
        <span className="hrow-src dim">{names.join(' × ')}</span>
      </button>
      {open && (
        <div className="hrow-body">
          <IdeaCard idea={dev.idea} source={dev.source} devId={dev.id} />
          <button
            className="btn ghost small danger"
            onClick={async () => {
              if (confirm('删除这条显影记录？')) {
                await db.developments.delete(dev.id!);
                toast('已删除');
              }
            }}
          >
            删除记录
          </button>
        </div>
      )}
    </div>
  );
}
