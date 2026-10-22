import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { AsciiLoader, SeedBurst } from '../components/AsciiDevelop';
import { IdeaCard } from '../components/IdeaCard';
import { ItemCard } from '../components/ItemCard';
import { PageTitle } from '../components/PageTitle';
import { db } from '../lib/db';
import { developOffline, developWithAI } from '../lib/develop';
import { aiReady } from '../lib/settings';
import { daySeed, mulberry32, pickItems } from '../lib/similarity';
import { useApp } from '../lib/store';
import type { Development, Idea, Item } from '../lib/types';

const TASTE_KEY = 'lingan.taste.ai';

/** 嫁接：把两三穗相距很远的东西接在一起，长出一根新枝 */
export function Develop({ preset, clearPreset }: { preset: number[] | null; clearPreset: () => void }) {
  const { settings, toast, openItem, go } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const nBranches = useLiveQuery(() => db.developments.count(), []);
  const [count, setCount] = useState<2 | 3>(2);
  const [jump, setJump] = useState(0.8);
  const [theme, setTheme] = useState('');
  const [picked, setPicked] = useState<Item[] | null>(null);
  const [result, setResult] = useState<{ idea: Idea; source: 'ai' | 'offline'; id?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);

  const byId = useMemo(() => new Map((items || []).map((i) => [i.id!, i])), [items]);

  // 今日两穗：一整天都是同一对
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

  // 被编辑 / 删除时保持同步
  useEffect(() => {
    if (picked && items) {
      const fresh = picked.map((p) => byId.get(p.id!)).filter(Boolean) as Item[];
      if (fresh.length !== picked.length || fresh.some((f, i) => f !== picked[i])) setPicked(fresh.length ? fresh : null);
    }
  }, [items, byId, picked]);

  if (!items) return <AsciiLoader />;

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
      toast((e instanceof Error ? e.message : String(e)) + '，已改用离线嫁接', 'err');
      idea = developOffline(sel, { theme: theme.trim() || undefined });
    }
    const dev: Development = { itemIds: sel.map((s) => s.id!), theme: theme.trim() || undefined, jump, idea, source, createdAt: Date.now() };
    const id = await db.developments.add(dev);
    setResult({ idea, source, id });
    setBusy(false);
  }

  const shown = picked || null;

  return (
    <section className="view">
      <PageTitle title="嫁接" whisper="Graft two far-apart things, see what grows" />

      {items.length < 2 ? (
        <div className="paper empty">
          <h2>穗还不够</h2>
          <p>至少要拾 2 穗，才能嫁接。</p>
          <button className="btn primary" onClick={() => go('library')}>
            去拾穗
          </button>
        </div>
      ) : (
        <>
          {!shown && daily && (
            <div className="paper daily">
              <div className="kicker">今日两穗 · {new Date().getMonth() + 1}月{new Date().getDate()}日</div>
              <div className="pair">
                {daily.map((it, i) => [
                  i > 0 && (
                    <span key={'x' + i} className="pair-x" aria-hidden>
                      ×
                    </span>
                  ),
                  <div key={it.id} className="pair-item">
                    <ItemCard item={it} compact onOpen={openItem} />
                  </div>,
                ])}
              </div>
              <div className="actions">
                <button
                  className="btn primary"
                  onClick={() => {
                    setPicked(daily);
                    develop(daily);
                  }}
                  disabled={busy}
                >
                  嫁接今日两穗
                </button>
              </div>
            </div>
          )}

          <div className="paper controls">
            <div className="ctrl">
              <span className="label">几穗</span>
              <div className="seg">
                {[2, 3].map((n) => (
                  <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n as 2 | 3)} disabled={n === 3 && items.length < 3}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="ctrl grow">
              <span className="label">跳跃度 {Math.round(jump * 100)}%</span>
              <input type="range" min={0} max={1} step={0.05} value={jump} onChange={(e) => setJump(parseFloat(e.target.value))} aria-label="跳跃度" />
              <span className="range-ends">
                <span>相近</span>
                <span>八竿子打不着</span>
              </span>
            </label>
            <label className="ctrl grow">
              <span className="label">往哪个方向长（可空）</span>
              <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例如：一首歌的 MV / 毕业作品 / 一条文案" maxLength={80} />
            </label>
            <button className="btn" onClick={shuffle}>
              {shown ? '重新抽穗' : '抽几穗'}
            </button>
          </div>

          {shown && (
            <div className="paper graft">
              <div className="kicker">要接在一起的 {shown.length} 穗</div>
              <div className="pair">
                {shown.map((it, i) => [
                  i > 0 && (
                    <span key={'x' + i} className="pair-x" aria-hidden>
                      ×
                    </span>
                  ),
                  <div key={it.id} className="pair-item">
                    <ItemCard item={it} compact onOpen={openItem} />
                    <button className="swap" onClick={() => replaceOne(i)} disabled={busy}>
                      ↻ 换一穗
                    </button>
                  </div>,
                ])}
              </div>
              <div className="graft-wrap">
                <button
                  className="btn primary big graft-btn"
                  onClick={() => {
                    setBurst(Date.now());
                    develop(shown);
                  }}
                  disabled={busy || shown.length < 2}
                >
                  {busy ? '正在嫁接…' : '嫁接'}
                </button>
                {burst > 0 && <SeedBurst key={burst} />}
              </div>
              {!aiReady(settings) && (
                <p className="hint">
                  还没配置 AI，现在是离线嫁接（用斜策略给出结构提示）。
                  <button className="link" onClick={() => go('settings')}>
                    去设置免费模型
                  </button>
                </p>
              )}
            </div>
          )}

          {busy && <AsciiLoader text="新枝正在长" />}
          {result && <IdeaCard key={result.id} animate idea={result.idea} source={result.source} devId={result.id} />}
          {result && (
            <p className="after-note">
              已留在新枝里{nBranches ? `（共 ${nBranches} 根）` : ''}。
              <button className="link" onClick={() => go('branches')}>
                去看看
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
