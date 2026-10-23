import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HoverPreview, Hits, ItemCard, ItemRow } from '../components/ItemCard';
import { DisplayTitle, Loading } from '../components/DisplayTitle';
import { VirtualList, VirtualMasonry } from '../components/Virtual';
import { DailyCard } from '../components/DailyCard';
import { addSamples, clearSamples, db } from '../lib/db';
import { staggerDelay } from '../lib/motion';
import { throwbacks } from '../lib/memory';
import { itemHasImage } from '../lib/imagestore';
import { useThumbSrc } from '../lib/useImage';
import { activeMonths, displayTitle, groupByWeek, monthGrid, tagCounts } from '../lib/studio';
import { SearchView } from './Search';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER, type Item, type ItemType } from '../lib/types';
import { Seg } from '../components/rw/Seg';
import { WordReveal } from '../components/rw/WordReveal';
import { IconSearch } from '../components/rw/icons';

type LibView = 'grid' | 'list' | 'timeline' | 'calendar';
const VIEWS: Array<[LibView, string]> = [
  ['grid', '网格'],
  ['list', '列表'],
  ['timeline', '时间线'],
  ['calendar', '月历'],
];
const VIEW_KEY = 'glean.libview';
/** 入场淡入只给首屏前 8 张错开；后面（虚拟滚动挂上的）直接淡入不等 */
const STAGGER_FIRST = 8;
const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

declare global {
  interface Window {
    __gleanReady?: number;
  }
}

