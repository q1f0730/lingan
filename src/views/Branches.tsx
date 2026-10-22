import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { AsciiLoader } from '../components/AsciiDevelop';
import { GraftTrail, HistoryRow } from '../components/IdeaCard';
import { PageTitle } from '../components/PageTitle';
import { db } from '../lib/db';
import { groupBranches } from '../lib/branches';
import { useApp } from '../lib/store';

/** 新枝：每一次嫁接长出来的东西；v0.11 起一次三枝按「同一次嫁接」收成一捆 */
export function Branches() {
  const { go, toast } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const history = useLiveQuery(() => db.developments.orderBy('createdAt').reverse().toArray(), []);
  const [starred, setStarred] = useState(false);
  const byId = useMemo(() => new Map((items || []).map((i) => [i.id!, i])), [items]);
  const groups = useMemo(() => groupBranches(history || []), [history]);
  if (!history || !items) return <AsciiLoader text="去田里看看" />;
  const nStar = history.filter((h) => h.starred).length;
  const shown = starred ? groups.map((g) => ({ ...g, devs: g.devs.filter((d) => d.starred) })).filter((g) => g.devs.length) : groups;
  return (
    <section className="view">
      <PageTitle title="新枝" whisper="What grew from what you gathered" />
      {history.length === 0 ? (
        <div className="paper empty">
          <h2>还没有新枝</h2>
          <p>把几穗相距很远的东西嫁接在一起，一次长出三根，都会留在这里。</p>
          <button className="btn primary" onClick={() => go('develop')}>
            去嫁接
          </button>
        </div>
      ) : (
        <>
          <div className="paper filters row">
            <span className="dim">
              {history.length} 根新枝 · {groups.length} 次嫁接{nStar ? ` · 收藏 ${nStar}` : ''}
            </span>
            <button className={`chip${starred ? ' on' : ''}`} onClick={() => setStarred((x) => !x)} aria-pressed={starred}>
              ★ 只看收藏
            </button>
          </div>
          <div className="history">
            {shown.map((g) =>
              g.devs.length === 1 && !g.batch ? (
                <HistoryRow key={g.key} dev={g.devs[0]} byId={byId} />
              ) : (
                <div key={g.key} className="hbatch" data-size={g.devs.length}>
                  <div className="hbatch-head">
                    <span className="kicker">
                      一次三枝 · {new Date(g.devs[0].createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="hbatch-src">{g.devs[0].itemIds.map((id) => byId.get(id)?.title || '（已删除）').join(' × ')}</span>
                    {!starred && (
                      <button
                        className="btn ghost small hbatch-star"
                        onClick={async () => {
                          const all = g.devs.every((d) => d.starred);
                          await db.developments.bulkUpdate(g.devs.map((d) => ({ key: d.id!, changes: { starred: !all } })));
                          toast(all ? '已取消收藏这三根' : '三根都收藏了');
                        }}
                      >
                        {g.devs.every((d) => d.starred) ? '★ 三根都已收藏' : '☆ 三根都收藏'}
                      </button>
                    )}
                  </div>
                  {g.devs.map((d) => (
                    <HistoryRow key={d.id} dev={d} byId={byId} />
                  ))}
                  {g.batch && <GraftTrail batch={g.batch} names={g.devs[0].itemIds.map((id) => byId.get(id)?.title || '（已删除）')} />}
                </div>
              ),
            )}
            {shown.length === 0 && <div className="paper empty small">还没有收藏的新枝。</div>}
          </div>
        </>
      )}
    </section>
  );
}
