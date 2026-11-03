// v0.29 B2 创作产出：作品工坊（0301–0309、0314、0322、0339、0340）。整页懒加载，首屏不带。
import { useLiveQuery } from 'dexie-react-hooks';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DisplayTitle, Loading } from '../components/DisplayTitle';
import { Sheet } from '../components/Sheet';
import { FormPicker } from '../components/FormPicker';
import { db } from '../lib/db';
import { itemHasImage } from '../lib/imagestore';
import { matchItem, shortDate } from '../lib/studio';
import { useApp } from '../lib/store';
import { TYPE_LABEL, type Item, type Work, type WorkForm, type WorkShot, type WorkStage, type WorkTodo, type WorkTrack } from '../lib/types';
import { useThumbSrc } from '../lib/useImage';
import { enforcedKeys, findHits } from '../lib/wall';
import { addMaterial, createWork, itemsByUids, libraryMusic, removeMaterial, trashWork, untrashWork, updateWork } from '../lib/workstore';
import {
  buildPlaylist,
  FOCUS_WORK_KEY,
  FORMS,
  fmtSec,
  applyDisplayEdit,
  dispToMd,
  insertRef,
  mdToDisp,
  mdBlocks,
  newShot,
  PANEL_LABEL,
  pendingRef,
  playlistText,
  refLayout,
  refToken,
  refUids,
  snapCaret,
  reviewCheck,
  safeFileName,
  SHOT_SIZES,
  shotCheck,
  sizeGlyph,
  STAGE_LABEL,
  STAGE_ORDER,
  wordCount,
  workMarkdown,
  type Block,
  type Inline,
  type RefLayout,
  type WorkPanel,
} from '../lib/works';

const Board = lazy(() => import('../components/WorkBoard'));

const rid = () => Math.random().toString(36).slice(2, 10);

/** 本地编辑、停手 400ms 再写库（打字不每个键都写 IndexedDB）；卸载时补写 */
function usePersist<T>(initial: T, save: (v: T) => void, delay = 400): [T, (v: T) => void] {
  const [v, setV] = useState(initial);
  const pending = useRef<{ t: number; v: T } | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      if (pending.current) clearTimeout(pending.current.t);
      pending.current = { v: nv, t: window.setTimeout(() => {
        pending.current = null;
        saveRef.current(nv);
      }, delay) };
    },
    [delay],
  );
  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current.t);
        saveRef.current(pending.current.v);
      }
    },
    [],
  );
  return [v, set];
}