export function Library() {
  const { openItem, openCapture, toast, developFrom, desktop } = useApp();
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray(), []);
  const devs = useLiveQuery(() => db.developments.toArray(), []);
  const q = '';
  const [searching, setSearching] = useState(false);
  const [type, setType] = useState<ItemType | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [lv, setLv] = useState<LibView>(() => {
    const v = localStorage.getItem(VIEW_KEY) as LibView | null;
    return v && VIEWS.some(([k]) => k === v) ? v : 'grid';
  });
  const pickView = (v: LibView) => {
    setLv(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((i) => (type === 'all' || i.type === type) && (!tag || i.tags.includes(tag)));
  }, [items, type, tag]);
  const typeN = useMemo(() => {
    const m = new Map<ItemType, number>();
    for (const i of items || []) m.set(i.type, (m.get(i.type) || 0) + 1);
    return m;
  }, [items]);
  // v0.17 秒搜：桌面按 / 或 Ctrl+K 打开搜索
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setSearching(true);
      }
    };
    const open = () => setSearching(true);
    window.addEventListener('keydown', on);
    window.addEventListener('glean:search', open);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('glean:search', open);
    };
  }, []);
  // 示例不是你拾的：不进「一周前 / 那年今天」
  const backs = useMemo(() => (items ? throwbacks(items.filter((i) => !i.sample)) : []), [items]);

  // 冷启动打点：第一次把穗仓（含卡片）画出来的时刻，e2e 读它
  useEffect(() => {
    if (!items || window.__gleanReady) return;
    requestAnimationFrame(() => {
      if (window.__gleanReady) return;
      window.__gleanReady = performance.now();
      window.dispatchEvent(new Event('glean:ready'));
      try {
        performance.mark('glean:ready', { detail: { items: items.length } });
      } catch {
        /* old webview */
      }
    });
  }, [items]);
  const firstPaint = useRef(true);
  useEffect(() => {
    if (!items?.length) return;
    const t = setTimeout(() => (firstPaint.current = false), 1200);
    return () => clearTimeout(t);
  }, [items]);
  const cellStyle = useCallback((i: number): CSSProperties | undefined => (firstPaint.current && i < STAGGER_FIRST ? ({ '--d': `${staggerDelay(i)}ms` } as CSSProperties) : undefined), []);

  const nSamples = items ? items.filter((i) => i.sample).length : 0;
  async function loadSamples() {
    const ids = await addSamples(10);
    toast(`放进了 ${ids.length} 穗示例（标着「示例」），随时一键清掉`);
  }
  async function dropSamples(again = false) {
    const r = await clearSamples();
    if (again) {
      await addSamples(10);
      toast('换了一批示例');
    } else toast(`清掉了 ${r.items} 穗示例，只留你自己的`);
  }

  if (!items) return <Loading />;
  if (searching && devs) return <SearchView items={items} devs={devs} onClose={() => setSearching(false)} />;
  const own = items.length - nSamples;
  const filtering = type !== 'all' || !!tag;

  if (items.length === 0) {
    return (
      <section className="view library empty-lib">
        <DisplayTitle title="穗仓" count={0} />
        <div className="empty">
          <WordReveal className="lead" text="穗仓还是空的" />
          <p className="meta-text">看到喜欢的，就顺手拾一穗：一首歌、一部电影、一张图、一句话。</p>
          <ol className="steps3">
            <li>
              <span className="numeral">01</span>
              <b>随手拾</b>
              <span>{desktop ? '顶栏的「随手拾一穗」，回车即存' : '底部「随手拾一穗」，回车即存'}</span>
            </li>
            <li>
              <span className="numeral">02</span>
              <b>粘贴链接</b>
              <span>自动认出歌、电影、文章</span>
            </li>
            <li>
              <span className="numeral">03</span>
              <b>导入</b>
              <span>设置 → 备份与导入</span>
            </li>
          </ol>
          <div className="actions">
            <button className="btn primary" onClick={openCapture}>
              拾第一穗
            </button>
            <button className="btn text" onClick={loadSamples}>
              先放点示例
            </button>
          </div>
        </div>
      </section>
    );
  }

  const notesEl = !filtering ? (
        <div className="lib-notes">
          <DailyCard items={items} />
          {nSamples > 0 && (
            <div className="samples-bar note-row">
              <span className="meta-text">
                穗仓里有 {nSamples} 穗示例{nSamples === items.length ? '，拾下自己的第一穗之后就可以清掉' : ''}
              </span>
              <span className="note-acts">
                <button className="btn text samples-clear" onClick={() => dropSamples()}>
                  清掉示例
                </button>
                <button className="btn text faint samples-again" onClick={() => dropSamples(true)}>
                  换一批
                </button>
              </span>
            </div>
          )}
          {backs.map((b) => (
            <div key={b.label} className="throwback note-row">
              <span className="label">{b.label}</span>
              <span className="tb-list">
                {b.items.slice(0, 3).map((it, i) => (
                  <span key={it.id}>
                    {i > 0 && <span className="dim"> / </span>}
                    <button className="linklike" onClick={() => openItem(it)}>
                      {displayTitle(it)}
                    </button>
                  </span>
                ))}
              </span>
              <button className="btn text" onClick={() => developFrom(b.items.map((i) => i.id!).filter(Boolean).slice(0, 3))}>
                拿去嫁接
              </button>
            </div>
          ))}
        </div>
      ) : null;
  const title = tag ? `#${tag}` : '穗仓';
  const count = tag ? filtered.length : own > 0 || nSamples === 0 ? own : 0;
  return (
    <section className="view library">
      <DisplayTitle
        title={title}
        count={count}
        extra={nSamples > 0 ? <span className="title-note">示例 ({nSamples}) 不计数</span> : null}
        aside={
          <div className="page-tools">
            <Seg id="libview" className="view-switch" label="视图" value={lv} options={VIEWS} onPick={pickView} />
            <button className="search-toggle" onClick={() => setSearching(true)} title="搜索（/ 或 Ctrl+K）">
              <IconSearch size={16} />
              <span>搜索</span>
            </button>
          </div>
        }
      />
      <div className="lib-layout">
        <div className="lib-main">
      <div className="chips scroll filter-row" role="toolbar" aria-label="类型">
        <button className={`chip${type === 'all' ? ' on' : ''}`} onClick={() => setType('all')}>
          全部 <span className="n">({items.length})</span>
        </button>
        {TYPE_ORDER.filter((t) => typeN.get(t)).map((t) => (
          <button key={t} className={`chip${type === t ? ' on' : ''}`} onClick={() => setType(type === t ? 'all' : t)}>
            {TYPE_LABEL[t]} <span className="n">({typeN.get(t)})</span>
          </button>
        ))}
        {tag && (
          <button className="chip on tag-chip" onClick={() => setTag(null)}>
            #{tag} ✕
          </button>
        )}
      </div>

          {!desktop && notesEl}
      {filtered.length === 0 ? (
        <div className="empty small">
          <p className="meta-text">没找到这一穗。</p>
        </div>
      ) : lv === 'list' ? (
        <ListView items={filtered} q={q} onOpen={openItem} desktop={desktop} />
      ) : lv === 'timeline' ? (
        <Timeline items={filtered} q={q} onOpen={openItem} />
      ) : lv === 'calendar' ? (
        <MonthCalendar items={filtered} onOpen={openItem} />
      ) : (
        <VirtualMasonry<Item>
          items={filtered}
          keyOf={(it) => it.id!}
          estimate={(_it, w) => Math.round(w * 1.25)}
          cellStyle={cellStyle}
          render={(it) => <ItemCard item={it} onOpen={openItem} q={q || undefined} />}
        />
      )}
        </div>
        {desktop ? (
          <aside className="lib-rail" aria-label="今天">
            {notesEl}
            <TagCloud items={items} onPick={setTag} active={tag} />
          </aside>
        ) : (
          <TagCloud items={items} onPick={setTag} active={tag} />
        )}
      </div>
    </section>
  );
}

