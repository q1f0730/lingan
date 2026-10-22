import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AsciiLoader, SeedBurst } from '../components/AsciiDevelop';
import { GraftGrowing } from '../components/GraftGrowing';
import { GraftTrail, IdeaCard } from '../components/IdeaCard';
import { ItemCard } from '../components/ItemCard';
import { PageTitle } from '../components/PageTitle';
import { db } from '../lib/db';
import { graftOffline, graftWithAI, type GraftProgress, type GraftResult } from '../lib/graft';
import { aiReady } from '../lib/settings';
import { daySeed, mulberry32, pickItems } from '../lib/similarity';
import { useApp } from '../lib/store';
import type { Development, GraftBatch, Item } from '../lib/types';

const TASTE_KEY = 'lingan.taste.ai';

/** 嫁接：把两三穗相距很远的东西接在一起，长出一根新枝 */
export function Develop({ preset, clearPreset }: { preset: number[] | null; clearPreset: () => void }) {
  const { settings, toast, openItem, go } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const nBranches = useLiveQuery(() => db.developments.count(), []);
  const [count, setCount] = useState<2 | 3 | 4>(2);
  const [jump, setJump] = useState(0.8);
  const [theme, setTheme] = useState('');
  const [picked, setPicked] = useState<Item[] | null>(null);
  const [result, setResult] = useState<{ run: GraftResult; ids: number[]; batch: GraftBatch; names: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GraftProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
        setCount(full.length >= 4 ? 4 : full.length >= 3 ? 3 : 2);
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
    if (sel.length < 2 || busy) return;
    setBusy(true);
    setResult(null);
    setProgress({ stage: 'map' });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const th = theme.trim() || undefined;
    const quiet = document.documentElement.dataset.motion === 'off';
    const wait = (ms: number) => new Promise((r) => setTimeout(r, quiet ? 0 : ms));
    let run: GraftResult;
    try {
      if (aiReady(settings)) {
        run = await graftWithAI(settings, sel, { theme: th, taste: localStorage.getItem(TASTE_KEY) || undefined, signal: ctrl.signal, onProgress: setProgress });
        if (run.partial) toast('第二步没跑完，用第一步的种子直接收拢了三根', 'err');
      } else {
        // 离线也走四步；给麦子一点点长的时间（减少动态效果时不等）
        run = graftOffline(sel, { theme: th });
        await wait(700);
        if (ctrl.signal.aborted) throw new Error('已取消');
        setProgress({ stage: 'defix' });
        await wait(700);
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        setBusy(false);
        setProgress(null);
        toast('停下了，这次没有嫁接');
        return;
      }
      toast((e instanceof Error ? e.message : String(e)) + '，已改用离线嫁接', 'err');
      run = graftOffline(sel, { theme: th });
    }
    if (ctrl.signal.aborted) {
      setBusy(false);
      setProgress(null);
      return;
    }
    const now = Date.now();
    const bid = `g${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const size = run.branches.length;
    const devs: Development[] = run.branches.map((idea, index) => ({
      itemIds: sel.map((s) => s.id!),
      theme: th,
      jump,
      idea,
      source: run.source,
      batch: index === 0 ? { id: bid, index, size, tensions: run.tensions, seeds: run.seeds, pattern: run.pattern, calls: run.calls } : { id: bid, index, size },
      createdAt: now + index,
    }));
    const ids = (await db.developments.bulkAdd(devs, { allKeys: true })) as number[];
    setResult({ run, ids, batch: devs[0].batch!, names: sel.map((s) => s.title) });
    setProgress(null);
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
                {[2, 3, 4].map((n) => (
                  <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n as 2 | 3 | 4)} disabled={items.length < n}>
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
                  {busy ? '正在嫁接…' : '嫁接 · 长三根'}
                </button>
                {burst > 0 && <SeedBurst key={burst} />}
              </div>
              {!aiReady(settings) && (
                <p className="hint">
                  还没配置 AI，现在是离线嫁接：同样四步、同样三根，用八种变形法和斜策略给出结构提示。
                  <button className="link" onClick={() => go('settings')}>
                    去设置免费模型
                  </button>
                </p>
              )}
            </div>
          )}

          {busy && progress && <GraftGrowing stage={progress.stage} retry={progress.retry} onCancel={() => abortRef.current?.abort()} />}
          {result && (
            <>
              <div className="three-head">
                <span className="kicker">一次三枝 · {result.run.source === 'ai' ? 'AI 嫁接' : '离线嫁接'}</span>
                <span className="three-sub">三根新枝，变形法各不相同。挑一根，今天就动手。</span>
              </div>
              <div className="three">
                {result.run.branches.map((b, i) => (
                  <IdeaCard key={result.ids[i]} animate idea={b} source={result.run.source} devId={result.ids[i]} index={i} hideCliches />
                ))}
              </div>
              {result.run.branches[0]?.cliches.length > 0 && (
                <div className="paper cliches-row">
                  <span className="label">剪掉的旧枝（三根都避开的套路）</span>
                  <div className="tags">
                    {result.run.branches[0].cliches.map((c, i) => (
                      <s key={i} className="tag">
                        {c}
                      </s>
                    ))}
                  </div>
                </div>
              )}
              <GraftTrail batch={result.batch} names={result.names} />
              <p className="after-note">
                三根都留在新枝里{nBranches ? `（共 ${nBranches} 根）` : ''}。
                <button className="link" onClick={() => go('branches')}>
                  去看看
                </button>
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