function download(name: string, text: string, mime = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Thumb({ it, className = 'wk-thumb' }: { it: Item; className?: string }) {
  const src = useThumbSrc(it);
  return (
    <span className={className} aria-hidden>
      {src ? <img src={src} alt="" decoding="async" /> : <span className="wk-glyph">{TYPE_LABEL[it.type].slice(0, 1)}</span>}
    </span>
  );
}

export function Works() {
  const { go, toast } = useApp();
  const works = useLiveQuery(() => db.works.orderBy('updatedAt').reverse().toArray().then((a) => a.filter((x) => !x.deletedAt)), []);
  const [openId, setOpenId] = useState<number | null>(() => {
    try {
      // 只读不删：首次挂载要是被懒加载的子块挂起（慢机器上分镜 / 情绪板的包还没到），React 会丢掉这次的 state 重来，
      // 在这里删掉的话重来时就读不到了（立项后停在作品列表）。提交之后再删（下面的 effect）
      const v = sessionStorage.getItem(FOCUS_WORK_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem(FOCUS_WORK_KEY);
    } catch {
      /* ignore */
    }
  }, []);
  const [stage, setStage] = useState<WorkStage | 'all'>('all');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (openId != null) window.scrollTo(0, 0);
  }, [openId]);
  if (!works) return <Loading />;
  const open = openId != null ? works.find((w) => w.id === openId) : undefined;
  if (open) return <Workspace key={open.id} work={open} onBack={() => setOpenId(null)} />;
  const count = (s: WorkStage) => works.filter((w) => w.stage === s).length;
  const shown = stage === 'all' ? works : works.filter((w) => w.stage === stage);
  const blank = async (f: WorkForm) => {
    setBusy(true);
    try {
      const id = await createWork(f);
      setPicking(false);
      setOpenId(id);
      toast(`新建了一件${FORMS[f].label}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="view works">
      <DisplayTitle
        title="作品"
        count={works.length}
        sub={works.length ? STAGE_ORDER.map((s) => `${STAGE_LABEL[s]} ${count(s)}`).join(' · ') : '新枝立项后在这里写成东西'}
        aside={
          <button className="btn text strong work-new" onClick={() => setPicking((x) => !x)} aria-expanded={picking}>
            {picking ? '收起' : '空白作品'}
          </button>
        }
      />
      {picking && (
        <div className="work-pick-blank">
          <p className="meta-text">不从新枝出发，直接开一件。素材之后再从穗仓里加。</p>
          <FormPicker onPick={(f) => void blank(f)} busy={busy} />
        </div>
      )}
      {works.length === 0 ? (
        <div className="empty">
          <h2 className="lead">还没有作品</h2>
          <p className="meta-text">在任意一根新枝下点「立项」，选个形态（短篇、短片、歌单、影评、海报、播客），它就有了自己的工作区。</p>
          <button className="btn primary" onClick={() => go('branches')}>
            去新枝立项
          </button>
        </div>
      ) : (
        <>
          <div className="filters chips filter-row">
            <button className={`chip${stage === 'all' ? ' on' : ''}`} onClick={() => setStage('all')}>
              全部 <span className="n">({works.length})</span>
            </button>
            {STAGE_ORDER.map((s) => (
              <button key={s} className={`chip${stage === s ? ' on' : ''}`} onClick={() => setStage(s)}>
                {STAGE_LABEL[s]} <span className="n">({count(s)})</span>
              </button>
            ))}
          </div>
          <ol className="work-list">
            {shown.map((w) => (
              <li key={w.id}>
                <button className="work-row" onClick={() => setOpenId(w.id!)} data-work-id={w.id}>
                  <span className="work-row-form label">{FORMS[w.form]?.label || w.form}</span>
                  <span className="work-row-title">{w.title}</span>
                  <span className="work-row-meta meta-text">
                    {STAGE_LABEL[w.stage]} · {w.itemUids.length} 穗素材 · {w.todos.filter((t) => t.done).length}/{w.todos.length} 待办
                  </span>
                  <span className="work-row-when num">{shortDate(w.updatedAt || w.createdAt)}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="empty small meta-text">这一栏还没有作品。</li>}
          </ol>
        </>
      )}
    </section>
  );
}

// ───────────────────────── 工作区 ─────────────────────────

function Workspace({ work, onBack }: { work: Work; onBack: () => void }) {
  const { toast, confirm, desktop, openItem } = useApp();
  const panels = FORMS[work.form]?.panels || ['draft'];
  const [tab, setTab] = useState<WorkPanel | 'mats'>(panels[0]);
  const mats = useLiveQuery(() => itemsByUids(work.itemUids), [work.itemUids.join(',')]);
  const devTitles = useLiveQuery(async () => (work.devUids.length ? (await db.developments.where('uid').anyOf(work.devUids).toArray()).map((d) => d.idea.title) : []), [work.devUids.join(',')]);
  const save = useCallback((ch: Partial<Work>) => void updateWork(work.id!, ch), [work.id]);
  const [title, setTitle] = usePersist(work.title, (v) => save({ title: v.trim() || '无题作品' }));
  const draftApi = useRef<{ insert: (token: string) => void } | null>(null);

  const byUidAll = useCallback(async () => {
    const uids = new Set<string>([...work.itemUids, ...refUids(work.draft), ...(work.tracks || []).map((t) => t.uid), ...(work.shots || []).map((s) => s.frameUid || '').filter(Boolean)]);
    const rows = await itemsByUids([...uids]);
    return new Map(rows.map((x) => [x.uid!, x]));
  }, [work]);
  async function copyMd() {
    const md = workMarkdown(work, await byUidAll(), devTitles || []);
    try {
      await navigator.clipboard.writeText(md);
      toast('已复制成 Markdown（含溯源）');
    } catch {
      toast('复制失败：用「导出 .md」', 'err');
    }
  }
  async function exportMd() {
    download(`${safeFileName(work.title)}.md`, workMarkdown(work, await byUidAll(), devTitles || []));
  }
  async function drop() {
    const ok = await confirm({ title: `删掉《${work.title}》？`, body: '作品会被移除（素材穗不受影响）。', ok: '删掉', danger: true });
    if (!ok) return;
    await trashWork(work.id!);
    onBack();
    toast('作品已删', 'ok', { label: '撤销', run: () => void untrashWork(work.id!) });
  }
  const addMat = async (it: Item) => {
    if (!it.uid) return;
    const added = await addMaterial(work.id!, it.uid);
    toast(added ? `加进素材：${it.title}` : '已经在素材里了');
  };
  const quote = (it: Item) => {
    if (!it.uid) return;
    if (tab !== 'draft') setTab('draft');
    setTimeout(() => draftApi.current?.insert(refToken(it)), tab === 'draft' ? 0 : 60);
  };

  const tabs: Array<WorkPanel | 'mats'> = desktop ? panels : [...panels, 'mats'];
  const matsCol = <Materials work={work} mats={mats} onAdd={addMat} onRemove={(it) => void removeMaterial(work.id!, it.uid!)} onQuote={quote} onOpen={openItem} canQuote={panels.includes('draft')} />;
  return (
    <section className="view works work-space" data-form={work.form}>
      <div className="work-top">
        <button className="btn text work-back" onClick={onBack}>
          ← 作品
        </button>
        <span className="label work-kicker">
          {FORMS[work.form]?.label} · 立于 {shortDate(work.createdAt)}
          {devTitles?.length ? ` · 来自新枝《${devTitles[0].replace(/^《|》$/g, '')}》` : ''}
        </span>
      </div>
      <input className="work-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="作品名" maxLength={60} />
      <div className="work-bar">
        <div className="chips work-stage" role="radiogroup" aria-label="进度">
          {STAGE_ORDER.map((s) => (
            <button key={s} role="radio" aria-checked={work.stage === s} className={`chip${work.stage === s ? ' on' : ''}`} onClick={() => save({ stage: s })}>
              {STAGE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="text-actions actions work-acts">
          <button className="btn text work-copy" onClick={() => void copyMd()}>
            复制 Markdown
          </button>
          <button className="btn text work-export" onClick={() => void exportMd()}>
            导出 .md
          </button>
          <button className="btn text faint danger work-drop" onClick={() => void drop()}>
            删除
          </button>
        </div>
      </div>
      <Todos todos={work.todos} onChange={(todos) => save({ todos })} />
      {tabs.length > 1 && (
      <div className="view-switch work-tabs" role="tablist" aria-label="工作区">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-tab={t}>
            {t === 'mats' ? `素材 (${work.itemUids.length})` : PANEL_LABEL[t]}
          </button>
        ))}
      </div>
      )}
      <div className={`work-layout${desktop ? ' two' : ''}`}>
        <div className="work-main">
          {tab === 'draft' && <Draft work={work} mats={mats || []} apiRef={draftApi} onAddMat={addMat} />}
          {tab === 'shots' && <Shots work={work} mats={mats || []} save={save} />}
          {tab === 'tracks' && <Tracks work={work} mats={mats || []} save={save} />}
          {tab === 'board' && (
            <Suspense fallback={<Loading />}>
              <Board work={work} mats={mats || []} save={save} />
            </Suspense>
          )}
          {tab === 'mats' && matsCol}
        </div>
        {desktop && <aside className="work-side">{matsCol}</aside>}
      </div>
    </section>
  );
}

function Todos({ todos, onChange }: { todos: WorkTodo[]; onChange: (t: WorkTodo[]) => void }) {
  const [txt, setTxt] = useState('');
  const done = todos.filter((t) => t.done).length;
  return (
    <section className="work-todos" aria-label="待办">
      <div className="label">
        待办 <span className="num">({done}/{todos.length})</span>
      </div>
      <ul>
        {todos.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <label className="work-todo">
              <input type="checkbox" checked={!!t.done} onChange={() => onChange(todos.map((x) => (x.id === t.id ? { ...x, done: x.done ? undefined : 1 } : x)))} />
              <span>{t.text}</span>
            </label>
            <button className="btn text faint work-todo-x" onClick={() => onChange(todos.filter((x) => x.id !== t.id))} aria-label={`删掉待办：${t.text}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="work-todo-add"
        onSubmit={(e) => {
          e.preventDefault();
          const s = txt.trim();
          if (!s) return;
          onChange([...todos, { id: rid(), text: s.slice(0, 80) }]);
          setTxt('');
        }}
      >
        <input className="line-input" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="加一条待办，回车" aria-label="加一条待办" maxLength={80} />
      </form>
    </section>
  );
}

// ───────── 0303 稿：左稿右穗，[[ 引用 ─────────

function Draft({ work, mats, apiRef, onAddMat }: { work: Work; mats: Item[]; apiRef: React.MutableRefObject<{ insert: (t: string) => void } | null>; onAddMat: (it: Item) => Promise<void> }) {
  const { openItem } = useApp();
  const [text, setText] = usePersist(work.draft, (v) => void updateWork(work.id!, { draft: v }));
  const [mode, setMode] = useState<'write' | 'read'>('write');
  const ta = useRef<HTMLTextAreaElement>(null);
  const [pend, setPend] = useState<{ from: number; q: string } | null>(null);
  const [sel, setSel] = useState(0);
  const cliches = useLiveQuery(() => db.cliches.toArray(), []);
  const refsAll = useLiveQuery(() => itemsByUids(refUids(text)), [refUids(text).join(',')]);
  // 结果带上本次的查询词：useLiveQuery 换依赖的第一帧会先给上一次的结果（v0.28 篮子的教训），对上了才算数
  const libQ = useLiveQuery(async () => {
    if (!pend) return { q: null as string | null, list: [] as Item[] };
    const q = pend.q.trim();
    const all = (await db.items.orderBy('updatedAt').reverse().toArray()).filter((x) => !x.deletedAt && x.uid);
    return { q: pend.q as string | null, list: all.filter((x) => matchItem(x, q)).slice(0, 40) };
  }, [pend?.q ?? null]);
  const lib = libQ && pend && libQ.q === pend.q ? libQ.list : undefined;
  const cands = useMemo(() => {
    if (!pend) return [];
    const q = pend.q.trim();
    const m = mats.filter((x) => matchItem(x, q));
    const seen = new Set(m.map((x) => x.uid));
    return [...m, ...(lib || []).filter((x) => !seen.has(x.uid))].slice(0, 8);
  }, [pend, mats, lib]);
  const byUid = useMemo(() => new Map((refsAll || []).map((x) => [x.uid!, x])), [refsAll]);
  // v0.30：编辑框里只显示 [[标题]]，uid 藏在草稿里；光标、[[ 弹窗都按显示文本算，写回时换算成草稿位置
  const layout = useMemo(() => refLayout(text), [text]);
  const caretTo = useRef(-1);
  useLayoutEffect(() => {
    const el = ta.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 2 + 'px';
    }
    if (caretTo.current >= 0 && el) {
      el.setSelectionRange(caretTo.current, caretTo.current);
      caretTo.current = -1;
    }
  }, [layout.display, mode]);
  const insertAt = useCallback(
    (token: string) => {
      const el = ta.current;
      const dcaret = el ? el.selectionStart : layout.display.length;
      // 正在打的 [[xxx 是普通文字，草稿里一模一样：换算成草稿位置后直接在草稿里替换
      const r = insertRef(text, dispToMd(layout, dcaret), token);
      setText(r.text);
      setPend(null);
      caretTo.current = mdToDisp(refLayout(r.text), r.caret);
      requestAnimationFrame(() => ta.current?.focus());
    },
    [text, setText, layout],
  );
  useEffect(() => {
    apiRef.current = {
      insert: (t) => {
        setMode('write');
        requestAnimationFrame(() => insertAt(t));
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, insertAt]);
  const choose = (it: Item) => {
    insertAt(refToken(it));
    if (!work.itemUids.includes(it.uid!)) void onAddMat(it);
  };
  const sync = () => {
    const el = ta.current;
    if (!el) return;
    if (el.selectionStart === el.selectionEnd) {
      const c = snapCaret(layout, el.selectionStart);
      if (c !== el.selectionStart) el.setSelectionRange(c, c);
    }
    const p = pendingRef(el.value, el.selectionStart);
    setPend(p);
    setSel(0);
  };
  const hits = useMemo(() => (cliches ? findHits(text, enforcedKeys(cliches)) : []), [text, cliches]);
  const rc = work.form === 'review' ? reviewCheck(text) : null;
  const words = rc ? rc.words : wordCount(text);
  return (
    <div className="work-draft">
      <div className="work-draft-bar">
        <div className="view-switch" role="tablist" aria-label="写 / 读">
          <button role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'on' : ''} onClick={() => setMode('write')}>
            写
          </button>
          <span className="sep" aria-hidden>
            |
          </span>
          <button role="tab" aria-selected={mode === 'read'} className={`work-read${mode === 'read' ? ' on' : ''}`} onClick={() => setMode('read')}>
            预览
          </button>
        </div>
        <span className="meta-text work-words" data-n={words}>
          {rc ? `${words} / ${rc.target} 字` : `${words} 字`}
          {hits.length ? <span className="work-wall"> · 撞墙 {hits.length} 处</span> : null}
        </span>
      </div>
      {rc && (rc.bare.length > 0 || rc.points === 0) && (
        <p className="work-warn meta-text" role="note">
          {rc.points === 0 ? '影评至少要有一个「## 论点」。' : `${rc.bare.join('、')} 还没引用你的收藏：打 [[ 选一穗当证据。`}
        </p>
      )}
      {hits.length > 0 && <p className="work-warn meta-text work-wall-list">套路墙上的词：{hits.slice(0, 6).join('、')}</p>}
      {mode === 'write' ? (
        <div className="work-editor">
          <div className="work-ed-box">
          <RefBackdrop layout={layout} byUid={byUid} loaded={!!refsAll} />
          <textarea
            ref={ta}
            className="work-text"
            value={layout.display}
            onChange={(e) => {
              const v = e.target.value;
              const r = applyDisplayEdit(text, v);
              setText(r.md);
              // 改动碰到了引用（整块删 / 插到后面 / 粘贴了带 uid 的引用）→ 显示文本和刚打的不一样，光标按换算的放
              if (r.caret >= 0 && refLayout(r.md).display !== v) caretTo.current = r.caret;
              requestAnimationFrame(sync);
            }}
            onKeyUp={(e) => {
              if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) sync();
            }}
            onClick={sync}
            onKeyDown={(e) => {
              // 列表还在查（!lib）时回车也要接住，不能落成换行
              if (!pend || (!cands.length && (lib || (e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape')))) return;
              if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && cands.length) {
                e.preventDefault();
                setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : cands.length - 1)) % cands.length);
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                // 慢机器上打字快：弹窗还没跟上最后几个字时，按框里现在的字重新挑，不拿旧列表的第一条
                const now = pendingRef(e.currentTarget.value, e.currentTarget.selectionStart);
                if (now && (now.q !== pend.q || !lib)) {
                  const q = now.q.trim();
                  const hit = mats.find((x) => matchItem(x, q)) || (now.q === pend.q ? undefined : (libQ?.list || []).find((x) => matchItem(x, q)));
                  if (hit) choose(hit);
                  else
                    void db.items
                      .orderBy('updatedAt')
                      .reverse()
                      .toArray()
                      .then((all) => {
                        const h = all.find((x) => !x.deletedAt && x.uid && matchItem(x, q));
                        if (h) choose(h);
                      });
                  return;
                }
                choose(cands[Math.min(sel, cands.length - 1)]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setPend(null);
              }
            }}
            onBlur={() => setTimeout(() => setPend(null), 200)}
            spellCheck={false}
            aria-label="草稿（Markdown，打 [[ 引用一穗）"
          />
          </div>
          {pend && (
            <div className="ref-pick" role="listbox" aria-label="引用哪一穗">
              <div className="label">引用一穗{pend.q ? ` · ${pend.q}` : ''}</div>
              {cands.length ? (
                cands.map((it, i) => (
                  <button key={it.uid} role="option" aria-selected={i === sel} className={`ref-opt${i === sel ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(it)}>
                    <span className="ref-opt-t">{it.title}</span>
                    <span className="ref-opt-s meta-text">
                      {TYPE_LABEL[it.type]}
                      {work.itemUids.includes(it.uid!) ? ' · 素材' : ''}
                    </span>
                  </button>
                ))
              ) : !lib ? null : (
                <div className="meta-text ref-none">没找到。换个字试试。</div>
              )}
            </div>
          )}
          <p className="meta-text work-tip">Markdown：# 标题、- 列表、&gt; 引用、**粗体**。打 [[ 引用一穗，也可以把右边的素材拖进来。</p>
        </div>
      ) : (
        <article className="work-read-view">
          <MdView blocks={mdBlocks(text)} byUid={byUid} onRef={(uid) => {
            const it = byUid.get(uid);
            if (it) openItem(it);
          }} />
        </article>
      )}
    </div>
  );
}

/** v0.30 编辑框下面那一层：和编辑框同字号同换行，把 [[标题]] 画成 chip（括号淡掉），编辑框本身文字透明、只留光标和选区 */
function RefBackdrop({ layout, byUid, loaded }: { layout: RefLayout; byUid: Map<string, Item>; loaded: boolean }) {
  const parts: ReactNode[] = [];
  let last = 0;
  layout.spans.forEach((sp, i) => {
    if (sp.ds > last) parts.push(layout.display.slice(last, sp.ds));
    const gone = loaded && !byUid.has(sp.uid);
    parts.push(
      <span key={i} className={`ref-chip${gone ? ' gone' : ''}`} data-uid={sp.uid}>
        <span className="ref-br">[[</span>
        {sp.title}
        <span className="ref-br">]]</span>
      </span>,
    );
    last = sp.de;
  });
  parts.push(layout.display.slice(last) + '\n');
  return (
    <div className="work-hl" aria-hidden>
      {parts}
    </div>
  );
}

function InlineView({ parts, byUid, onRef }: { parts: Inline[]; byUid: Map<string, Item>; onRef: (uid: string) => void }) {
  return (
    <>
      {parts.map((p, i) =>
        'ref' in p ? (
          <button key={i} className={`md-ref${byUid.has(p.ref.uid) ? '' : ' gone'}`} onClick={() => onRef(p.ref.uid)} title={byUid.has(p.ref.uid) ? `打开「${p.ref.title}」` : '这穗已经不在穗仓了'}>
            {p.ref.title}
          </button>
        ) : 'b' in p ? (
          <strong key={i}>{p.b}</strong>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}
function MdView({ blocks, byUid, onRef }: { blocks: Block[]; byUid: Map<string, Item>; onRef: (uid: string) => void }) {
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (k: number) => {
    if (list.length) out.push(<ul key={`ul${k}`}>{list}</ul>);
    list = [];
  };
  blocks.forEach((b, i) => {
    const inner = <InlineView parts={b.inline} byUid={byUid} onRef={onRef} />;
    if (b.kind === 'li' || b.kind === 'todo') {
      list.push(
        <li key={i} className={b.kind === 'todo' ? `md-todo${b.done ? ' done' : ''}` : undefined}>
          {b.kind === 'todo' ? (b.done ? '☑ ' : '☐ ') : null}
          {inner}
        </li>,
      );
      return;
    }
    flush(i);
    if (b.kind === 'h1') out.push(<h1 key={i}>{inner}</h1>);
    else if (b.kind === 'h2') out.push(<h2 key={i}>{inner}</h2>);
    else if (b.kind === 'h3') out.push(<h3 key={i}>{inner}</h3>);
    else if (b.kind === 'quote') out.push(<blockquote key={i}>{inner}</blockquote>);
    else if (b.kind === 'hr') out.push(<hr key={i} />);
    else out.push(<p key={i}>{inner}</p>);
  });
  flush(blocks.length);
  return <>{out.length ? out : <p className="meta-text">还是空的。</p>}</>;
}

// ───────── 0309 素材 ─────────

function Materials({ work, mats, onAdd, onRemove, onQuote, onOpen, canQuote }: { work: Work; mats: Item[] | undefined; onAdd: (it: Item) => Promise<void>; onRemove: (it: Item) => void; onQuote: (it: Item) => void; onOpen: (it: Item) => void; canQuote: boolean }) {
  const [q, setQ] = useState('');
  const found = useLiveQuery(async () => {
    const k = q.trim();
    if (!k) return [] as Item[];
    const all = (await db.items.orderBy('updatedAt').reverse().toArray()).filter((x) => !x.deletedAt && x.uid && !work.itemUids.includes(x.uid));
    return all.filter((x) => matchItem(x, k)).slice(0, 12);
  }, [q, work.itemUids.join(',')]);
  return (
    <section className="work-mats" aria-label="素材">
      <div className="label">
        素材 <span className="num">({work.itemUids.length})</span>
      </div>
      <input className="line-input work-mat-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="从穗仓里找一穗加进来" aria-label="从穗仓里找素材" />
      {q.trim() && (
        <ul className="work-found">
          {(found || []).map((it) => (
            <li key={it.uid}>
              <span className="work-mat-t">{it.title}</span>
              <span className="meta-text">{TYPE_LABEL[it.type]}</span>
              <button className="btn text strong work-mat-add" onClick={() => void onAdd(it).then(() => setQ(''))}>
                加入
              </button>
            </li>
          ))}
          {found && !found.length && <li className="meta-text">没找到。</li>}
        </ul>
      )}
      {mats === undefined ? null : mats.length === 0 ? (
        <p className="meta-text">还没有素材。上面搜一穗加进来，或在草稿里打 [[。</p>
      ) : (
        <ul className="work-mat-list">
          {mats.map((it) => (
            <li
              key={it.uid}
              className="work-mat"
              draggable={canQuote}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', refToken(it));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              data-uid={it.uid}
            >
              {itemHasImage(it) ? <Thumb it={it} /> : <span className="wk-thumb" aria-hidden><span className="wk-glyph">{TYPE_LABEL[it.type].slice(0, 1)}</span></span>}
              <button className="work-mat-t linklike" onClick={() => onOpen(it)}>
                {it.title}
              </button>
              <span className="work-mat-acts">
                {canQuote && (
                  <button className="btn text work-mat-quote" onClick={() => onQuote(it)}>
                    引用
                  </button>
                )}
                <button className="btn text faint work-mat-x" onClick={() => onRemove(it)} aria-label={`从素材移除：${it.title}`}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ───────── 0304 / 0305 分镜 ─────────

function Shots({ work, mats, save }: { work: Work; mats: Item[]; save: (c: Partial<Work>) => void }) {
  const [shots, setShots] = usePersist<WorkShot[]>(work.shots || [], (v) => save({ shots: v }));
  const [target, setTarget] = usePersist<number>(work.targetSec || 60, (v) => save({ targetSec: v }));
  const [pickFor, setPickFor] = useState<string | null>(null);
  const frames = useLiveQuery(() => itemsByUids(shots.map((s) => s.frameUid || '').filter(Boolean)), [shots.map((s) => s.frameUid || '').join(',')]);
  const fm = useMemo(() => new Map((frames || []).map((x) => [x.uid!, x])), [frames]);
  const c = shotCheck(shots, target);
  const patch = (id: string, p: Partial<WorkShot>) => setShots(shots.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= shots.length) return;
    const n = [...shots];
    [n[i], n[j]] = [n[j], n[i]];
    setShots(n);
  };
  return (
    <div className="work-shots">
      <div className="shot-sum">
        <span className={`shot-total${c.over ? ' over' : ''}`} data-total={c.total}>
          合计 {fmtSec(c.total)} / 目标
        </span>
        <label className="shot-target">
          <input type="number" min={5} max={3600} step={5} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 60))} aria-label="目标时长（秒）" />
          秒
        </label>
        {c.over > 0 && <span className="shot-over meta-text">超出 {fmtSec(c.over)}，砍掉几个镜头或缩短时长</span>}
      </div>
      <ol className="shot-list">
        {shots.map((s, i) => {
          const f = s.frameUid ? fm.get(s.frameUid) : undefined;
          return (
            <li key={s.id} className="shot" data-shot={i + 1}>
              <span className="shot-no num">{String(i + 1).padStart(2, '0')}</span>
              <button className={`shot-frame${f ? ' has' : ''}`} onClick={() => setPickFor(s.id)} aria-label={f ? `参考帧：${f.title}，点一下换` : '选一张参考帧'} title={f ? f.title : '选参考帧'}>
                {f ? <Thumb it={f} className="shot-img" /> : <span className="shot-glyph">{sizeGlyph(s.size)}</span>}
              </button>
              <select className="shot-size" value={s.size} onChange={(e) => patch(s.id, { size: e.target.value })} aria-label="景别">
                {SHOT_SIZES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
              <input className="shot-visual" value={s.visual} onChange={(e) => patch(s.id, { visual: e.target.value })} placeholder="画面" aria-label={`镜头 ${i + 1} 画面`} />
              <input className="shot-sound" value={s.sound} onChange={(e) => patch(s.id, { sound: e.target.value })} placeholder="声音" aria-label={`镜头 ${i + 1} 声音`} />
              <label className="shot-sec">
                <input type="number" min={0.5} max={600} step={0.5} value={s.sec} onChange={(e) => patch(s.id, { sec: Math.max(0, Number(e.target.value) || 0) })} aria-label={`镜头 ${i + 1} 时长（秒）`} />
                秒
              </label>
              <span className="shot-acts">
                <button className="btn text faint" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移">
                  ↑
                </button>
                <button className="btn text faint" onClick={() => move(i, 1)} disabled={i === shots.length - 1} aria-label="下移">
                  ↓
                </button>
                <button className="btn text faint shot-x" onClick={() => setShots(shots.filter((x) => x.id !== s.id))} aria-label={`删掉镜头 ${i + 1}`}>
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <button className="btn text strong shot-add" onClick={() => setShots([...shots, newShot()])}>
        + 加一个镜头
      </button>
      <Sheet open={!!pickFor} onClose={() => setPickFor(null)} title="选一张参考帧" variant="capture">
        {pickFor && (
          <FramePicker
            mats={mats}
            current={shots.find((s) => s.id === pickFor)?.frameUid}
            onPick={(uid) => {
              patch(pickFor, { frameUid: uid });
              setPickFor(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function FramePicker({ mats, current, onPick }: { mats: Item[]; current?: string; onPick: (uid: string | undefined) => void }) {
  const imgs = useLiveQuery(async () => {
    const all = (await db.items.where('type').equals('image').toArray()).filter((x) => !x.deletedAt && x.uid);
    const extra = (await db.items.toArray()).filter((x) => !x.deletedAt && x.uid && x.type !== 'image' && itemHasImage(x));
    const ms = new Set(mats.map((x) => x.uid));
    return [...all, ...extra].sort((a, b) => Number(ms.has(b.uid)) - Number(ms.has(a.uid)) || b.createdAt - a.createdAt).slice(0, 60);
  }, [mats.map((x) => x.uid).join(',')]);
  if (!imgs) return <Loading />;
  return (
    <div className="frame-pick">
      {!imgs.length && <p className="meta-text">穗仓里还没有图。先拾几张截图或剧照。</p>}
      <div className="frame-grid">
        {imgs.map((it) => (
          <button key={it.uid} className={`frame-opt${current === it.uid ? ' on' : ''}`} onClick={() => onPick(it.uid)} title={it.title}>
            <Thumb it={it} className="frame-img" />
            <span className="frame-t">{it.title}</span>
          </button>
        ))}
      </div>
      {current && (
        <button className="btn text faint frame-clear" onClick={() => onPick(undefined)}>
          不要参考帧（显示景别字印）
        </button>
      )}
    </div>
  );
}

// ───────── 0306 / 0322 歌单 ─────────

function Tracks({ work, mats, save }: { work: Work; mats: Item[]; save: (c: Partial<Work>) => void }) {
  const { toast } = useApp();
  const [tracks, setTracks] = usePersist<WorkTrack[]>(work.tracks || [], (v) => save({ tracks: v }));
  const songs = useLiveQuery(() => itemsByUids(tracks.map((t) => t.uid)), [tracks.map((t) => t.uid).join(',')]);
  const bu = useMemo(() => new Map((songs || []).map((x) => [x.uid!, x])), [songs]);
  const nMusic = useLiveQuery(() => libraryMusic().then((a) => a.length), []);
  const rebuild = async () => {
    const t = buildPlaylist(await libraryMusic(), mats);
    setTracks(t);
    toast(t.length ? `按起-落-起排了 ${t.length} 首` : '库里还没有音乐穗', t.length ? 'ok' : 'err');
  };
  const text = playlistText(tracks, bu);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= tracks.length) return;
    const n = [...tracks];
    [n[i], n[j]] = [n[j], n[i]];
    setTracks(n);
  };
  return (
    <div className="work-tracks">
      <div className="track-bar">
        <span className="meta-text">只用你库里的 {nMusic ?? '…'} 首音乐穗，开头中高、中间落下、结尾再起来。</span>
        <span className="text-actions actions">
          <button className="btn text strong track-rebuild" onClick={() => void rebuild()}>
            {tracks.length ? '重新排' : '排一张'}
          </button>
          {tracks.length > 0 && (
            <>
              <button
                className="btn text track-copy"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text);
                    toast('已复制「歌名 - 歌手」：到网易云 / QQ 音乐的导入歌单里粘贴');
                  } catch {
                    toast('复制失败：用「导出 .txt」', 'err');
                  }
                }}
              >
                复制歌单文本
              </button>
              <button className="btn text track-export" onClick={() => download(`${safeFileName(work.title)}-歌单.txt`, text + '\n', 'text/plain')}>
                导出 .txt
              </button>
            </>
          )}
        </span>
      </div>
      {tracks.length === 0 ? (
        <p className="meta-text">{nMusic === 0 ? '库里还没有音乐穗。先拾几首歌（速记里打 /歌 歌名 @歌手）。' : '还没排。点「排一张」。'}</p>
      ) : (
        <ol className="track-list">
          {tracks.map((t, i) => {
            const it = bu.get(t.uid);
            return (
              <li key={t.uid + i} className="track" data-track={i + 1}>
                <span className="track-no num">{String(i + 1).padStart(2, '0')}</span>
                <span className="track-main">
                  <span className="track-t">{it ? it.title : '（这首已经不在穗仓了）'}</span>
                  {it?.creator && <span className="track-by meta-text">{it.creator}</span>}
                  <input className="track-why" value={t.why} onChange={(e) => setTracks(tracks.map((x, k) => (k === i ? { ...x, why: e.target.value } : x)))} aria-label={`第 ${i + 1} 首为什么在这`} />
                </span>
                <span className="shot-acts">
                  <button className="btn text faint" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移">
                    ↑
                  </button>
                  <button className="btn text faint" onClick={() => move(i, 1)} disabled={i === tracks.length - 1} aria-label="下移">
                    ↓
                  </button>
                  <button className="btn text faint" onClick={() => setTracks(tracks.filter((_, k) => k !== i))} aria-label={`移出第 ${i + 1} 首`}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default Works;
