// v0.17 秒搜（m18 / d8）：超大查询行 + 真实计数 → 类型 / 标签 / 日期 三行文字筛选 → 「穗 (n)」无线表格 + 「新枝 (n)」→ 最近搜过。
// 全部在本地：内存倒排索引（lib/ftsync）+ 原文核对，断网照常。
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { HoverPreview, safeHost } from '../components/ItemCard';
import { VirtualList } from '../components/Virtual';
import { db } from '../lib/db';
import { ftShared } from '../lib/ftsync';
import { itemHasImage } from '../lib/imagestore';
import { useThumbSrc } from '../lib/useImage';
import { DATE_LABEL, FIELD_LABEL, FOCUS_BRANCH_KEY, dateBounds, parseQuery, pushRecent, searchDocs, snippet, splitByTerms, toDoc, type DateRange, type SearchHit, type Term } from '../lib/search';
import { displayTitle, shortDate } from '../lib/studio';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER, type Development, type Item, type ItemType } from '../lib/types';

const RECENT_KEY = 'glean.recentq';
const RANGES: DateRange[] = ['all', '7d', '30d', 'year', 'custom'];
type TypeSel = 'all' | ItemType | 'branch';

declare global {
  interface Window {
    __gleanSearchPaint?: { q: string; ms: number; at: number };
  }
}

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

/** 命中字黑底白字 */
export function TermHits({ text, terms }: { text: string; terms: Term[] }): ReactNode {
  if (!terms.length || !text) return text;
  return splitByTerms(text, terms).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.t}</mark> : <span key={i}>{p.t}</span>));
}

/** 「命中」列：除标题以外命中的字段，标签「冬天 · 夜」备注「…雪夜木屋亮着的窗」；只中标题就写「标题」 */
function hitWhere(h: SearchHit, terms: Term[]): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  for (const fh of h.fields) {
    const f = h.doc.fields[fh.i];
    if (f.f === 'title' || (f.f === 'content' && (h.doc.obj as Item).type === 'text' && h.doc.kind === 'i')) continue;
    out.push({ label: FIELD_LABEL[f.f], text: snippet(f.f === 'url' ? safeHost(f.text) + f.text.replace(/^https?:\/\/[^/]+/, '') : f.text, terms, 26).text });
    if (out.length >= 2) break;
  }
  return out;
}

