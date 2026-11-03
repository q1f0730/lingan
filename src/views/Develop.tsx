import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DisplayTitle, Loading } from '../components/DisplayTitle';
import { GraftGrowing } from '../components/GraftGrowing';
import { GraftTrail, IdeaCard } from '../components/IdeaCard';
import { db, depositCliches, markBlocked, markGrafted } from '../lib/db';
import { graftOffline, graftWithAI, type GraftProgress, type GraftResult } from '../lib/graft';
import { drawForMode, graftCount, isMode, MIN_CROSS_TYPES, MODES, modeDef, modeName, type GraftMode } from '../lib/modes';
import { MIN_EVIDENCE } from '../lib/provenance';
import { aiReady } from '../lib/settings';
import { daySeed, mulberry32, pickItems } from '../lib/similarity';
import { useApp } from '../lib/store';
import { TYPE_LABEL, type Development, type GraftBatch, type Item } from '../lib/types';
import { displayTitle, nn, shortDate } from '../lib/studio';

const TASTE_KEY = 'lingan.taste.ai';
const MODE_KEY = 'glean.graft.mode';

function savedMode(): GraftMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (isMode(v)) return v;
  } catch {
    /* 隐私模式 */
  }
  return 'far';
}

/** 嫁接：把几穗相距很远的东西接在一起，一次长三根新枝。v0.12 起至少 3 穗，好让每根新枝都能点回 3 穗。 */
export function Develop({ preset, clearPreset }: { preset: number[] | null; clearPreset: () => void }) {
  const { settings, toast, openItem, go, desktop } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const nBranches = useLiveQuery(() => db.developments.count(), []);
  // v0.19 我的套路墙：每次嫁接都带上（写进 FORBIDDEN + 生成后本地校验）
  const wall = useLiveQuery(() => db.cliches.toArray(), []);
  const [count, setCount] = useState<3 | 4 | 5>(3);
  const [mode, setModeState] = useState<GraftMode>(savedMode);
  /** 当前这组穗是按哪种接法抽的；从每日一穗 / 详情带进来的是 null（不按接法） */
  const [pickedBy, setPickedBy] = useState<GraftMode | null>(null);
  const [drawNote, setDrawNote] = useState<string | undefined>();
  const jump = modeDef(mode)?.jump ?? 0.8;
  const [theme, setTheme] = useState('');
  const [picked, setPicked] = useState<Item[] | null>(null);
  const [result, setResult] = useState<{ run: GraftResult; ids: number[]; batch: GraftBatch; names: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GraftProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const byId = useMemo(() => new Map((items || []).map((i) => [i.id!, i])), [items]);

  // 今日三穗：一整天都是同一组
  const daily = useMemo(() => {
    if (!items || items.length < MIN_EVIDENCE) return null;
    return pickItems(items, MIN_EVIDENCE, 0.9, mulberry32(daySeed()));
  }, [items]);

  useEffect(() => {
    if (preset && items) {
      const sel = preset.map((id) => byId.get(id)).filter(Boolean) as Item[];
      if (sel.length) {
        let full = sel;
        if (sel.length < MIN_EVIDENCE) {
          // 从一穗出发：再抽几穗凑够 3 穗（尽量远一点）
          const rest = items.filter((i) => !sel.includes(i));
          const extra = drawForMode(mode, items, MIN_EVIDENCE, { keep: sel }).items.filter((x) => !sel.includes(x));
          full = [...sel, ...extra.slice(0, MIN_EVIDENCE - sel.length)];
          if (full.length < MIN_EVIDENCE) full = [...full, ...rest.filter((x) => !full.includes(x)).slice(0, MIN_EVIDENCE - full.length)];
        }
        setCount(full.length >= 5 ? 5 : full.length >= 4 ? 4 : 3);
        setPicked(full);
        setPickedBy(null);
        setDrawNote(undefined);
        setResult(null);
      }
      clearPreset();
    }
  }, [preset, items, byId, clearPreset, mode]);

  // 被编辑 / 删除时保持同步
  useEffect(() => {
    if (picked && items) {
      const fresh = picked.map((p) => byId.get(p.id!)).filter(Boolean) as Item[];
      if (fresh.length !== picked.length || fresh.some((f, i) => f !== picked[i])) setPicked(fresh.length ? fresh : null);
    }
  }, [items, byId, picked]);

  // 手机上嫁接区在已选列表下面：开始嫁接 / 长好了时把它带进视野
  useEffect(() => {
    if (desktop || (!busy && !result)) return;
    const el = document.querySelector(result ? '.three-head' : '.graft-main');
    el?.scrollIntoView({ block: 'start', behavior: document.documentElement.dataset.motion === 'off' ? 'auto' : 'smooth' });
  }, [busy, result, desktop]);

  if (!items) return <Loading />;

  /** 按接法抽穗（v0.18：抽样规则见 lib/modes.ts） */
  function draw(m: GraftMode, n: number = count) {
    if (!items || items.length < MIN_EVIDENCE) return;
    const r = drawForMode(m, items, n);
    setPicked(r.items);
    setPickedBy(m);
    setDrawNote(r.note);
    setResult(null);
  }

  function shuffle() {
    draw(mode);
  }

  function chooseMode(m: GraftMode) {
    if (busy) return;
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* 隐私模式 */
    }
    // 换接法就按它重新抽一组（几穗沿用当前这组的数量）
    draw(m, picked ? (Math.min(5, Math.max(3, picked.length)) as 3 | 4 | 5) : count);
  }

  function replaceOne(idx: number) {
    if (!items || !picked) return;
    const others = picked.filter((_, i) => i !== idx);
    const pool = items.filter((i) => !picked.includes(i));
    if (!pool.length) return;
    const by = pickedBy || mode;
    const next = drawForMode(by, items, picked.length, { keep: others, exclude: [picked[idx].id!] }).items.find((x) => !others.includes(x)) || pool[Math.floor(Math.random() * pool.length)];
    const arr = [...picked];
    arr[idx] = next;
    setPicked(arr);
    setResult(null);
  }

  async function develop(sel: Item[]) {
    if (sel.length < Math.min(MIN_EVIDENCE, items?.length ?? 0) || sel.length < 2 || busy) return;
    setBusy(true);
    setResult(null);
    setProgress({ stage: 'map' });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const th = theme.trim() || undefined;
    // 只有按接法抽出来的这组才带接法；从每日一穗 / 详情带来的保持原样
    const gm = sel === picked && pickedBy ? pickedBy : undefined;
    const quiet = document.documentElement.dataset.motion === 'off';
    const wallNow = wall || (await db.cliches.toArray());
    const wait = (ms: number) => new Promise((r) => setTimeout(r, quiet ? 0 : ms));
    let run: GraftResult;
    try {
      if (aiReady(settings)) {
        run = await graftWithAI(settings, sel, { theme: th, mode: gm, wall: wallNow, taste: localStorage.getItem(TASTE_KEY) || undefined, signal: ctrl.signal, onProgress: setProgress });
        if (run.partial) toast('第二步没跑完，用第一步的种子直接收拢了三根', 'err');
        else if (run.weak) toast(`有 ${run.weak} 根说不清从哪几穗长出来，标了「证据不足」`, 'err');
        else if (run.wall?.hit) toast(wallToast(run));
      } else {
        // 离线也走四步；给麦子一点点长的时间（减少动态效果时不等）
        run = graftOffline(sel, { theme: th, mode: gm, wall: wallNow });
        if (run.wall?.hit) toast(wallToast(run));
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
      run = graftOffline(sel, { theme: th, mode: gm, wall: wallNow });
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
      jump: modeDef(gm)?.jump ?? jump,
      ...(gm ? { mode: gm } : {}),
      idea,
      source: run.source,
      evidence: idea.evidence || 'ok',
      batch: index === 0 ? { id: bid, index, size, tensions: run.tensions, seeds: run.seeds, pattern: run.pattern, calls: run.calls } : { id: bid, index, size },
      createdAt: now + index,
    }));
    const ids = (await db.developments.bulkAdd(devs, { allKeys: true })) as number[];
    // v0.18 记下这几穗又被嫁接了一次（次数 +1、最后时间）
    await markGrafted(sel.map((x) => x.id!), db, now).catch(() => {});
    // v0.19 这次模型列出的套路沉淀上墙；被本地校验拦下的给墙上记一次
    await depositCliches(run.cliches || run.branches[0]?.cliches, db, now).catch(() => {});
    if (run.wall?.keys.length) await markBlocked(run.wall.keys, db).catch(() => {});
    setResult({ run, ids, batch: devs[0].batch!, names: sel.map((s) => s.title) });
    setProgress(null);
    setBusy(false);
  }

  const shown = picked || null;
  const again = () => shown && develop(shown);

  return (
    <section className="view develop">
      <DisplayTitle title={busy ? '嫁接中' : '嫁接'} count={shown ? shown.length : undefined} sub={shown ? `已选 ${shown.length} 穗，一次长三根新枝。` : '选 3 到 5 穗，再选一种接法。'} />

      {items.length < MIN_EVIDENCE ? (
        <div className="empty">
          <h2 className="lead">穗还不够</h2>
          <p className="meta-text">至少要拾 {MIN_EVIDENCE} 穗，才能嫁接：每根新枝都要能说出它是从哪 {MIN_EVIDENCE} 穗长出来的。</p>
          <button className="btn primary" onClick={() => go('library')}>
            去拾穗
          </button>
        </div>
      ) : (
        <div className={`graft-layout${result || busy ? ' has-result' : ''}`}>
          <div className="graft-side">
            {!shown && daily && (
              <section className="daily">
                <div className="label">今日三穗 · {String(new Date().getMonth() + 1).padStart(2, '0')}/{String(new Date().getDate()).padStart(2, '0')}</div>
                <PickTable items={daily} onOpen={openItem} />
                <div className="actions">
                  <button
                    className="btn primary"
                    onClick={() => {
                      setPicked(daily);
                      setPickedBy(null);
                      setDrawNote(undefined);
                      develop(daily);
                    }}
                    disabled={busy}
                  >
                    嫁接今日三穗
                  </button>
                </div>
              </section>
            )}

            {!shown && <ModePicker mode={mode} onPick={chooseMode} disabled={busy} items={items} picked={null} pickedBy={null} note={drawNote} />}

            {shown && (
              <section className="graft">
                <div className="label">已选 ({shown.length}) · 最多 5</div>
                <PickTable items={shown} onOpen={openItem} onSwap={busy ? undefined : replaceOne} showCount={pickedBy === 'neglected'} />
                <ModePicker mode={mode} onPick={chooseMode} disabled={busy} items={items} picked={shown} pickedBy={pickedBy} note={drawNote} />
                <div className="graft-wrap">
                  <button className="btn primary graft-btn rw-shimmer" onClick={() => develop(shown)} disabled={busy || shown.length < Math.min(MIN_EVIDENCE, items.length)}>
                    {busy ? '正在嫁接…' : pickedBy ? `按「${modeName(pickedBy)}」嫁接这 ${shown.length} 穗` : `嫁接这 ${shown.length} 穗`}
                  </button>
                </div>
                {!aiReady(settings) && (
                  <p className="hint meta-text">
                    还没配置 AI，现在是离线嫁接：同样四步、同样三根，用八种变形法和斜策略给出结构提示。{' '}
                    <button className="linklike" onClick={() => go('settings')}>
                      去设置免费模型
                    </button>
                  </p>
                )}
              </section>
            )}

          </div>

          <div className="graft-main">
            {busy && progress && <GraftGrowing stage={progress.stage} retry={progress.retry} recheck={progress.recheck} wall={progress.wall} onCancel={() => abortRef.current?.abort()} />}
            {result && (
              <>
                <div className="three-head">
                  <span className="label">
                    一次三枝{result.run.mode ? <span className="three-mode"> · {modeName(result.run.mode)}</span> : null} · {result.run.source === 'ai' ? 'AI 嫁接' : '离线嫁接'}
                  </span>
                  <span className="three-sub meta-text">三根新枝，变形法各不相同，每根都能点回它的穗。挑一根，今天就动手。</span>
                </div>
                <div className="three">
                  {result.run.branches.map((b, i) => (
                    <IdeaCard key={result.ids[i]} animate idea={b} source={result.run.source} devId={result.ids[i]} index={i} hideCliches onAgain={again} />
                  ))}
                </div>
                {result.run.branches[0]?.cliches.length > 0 && (
                  <div className="cliches-row">
                    <span className="label">剪掉的旧枝 · 已上套路墙</span>
                    <span className="cliche-list">
                      {result.run.branches[0].cliches.map((c, i) => (
                        <s key={i}>{c}</s>
                      ))}
                    </span>
                    <button className="btn text faint wall-go" onClick={() => go('taste')}>
                      套路墙{wall ? ` (${wall.filter((c) => !c.struck).length})` : ''}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
            <section className="controls">
            <div className="ctrl">
              <span className="label">几穗</span>
              <div className="seg">
                {[3, 4, 5].map((n) => (
                  <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n as 3 | 4 | 5)} disabled={items.length < n}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="ctrl grow">
              <span className="label">往哪个方向长（可空）</span>
              <input className="line-input" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例如：一首歌的 MV / 毕业作品 / 一条文案" maxLength={80} />
            </label>
            <button className="btn text strong shuffle" onClick={shuffle}>
              {shown ? `按「${modeName(mode)}」重新抽` : '抽几穗'}
            </button>
          </section>
        </div>
      )}
      {result && <GraftTrail batch={result.batch} names={result.names} />}
      {result && (
        <p className="after-note meta-text">
          三根都留在新枝里{nBranches ? `（共 ${nBranches} 根）` : ''}。{' '}
          <button className="linklike" onClick={() => go('branches')}>
            去看看
          </button>
        </p>
      )}
    </section>
  );
}

/** v0.19 撞墙提示：怎么处理的 */
function wallToast(run: GraftResult): string {
  const w = run.wall!;
  const how = [w.replaced ? `换掉 ${w.replaced} 根` : '', w.scrubbed ? `删掉撞墙的字 ${w.scrubbed} 根` : ''].filter(Boolean).join('、');
  return `有 ${w.hit} 根撞了套路墙，${w.retried ? (how ? `重写一次后又${how}` : '已重写') : how || '已处理'}`;
}

/** 已选的穗：无线表格，细体序号 + 标题 + 类型 + 日期（+ 换一穗） */
function PickTable({ items, onOpen, onSwap, showCount }: { items: Item[]; onOpen: (i: Item) => void; onSwap?: (i: number) => void; showCount?: boolean }) {
  return (
    <div className="table pick-table">
      <div className="thead" aria-hidden>
        <span className="tc tc-n" />
        <span className="tc tc-title">穗</span>
        <span className="tc tc-type">类型</span>
        <span className="tc tc-date">日期</span>
      </div>
      {items.map((it, i) => (
        <div key={it.id} className="trow pair-item" data-item-id={it.id}>
          <span className="tc tc-n numeral small">{nn(i)}</span>
          <button className="tc tc-title linklike" onClick={() => onOpen(it)}>
            <span className="card-title">{displayTitle(it)}</span>
            {showCount && <span className="pick-count meta-text">{graftCount(it) ? `接过 ${graftCount(it)} 次` : '没接过'}</span>}
          </button>
          <span className="tc tc-type">{TYPE_LABEL[it.type]}</span>
          <span className="tc tc-date num">
            {onSwap ? (
              <button className="btn text faint swap" onClick={() => onSwap(i)}>
                换一穗
              </button>
            ) : (
              shortDate(it.createdAt)
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** v0.18 五种接法：纯文字切换（无图标），选中的字黑、加粗；下面一行写清怎么抽 */
function ModePicker({
  mode,
  onPick,
  disabled,
  items,
  picked,
  pickedBy,
  note,
}: {
  mode: GraftMode;
  onPick: (m: GraftMode) => void;
  disabled?: boolean;
  items: Item[];
  picked: Item[] | null;
  pickedBy: GraftMode | null;
  note?: string;
}) {
  const def = modeDef(mode)!;
  const libTypes = new Set(items.map((i) => i.type)).size;
  const groupTypes = picked ? new Set(picked.map((i) => i.type)).size : 0;
  let warn = note;
  if (!warn && mode === 'cross' && libTypes < MIN_CROSS_TYPES) warn = `穗仓里只有 ${libTypes} 种类型，跨媒介至少要 ${MIN_CROSS_TYPES} 种：去拾点别的类型再试。`;
  if (!warn && mode === 'cross' && picked && pickedBy !== 'cross' && groupTypes < MIN_CROSS_TYPES && libTypes >= MIN_CROSS_TYPES) warn = `这一组只有 ${groupTypes} 种类型，点「跨媒介」会按至少 ${MIN_CROSS_TYPES} 种重新抽。`;
  return (
    <section className="modes" data-mode={mode}>
      <div className="label">接法</div>
      <div className="mode-list" role="radiogroup" aria-label="接法">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={m.id === mode} className={`mode${m.id === mode ? ' on' : ''}`} data-mode={m.id} onClick={() => onPick(m.id)} disabled={disabled}>
            <span className="mode-name">{m.name}</span>
            <span className="mode-note">{m.note}</span>
          </button>
        ))}
      </div>
      <p className="mode-rule meta-text">
        <span className="mode-rule-k">怎么抽</span>
        {def.rule}
      </p>
      {picked && !pickedBy && <p className="mode-from meta-text">这几穗是带进来的，没按接法抽；点一种接法会按它重新抽。</p>}
      {warn && <p className="mode-warn">{warn}</p>}
    </section>
  );
}