/** 列表：无线表格，表头下一条 1px 黑线；桌面悬停时行标题右移 + 光标旁预览图 */
function ListView({ items, q, onOpen, desktop }: { items: Item[]; q: string; onOpen: (i: Item) => void; desktop: boolean }) {
  const [hov, setHov] = useState<{ it: Item; x: number; y: number } | null>(null);
  const onHover = useCallback((it: Item | null, e?: React.PointerEvent) => setHov(it && e && itemHasImage(it) ? { it, x: e.clientX, y: e.clientY } : null), []);
  return (
    <div className="table list-view">
      <div className="thead" aria-hidden>
        <span className="tc tc-title">穗</span>
        <span className="tc tc-type">类型</span>
        <span className="tc tc-src">来源</span>
        <span className="tc tc-tags">标签</span>
        <span className="tc tc-date">日期</span>
      </div>
      <VirtualList
        className="tbody"
        rowClassName="trow-wrap"
        gap={0}
        items={items}
        keyOf={(it) => it.id!}
        estimate={() => (desktop ? 64 : 44)}
        threshold={60}
        render={(it) => <ItemRow item={it} onOpen={onOpen} q={q || undefined} onHover={desktop ? onHover : undefined} />}
      />
      {hov && <HoverPreview item={hov.it} x={hov.x} y={hov.y} />}
    </div>
  );
}

function TlThumb({ it }: { it: Item }) {
  const src = useThumbSrc(it);
  return src ? <img className="tl-thumb" src={src} alt="" decoding="async" /> : <span className="tl-thumb empty" aria-hidden />;
}