export function SearchView({ items, devs, onClose }: { items: Item[]; devs: Development[]; onClose: () => void }) {
  const { openItem, go, desktop } = useApp();
  const ft = ftShared(db);
  const rev = useSyncExternalStore(ft.subscribe, ft.getRev);
  const [q, setQ] = useState('');
  const [type, setType] = useState<TypeSel>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const inputAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const remember = useCallback(
    (s: string = q) => {
      setRecent((r) => {
        const n = pushRecent(r, s);
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(n));
        } catch {
          /* 隐私模式 */
        }
        return n;
      });
    },
    [q],
  );

  const itemDocs = useMemo(() => items.filter((i) => i.id != null).map((i) => toDoc('i', i)), [items]);
  const devDocs = useMemo(() => devs.filter((d) => d.id != null && d.idea).map((d) => toDoc('b', d)), [devs]);
  const terms = useMemo(() => parseQuery(q), [q]);

  // 搜索本身（索引候选 + 原文核对），记下计算耗时
  const base = useMemo(() => {
    void rev;
    if (!terms.length) return null;
    const t0 = performance.now();
    const ih = searchDocs(ft.index, itemDocs, terms);
    const bh = searchDocs(ft.index, devDocs, terms);
    ft.status.lastMs = +(performance.now() - t0).toFixed(2);
    ft.status.lastQuery = q;
    ft.status.lastHits = ih.length + bh.length;
    return { ih, bh };
  }, [terms, itemDocs, devDocs, rev, ft, q]);

  const [lo, hi] = useMemo(() => dateBounds(range, Date.now(), from, to), [range, from, to]);
  const inRange = useCallback((t: number) => t >= lo && t < hi, [lo, hi]);
  const allI = useMemo<Array<SearchHit<Item>>>(() => (base ? (base.ih as Array<SearchHit<Item>>) : itemDocs.map((doc) => ({ doc, score: 0, fields: [] }))).filter((h) => inRange(h.doc.createdAt)), [base, itemDocs, inRange]);
  const allB = useMemo<Array<SearchHit<Development>>>(() => (base ? (base.bh as Array<SearchHit<Development>>) : devDocs.map((doc) => ({ doc, score: 0, fields: [] }))).filter((h) => inRange(h.doc.createdAt)), [base, devDocs, inRange]);

  const typeN = useMemo(() => {
    const m = new Map<ItemType, number>();
    for (const h of allI) if (!tag || h.doc.obj.tags.includes(tag)) m.set(h.doc.obj.type, (m.get(h.doc.obj.type) || 0) + 1);
    return m;
  }, [allI, tag]);
  const tagN = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of allI) if (type === 'all' || h.doc.obj.type === type) for (const t of h.doc.obj.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  }, [allI, type]);
  const iHits = useMemo(() => (type === 'branch' ? [] : allI.filter((h) => (type === 'all' || h.doc.obj.type === type) && (!tag || h.doc.obj.tags.includes(tag)))), [allI, type, tag]);
  const bHits = type === 'all' || type === 'branch' ? (tag ? [] : allB) : [];
  const nBranchFacet = tag ? 0 : allB.length;
  const active = terms.length > 0 || type !== 'all' || !!tag || range !== 'all';
  const total = iHits.length + bHits.length;

  // 输入 → 结果画到屏幕上的耗时（e2e 读它，也读自己量的）
  useLayoutEffect(() => {
    if (!inputAt.current) return;
    const t = inputAt.current;
    inputAt.current = 0;
    const qq = q;
    requestAnimationFrame(() => {
      window.__gleanSearchPaint = { q: qq, ms: +(performance.now() - t).toFixed(1), at: performance.now() };
    });
  });

  // 搜过的词：停下来 1.5 秒且有结果就记进「最近搜过」
  useEffect(() => {
    if (!terms.length || !total) return;
    const t = setTimeout(() => remember(q), 1500);
    return () => clearTimeout(t);
  }, [q, terms.length, total, remember]);

  // 已选的标签不在结果里了就放掉
  useEffect(() => {
    if (tag && !tagN.some(([t]) => t === tag) && !allI.some((h) => h.doc.obj.tags.includes(tag))) setTag(null);
  }, [tag, tagN, allI]);

  const openHit = (it: Item) => {
    if (terms.length) remember();
    openItem(it);
  };
  const openBranch = (d: Development) => {
    if (terms.length) remember();
    try {
      sessionStorage.setItem(FOCUS_BRANCH_KEY, String(d.id));
    } catch {
      /* ignore */
    }
    go('branches');
  };
  const setQuery = (v: string) => {
    inputAt.current = performance.now();
    setQ(v);
  };

  // 没找到时的提示：长词拆成单字（有结果的），再加两个常用标签
  const tips = useMemo(() => {
    if (!terms.length || total) return [];
    const out: string[] = [];
    for (const t of terms)
      if (t.kind === 'cjk' && t.s.length > 1)
        for (const ch of t.s) if (!out.includes(ch) && searchDocs(ft.index, itemDocs, [{ kind: 'cjk', s: ch }]).length) out.push(ch);
    const tc = new Map<string, number>();
    for (const d of itemDocs) for (const tg of d.obj.tags) tc.set(tg, (tc.get(tg) || 0) + 1);
    for (const [tg] of [...tc.entries()].sort((a, b) => b[1] - a[1])) if (out.length < 4 && !out.includes(tg) && tg !== q.trim()) out.push(tg);
    return out.slice(0, 4);
  }, [terms, total, ft, itemDocs, q]);

  const countText = active ? `在 ${items.length} 穗和 ${devs.length} 根新枝里找到 ${total} 处` : `在 ${items.length} 穗和 ${devs.length} 根新枝里找`;

  return (
    <section className="view library search-view" aria-label="搜索">
      <header className="sq-head">
        <div className="sq-line">
          <label className="sq-grow" data-v={q || '搜点什么'}>
            <input
              ref={inputRef}
              className="sq-input"
              value={q}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && terms.length) {
                  remember();
                  if (!desktop) inputRef.current?.blur();
                }
              }}
              placeholder="搜点什么"
              aria-label="搜索"
              autoFocus
              size={1}
              enterKeyHint="search"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {active && (
            <span className="sq-total num" aria-hidden>
              ({total})
            </span>
          )}
          <span className="sq-acts">
            {q && (
              <button className="btn text faint sq-clear" onClick={() => (setQuery(''), inputRef.current?.focus())}>
                清除
              </button>
            )}
            <button className="btn text sq-cancel" onClick={onClose}>
              取消
            </button>
          </span>
        </div>
        <p className="sq-count meta-text" data-q={q} data-n={total} aria-live="polite">
          {countText}
        </p>
      </header>

      <div className="sq-filters">
        <div className="sq-frow" role="toolbar" aria-label="类型">
          <span className="sq-fl label">类型</span>
          <span className="sq-opts">
            <button className={`chip${type === 'all' ? ' on' : ''}`} onClick={() => setType('all')}>
              全部 <span className="n">({allI.filter((h) => !tag || h.doc.obj.tags.includes(tag)).length + nBranchFacet})</span>
            </button>
            {TYPE_ORDER.filter((t) => typeN.get(t) || type === t).map((t) => (
              <button key={t} className={`chip sq-type${type === t ? ' on' : ''}`} data-type={t} onClick={() => setType(type === t ? 'all' : t)}>
                {TYPE_LABEL[t]} <span className="n">({typeN.get(t) || 0})</span>
              </button>
            ))}
            {(nBranchFacet > 0 || type === 'branch') && (
              <button className={`chip sq-type${type === 'branch' ? ' on' : ''}`} data-type="branch" onClick={() => setType(type === 'branch' ? 'all' : 'branch')}>
                新枝 <span className="n">({nBranchFacet})</span>
              </button>
            )}
          </span>
        </div>
        {(tagN.length > 0 || tag) && type !== 'branch' && (
          <div className="sq-frow" role="toolbar" aria-label="标签">
            <span className="sq-fl label">标签</span>
            <span className="sq-opts">
              <button className={`chip${!tag ? ' on' : ''}`} onClick={() => setTag(null)}>
                不限
              </button>
              {tagN.map(([t, n]) => (
                <button key={t} className={`chip sq-tag${tag === t ? ' on' : ''}`} data-tag={t} onClick={() => setTag(tag === t ? null : t)}>
                  #{t} <span className="n">({n})</span>
                </button>
              ))}
            </span>
          </div>
        )}
        <div className="sq-frow" role="toolbar" aria-label="日期">
          <span className="sq-fl label">日期</span>
          <span className="sq-opts">
            {RANGES.map((r) => (
              <button key={r} className={`chip sq-range${range === r ? ' on' : ''}`} data-range={r} onClick={() => setRange(r)}>
                {DATE_LABEL[r]}
              </button>
            ))}
            {range === 'custom' && (
              <span className="sq-dates">
                <input type="date" className="sq-date sq-from" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="从" />
                <span className="dim">—</span>
                <input type="date" className="sq-date sq-to" value={to} onChange={(e) => setTo(e.target.value)} aria-label="到" />
              </span>
            )}
          </span>
        </div>
      </div>

      {!active ? (
        <div className="sq-idle">
          <p className="meta-text">输入就出结果：标题、作者、句子、为什么、标签，连新枝一起找。中文连着的字要连着出现，英文按词首。</p>
          {recent.length > 0 && (
            <section className="sq-recent">
              <div className="label">最近搜过</div>
              <div className="sq-recent-row">
                {recent.map((r) => (
                  <button key={r} className="linklike sq-recent-q" onClick={() => setQuery(r)}>
                    {r}
                  </button>
                ))}
                <button
                  className="btn text faint sq-recent-clear"
                  onClick={() => {
                    setRecent([]);
                    localStorage.removeItem(RECENT_KEY);
                  }}
                >
                  清空
                </button>
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="sq-results">
          {type !== 'branch' && (
            <section className="sq-sec sq-items">
              <div className="sq-sec-head label">穗 ({iHits.length})</div>
              {iHits.length > 0 && <ItemResults hits={iHits} terms={terms} desktop={desktop} onOpen={openHit} />}
            </section>
          )}
          {(type === 'branch' || (type === 'all' && !tag && (bHits.length > 0 || iHits.length === 0))) && (
            <section className="sq-sec sq-branches">
              <div className="sq-sec-head label">新枝 ({bHits.length})</div>
              {bHits.slice(0, 60).map((h) => (
                <BranchRow key={h.doc.key} h={h} terms={terms} onOpen={openBranch} />
              ))}
              {bHits.length > 60 && <p className="meta-text sq-more">还有 {bHits.length - 60} 根，换个更具体的词试试</p>}
            </section>
          )}
          {total === 0 && (
            <div className="sq-none">
              <p className="meta-text">没找到这一穗。</p>
              {tips.length > 0 && (
                <p className="meta-text sq-tips">
                  没找到？试试
                  {tips.map((t) => (
                    <button key={t} className="linklike sq-tip" onClick={() => setQuery(t)}>
                      「{t}」
                    </button>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ItemResults({ hits, terms, desktop, onOpen }: { hits: Array<SearchHit<Item>>; terms: Term[]; desktop: boolean; onOpen: (i: Item) => void }) {
  const [hov, setHov] = useState<{ it: Item; x: number; y: number } | null>(null);
  const onHover = useCallback((it: Item | null, e?: React.PointerEvent) => setHov(it && e && itemHasImage(it) ? { it, x: e.clientX, y: e.clientY } : null), []);
  return (
    <div className={`sq-table${desktop ? ' wide' : ''}`}>
      {desktop && (
        <div className="sq-thead" aria-hidden>
          <span className="tc">穗</span>
          <span className="tc">类型</span>
          <span className="tc">命中</span>
          <span className="tc tc-date">日期</span>
        </div>
      )}
      <VirtualList
        className="sq-tbody"
        rowClassName="sq-rowwrap"
        gap={0}
        items={hits}
        keyOf={(h) => h.doc.key}
        estimate={() => (desktop ? 56 : 92)}
        threshold={40}
        render={(h) => <ResultRow h={h} terms={terms} desktop={desktop} onOpen={onOpen} onHover={desktop ? onHover : undefined} />}
      />
      {hov && <HoverPreview item={hov.it} x={hov.x} y={hov.y} />}
    </div>
  );
}

function RowThumb({ it }: { it: Item }) {
  const src = useThumbSrc(it);
  return <span className="sq-thumb">{src ? <img src={src} alt="" decoding="async" /> : null}</span>;
}

const ResultRow = memo(function ResultRow({ h, terms, desktop, onOpen, onHover }: { h: SearchHit<Item>; terms: Term[]; desktop: boolean; onOpen: (i: Item) => void; onHover?: (i: Item | null, e?: React.PointerEvent) => void }) {
  const it = h.doc.obj;
  const where = hitWhere(h, terms);
  const titleHit = h.fields.some((f) => h.doc.fields[f.i].f === 'title' || (it.type === 'text' && h.doc.fields[f.i].f === 'content'));
  const whereNode = where.length ? (
    where.map((w, i) => (
      <span key={i} className="sq-where">
        {w.label}「<TermHits text={w.text} terms={terms} />」
      </span>
    ))
  ) : (
    <span className="sq-where dim">{terms.length ? (titleHit ? '标题' : '') : it.creator || ''}</span>
  );
  const common = {
    className: 'sq-row',
    role: 'button',
    tabIndex: 0,
    'data-item-id': it.id,
    onClick: () => onOpen(it),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(it)),
  } as const;
  if (desktop)
    return (
      <div
        {...common}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onHover?.(it, e)}
        onPointerMove={(e) => e.pointerType === 'mouse' && onHover?.(it, e)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && onHover?.(null)}
      >
        <span className="tc sq-title">
          <TermHits text={displayTitle(it)} terms={terms} />
        </span>
        <span className="tc sq-type-c">{TYPE_LABEL[it.type]}</span>
        <span className="tc sq-hit">{whereNode}</span>
        <span className="tc tc-date num">{shortDate(it.createdAt)}</span>
      </div>
    );
  const img = itemHasImage(it);
  return (
    <div {...common} data-img={img ? '1' : undefined}>
      {img && <RowThumb it={it} />}
      <span className="sq-main">
        <span className="sq-title">
          <TermHits text={displayTitle(it)} terms={terms} />
        </span>
        {where.length > 0 && <span className="sq-hit">{whereNode}</span>}
        <span className="sq-meta">
          {TYPE_LABEL[it.type]} · <span className="num">{shortDate(it.createdAt)}</span>
          {terms.length && titleHit ? ' · 标题' : ''}
        </span>
      </span>
    </div>
  );
});

function BranchRow({ h, terms, onOpen }: { h: SearchHit<Development>; terms: Term[]; onOpen: (d: Development) => void }) {
  const d = h.doc.obj;
  // 正文片段：优先正文里命中的那一段，否则正文开头
  const body = h.doc.fields.find((f) => f.f === 'idea');
  const best = h.fields.find((f) => h.doc.fields[f.i].f !== 'title');
  const src = best ? h.doc.fields[best.i] : body;
  const snip = src ? snippet(src.text, terms, 40).text : '';
  return (
    <button className="sq-branch" data-dev-id={d.id} onClick={() => onOpen(d)}>
      <span className="sq-btitle">
        <TermHits text={(d.idea.title || '').replace(/^《|》$/g, '')} terms={terms} />
      </span>
      {snip && (
        <span className="sq-bbody">
          {best && src && src.f !== 'idea' ? `${FIELD_LABEL[src.f]}「` : ''}
          <TermHits text={snip} terms={terms} />
          {best && src && src.f !== 'idea' ? '」' : ''}
        </span>
      )}
      <span className="sq-meta">
        新枝 · <span className="num">{shortDate(d.createdAt)}</span>
      </span>
    </button>
  );
}
