import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { AsciiLoader } from '../components/AsciiDevelop';
import { HistoryRow } from '../components/IdeaCard';
import { PageTitle } from '../components/PageTitle';
import { db } from '../lib/db';
import { useApp } from '../lib/store';

/** 新枝：每一次嫁接长出来的东西 */
export function Branches() {
  const { go } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const history = useLiveQuery(() => db.developments.orderBy('createdAt').reverse().toArray(), []);
  const [starred, setStarred] = useState(false);
  const byId = useMemo(() => new Map((items || []).map((i) => [i.id!, i])), [items]);
  if (!history || !items) return <AsciiLoader text="去田里看看" />;
  const list = history.filter((h) => !starred || h.starred);
  const nStar = history.filter((h) => h.starred).length;
  return (
    <section className="view">
      <PageTitle title="新枝" whisper="What grew from what you gathered" />
      {history.length === 0 ? (
        <div className="paper empty">
          <h2>还没有新枝</h2>
          <p>把两穗相距很远的东西嫁接在一起，长出来的会留在这里。</p>
          <button className="btn primary" onClick={() => go('develop')}>
            去嫁接
          </button>
        </div>
      ) : (
        <>
          <div className="paper filters row">
            <span className="dim">
              {history.length} 根新枝{nStar ? ` · 收藏 ${nStar}` : ''}
            </span>
            <button className={`chip${starred ? ' on' : ''}`} onClick={() => setStarred((x) => !x)} aria-pressed={starred}>
              ★ 只看收藏
            </button>
          </div>
          <div className="history">
            {list.map((h) => (
              <HistoryRow key={h.id} dev={h} byId={byId} />
            ))}
            {list.length === 0 && <div className="paper empty small">还没有收藏的新枝。</div>}
          </div>
        </>
      )}
    </section>
  );
}