/** 时间线：按周成带，左边周标与条数，右边当周的穗（时间 · 标题 · 类型 · 缩略图） */
function Timeline({ items, q, onOpen }: { items: Item[]; q: string; onOpen: (i: Item) => void }) {
  const weeks = useMemo(() => groupByWeek(items), [items]);
  return (
    <VirtualList
      className="timeline"
      rowClassName="tl-day"
      gap={0}
      items={weeks}
      keyOf={(g) => g.key}
      estimate={(g) => 48 + g.items.length * 64}
      render={(g) => (
        <>
          <div className="tl-date">
            <span className="tl-week num">{g.label}</span>
            <span className="tl-n">{g.items.length} 穗</span>
          </div>
          <div className="tl-strip">
            {g.items.map((it) => {
              const d = new Date(it.createdAt);
              return (
                <button key={it.id} className="tl-frame" data-item-id={it.id} onClick={() => onOpen(it)}>
                  <span className="tl-time num">
                    {String(d.getMonth() + 1).padStart(2, '0')}/{String(d.getDate()).padStart(2, '0')} {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
                  </span>
                  <span className="tl-main">
                    <span className="tl-title">
                      <Hits text={displayTitle(it)} q={q || undefined} />
                    </span>
                    <span className="tl-meta">
                      {TYPE_LABEL[it.type]}
                      {it.creator ? ` · ${it.creator}` : ''}
                      {it.tags.length ? ` · ${it.tags.slice(0, 2).map((t) => '#' + t).join(' ')}` : ''}
                    </span>
                  </span>
                  {itemHasImage(it) ? <TlThumb it={it} /> : <span className="tl-thumb none" aria-hidden />}
                </button>
              );
            })}
          </div>
        </>
      )}
    />
  );
}

/** 收集月历：有穗的日子黑格，点一天列出那天的穗。没有分数、没有连续天数 */
function MonthCalendar({ items, onOpen }: { items: Item[]; onOpen: (i: Item) => void }) {
  const months = useMemo(() => {
    const now = new Date();
    const list = activeMonths(items);
    if (!list.some(([y, m]) => y === now.getFullYear() && m === now.getMonth())) list.unshift([now.getFullYear(), now.getMonth()]);
    return list.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  }, [items]);
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [y, m] = months[Math.min(idx, months.length - 1)];
  const g = useMemo(() => monthGrid(items, y, m), [items, y, m]);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dayItems = sel ? items.filter((i) => {
    const d = new Date(i.createdAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === sel;
  }) : [];
  const prev = months[idx + 1];
  const next = idx > 0 ? months[idx - 1] : null;
  const mName = (p: [number, number]) => monthGrid([], p[0], p[1]).label;
  return (
    <div className="calendar">
      <div className="cal-head">
        <h2 className="cal-title">
          {g.label} <span className="count">({g.total})</span>
          {y !== today.getFullYear() && <span className="cal-year num"> {y}</span>}
        </h2>
        <div className="cal-nav">
          <button className="btn text" disabled={!prev} onClick={() => (setIdx(idx + 1), setSel(null))}>
            ← {prev ? mName(prev) : ''}
          </button>
          <button className="btn text" disabled={!next} onClick={() => (setIdx(idx - 1), setSel(null))}>
            {next ? mName(next) : ''} →
          </button>
        </div>
      </div>
      <div className="cal-grid" role="grid" aria-label={`${y} 年 ${g.label}`}>
        {WEEK.map((w) => (
          <span key={w} className="cal-wd" aria-hidden>
            {w}
          </span>
        ))}
        {g.cells.map((c) =>
          c.day === 0 ? (
            <span key={c.key} className="cal-cell pad" aria-hidden />
          ) : (
            <button
              key={c.key}
              role="gridcell"
              className={`cal-cell${c.count ? ' has' : ''}${sel === c.key ? ' sel' : ''}${c.key === todayKey ? ' today' : ''}`}
              aria-label={`${c.key}，${c.count} 穗`}
              onClick={() => setSel(sel === c.key ? null : c.key)}
            >
              <span className="num">{c.day}</span>
            </button>
          ),
        )}
      </div>
      <p className="cal-legend meta-text">
        <i className="cal-swatch has" /> 有穗 <i className="cal-swatch" /> 没有
      </p>
      {sel && (
        <div className="cal-day">
          <div className="label">
            {sel.slice(5).replace('-', '/')} · {dayItems.length} 穗
          </div>
          {dayItems.length === 0 ? (
            <p className="meta-text">这天没有拾穗。</p>
          ) : (
            dayItems.map((it) => <ItemRow key={it.id} item={it} onOpen={onOpen} />)
          )}
        </div>
      )}
    </div>
  );
}

function TagCloud({ items, onPick, active }: { items: Item[]; onPick: (t: string | null) => void; active: string | null }) {
  const top = useMemo(() => tagCounts(items), [items]);
  if (!top.length) return null;
  return (
    <footer className="tagcloud">
      <div className="label">标签</div>
      <div className="tag-row">
        {top.map(([t, n]) => (
          <button key={t} className={`tag btnlike${active === t ? ' on' : ''}`} onClick={() => onPick(active === t ? null : t)}>
            {t} <span className="n">{n}</span>
          </button>
        ))}
      </div>
    </footer>
  );
}
