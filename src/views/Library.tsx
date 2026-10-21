import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { ItemCard } from '../components/ItemCard';
import { addItem, db } from '../lib/db';
import { SAMPLES } from '../lib/samples';
import { itemText } from '../lib/similarity';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER, type ItemType } from '../lib/types';

export function Library() {
  const { openItem, openCapture, toast } = useApp();
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray(), []);
  const [q, setQ] = useState('');
  const [type, setType] = useState<ItemType | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!items) return [];
    const k = q.trim().toLowerCase();
    return items.filter((i) => (type === 'all' || i.type === type) && (!tag || i.tags.includes(tag)) && (!k || itemText(i).toLowerCase().includes(k)));
  }, [items, q, type, tag]);

  async function loadSamples() {
    for (const s of SAMPLES) await addItem(s);
    toast('已放入 10 件示例素材，可以随时删除');
  }

  if (!items) return <div className="loading mono">冲洗中…</div>;

  return (
    <section className="view">
      <header className="roll-head">
        <span className="roll-ic" aria-hidden>◉</span>
        <h1>
          灵感库 <span className="mono roll-no">ROLL #{String(Math.floor(items.length / 36) + 1).padStart(2, '0')} / 36 EXP</span>
        </h1>
        <span className="rec mono">○ REC</span>
      </header>
      <div className="strip mono">
        <span className="red">LINGAN TRI-X 400</span>
        <span>· {items.length} ITEMS</span>
        <span className="strip-date">{new Date().toLocaleDateString('zh-CN').replace(/\//g, '.')}</span>
      </div>
      <div className="search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题、作者、句子、标签…" aria-label="搜索" />
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
        {tag && (
          <button className="chip on red" onClick={() => setTag(null)}>
            #{tag} ✕
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <div className="empty-frame mono">№ 000</div>
          <h2>暗房还是空的</h2>
          <p>收进第一件打动你的东西：一首歌、一部电影、一张图、一句话。</p>
          <div className="actions center">
            <button className="btn primary" onClick={openCapture}>
              收集第一件
            </button>
            <button className="btn ghost" onClick={loadSamples}>
              先放点示例
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty small">
          <p>没有匹配的素材。</p>
        </div>
      ) : (
        <div className="masonry">
          {filtered.map((it) => (
            <div key={it.id} className="masonry-cell">
              <ItemCard item={it} onOpen={openItem} />
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="ruler mono" aria-hidden>
          <div className="ruler-ticks" />
          <div className="ruler-labels">
            <span>FRAME 01</span>
            <span className="red">CURRENT: EXP {String(items.length % 36 || 36).padStart(2, '0')}</span>
            <span>FRAME 36 END</span>
          </div>
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
    <footer className="tagcloud">
      <div className="kicker mono">CONTACT SHEET · 标签</div>
      <div className="tags">
        {top.map(([t, n]) => (
          <button key={t} className="tag btnlike" onClick={() => onPick(t)}>
            #{t} <span className="mono dim">{n}</span>
          </button>
        ))}
      </div>
    </footer>
  );
}
