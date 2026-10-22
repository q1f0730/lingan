import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type CSSProperties } from 'react';
import { AsciiEmpty, AsciiLoader } from '../components/AsciiDevelop';
import { ItemCard } from '../components/ItemCard';
import { PageTitle } from '../components/PageTitle';
import { QuickBar } from '../components/QuickBar';
import { addItem, db } from '../lib/db';
import { SAMPLES } from '../lib/samples';
import { staggerDelay } from '../lib/motion';
import { groupByDay, throwbacks } from '../lib/memory';
import { PHASE_LABEL, PHASE_WHISPER } from '../lib/phases';
import { itemText } from '../lib/similarity';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER, type ItemType } from '../lib/types';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function Library() {
  const { openItem, openCapture, toast, developFrom, phase } = useApp();
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray(), []);
  const [q, setQ] = useState('');
  const [type, setType] = useState<ItemType | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [timeline, setTimeline] = useState(false);

  const filtered = useMemo(() => {
    if (!items) return [];
    const k = q.trim().toLowerCase();
    return items.filter((i) => (type === 'all' || i.type === type) && (!tag || i.tags.includes(tag)) && (!k || itemText(i).toLowerCase().includes(k)));
  }, [items, q, type, tag]);

  const backs = useMemo(() => (items ? throwbacks(items) : []), [items]);
  const days = useMemo(() => (timeline ? groupByDay(filtered) : []), [timeline, filtered]);
  const now = new Date();
  const todayN = items ? items.filter((i) => new Date(i.createdAt).toDateString() === now.toDateString()).length : 0;

  async function loadSamples() {
    for (const s of SAMPLES) await addItem(s);
    toast('放进了 10 穗示例，随时可以删');
  }

  if (!items) return <AsciiLoader />;

  return (
    <section className="view">
      <PageTitle title="穗仓" whisper={PHASE_WHISPER[phase]} />
      <p className="dateline">
        {now.getMonth() + 1}月{now.getDate()}日 · 周{WEEK[now.getDay()]} · {PHASE_LABEL[phase]}
        {items.length > 0 && (
          <>
            {' '}· 共 {items.length} 穗{todayN > 0 ? `，今天拾了 ${todayN}` : ''}
          </>
        )}
      </p>
      <QuickBar />
      {backs.map((b) => (
        <div key={b.label} className="paper throwback">
          <div className="kicker">{b.label}</div>
          <ul>
            {b.items.slice(0, 3).map((it) => (
              <li key={it.id}>
                <button className="btnlike" onClick={() => openItem(it)}>
                  {it.title || '无题'}
                </button>
              </li>
            ))}
          </ul>
          <button className="btn ghost small" onClick={() => developFrom(b.items.map((i) => i.id!).filter(Boolean).slice(0, 3))}>
            拿去嫁接
          </button>
        </div>
      ))}
      {items.length > 0 && (
        <div className="paper filters">
          <div className="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="找一找：标题、作者、句子、标签…" aria-label="搜索" />
            {q && (
              <button className="icon-btn" onClick={() => setQ('')} aria-label="清除搜索">
                ✕
              </button>
            )}
          </div>
          <div className="chips scroll">
            <button className={`chip${type === 'all' ? ' on' : ''}`} onClick={() => setType('all')}>
              全部
            </button>
            {TYPE_ORDER.map((t) => (
              <button key={t} className={`chip${type === t ? ' on' : ''}`} onClick={() => setType(t)}>
                {TYPE_LABEL[t]}
              </button>
            ))}
            <button className={`chip${timeline ? ' on' : ''}`} onClick={() => setTimeline((v) => !v)} aria-pressed={timeline}>
              时间线
            </button>
            {tag && (
              <button className="chip on" onClick={() => setTag(null)}>
                #{tag} ✕
              </button>
            )}
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <div className="paper empty">
          <AsciiEmpty />
          <h2>穗仓还是空的</h2>
          <p>拾第一穗打动你的东西：一首歌、一部电影、一张图、一句话。</p>
          <div className="actions center">
            <button className="btn primary" onClick={openCapture}>
              拾第一穗
            </button>
            <button className="btn ghost" onClick={loadSamples}>
              先放点示例
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="paper empty small">
          <p>田里没找到这一穗。</p>
        </div>
      ) : timeline ? (
        <div className="timeline">
          {days.map((g) => (
            <div key={g.key} className="tl-day">
              <div className="tl-date">
                <span>{g.key.slice(5).replace('-', ' 月 ')} 日</span>
                <span className="dim">{g.items.length} 穗</span>
              </div>
              <div className="tl-strip">
                {g.items.map((it) => (
                  <div key={it.id} className="tl-frame">
                    <ItemCard item={it} onOpen={openItem} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="masonry">
          {filtered.map((it, i) => (
            <div key={it.id} className="masonry-cell" style={{ '--i': staggerDelay(i, 60) } as CSSProperties}>
              <ItemCard item={it} onOpen={openItem} />
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && <TagCloud items={items.flatMap((i) => i.tags)} onPick={setTag} />}
    </section>
  );
}

function TagCloud({ items, onPick }: { items: string[]; onPick: (t: string) => void }) {
  const top = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of items) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  }, [items]);
  if (!top.length) return null;
  return (
    <footer className="paper tagcloud">
      <div className="kicker">常拾的标签</div>
      <div className="tags">
        {top.map(([t, n]) => (
          <button key={t} className="tag btnlike" onClick={() => onPick(t)}>
            #{t} <span className="dim">{n}</span>
          </button>
        ))}
      </div>
    </footer>
  );
}
