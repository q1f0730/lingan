import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { DisplayTitle, Loading } from '../components/DisplayTitle';
import { GraftTrail, HistoryRow } from '../components/IdeaCard';
import { db } from '../lib/db';
import { groupBranches } from '../lib/branches';
import { transformName } from '../lib/graft';
import { evidenceOf, sourceIds, splitMentions } from '../lib/provenance';
import { nn } from '../lib/studio';
import { FOCUS_BRANCH_KEY } from '../lib/search';
import { useApp } from '../lib/store';
import type { Development, Item } from '../lib/types';

const MODE_KEY = 'glean.branchview';

/** 新枝（m26 / d13）：每一次嫁接按批次成捆；「宣言」是黑主题大字视图（d2 Manifesto），一次看一根 */
export function Branches() {
  const { go, toast } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const history = useLiveQuery(() => db.developments.orderBy('createdAt').reverse().toArray(), []);
  const [starred, setStarred] = useState(false);
  // v0.17 从搜索结果点进来：展开那一根并滚过去（宣言视图先切回列表）
  const [focusId] = useState<number | null>(() => {
    try {
      const v = sessionStorage.getItem(FOCUS_BRANCH_KEY);
      if (v) sessionStorage.removeItem(FOCUS_BRANCH_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState<'list' | 'manifesto'>(() => (!focusId && localStorage.getItem(MODE_KEY) === 'manifesto' ? 'manifesto' : 'list'));
  const byId = useMemo(() => new Map((items || []).map((i) => [i.id!, i])), [items]);
  const groups = useMemo(() => groupBranches(history || []), [history]);
  // v0.20：宣言只是一张深墨色大卡（卡内用黑主题 token），不再把整页换成黑
  if (!history || !items) return <Loading />;
  const nStar = history.filter((h) => h.starred).length;
  const shown = starred ? groups.map((g) => ({ ...g, devs: g.devs.filter((d) => d.starred) })).filter((g) => g.devs.length) : groups;
  const pick = (m: 'list' | 'manifesto') => {
    setMode(m);
    localStorage.setItem(MODE_KEY, m);
  };
  return (
    <section className="view branches">
      <DisplayTitle
        title="新枝"
        count={history.length}
        sub={history.length ? `${groups.length} 次嫁接${nStar ? ` · 留下 ${nStar} 根` : ''}` : undefined}
        aside={
          history.length ? (
            <div className="view-switch" role="tablist" aria-label="视图">
              <button role="tab" aria-selected={mode === 'list'} className={mode === 'list' ? 'on' : ''} onClick={() => pick('list')}>
                列表
              </button>
              <span className="sep" aria-hidden>
                |
              </span>
              <button role="tab" aria-selected={mode === 'manifesto'} className={`manifesto-toggle${mode === 'manifesto' ? ' on' : ''}`} onClick={() => pick('manifesto')}>
                宣言
              </button>
            </div>
          ) : null
        }
      />
      {history.length === 0 ? (
        <div className="empty">
          <h2 className="lead">还没有新枝</h2>
          <p className="meta-text">把几穗相距很远的东西嫁接在一起，一次长出三根，都会留在这里。</p>
          <button className="btn primary" onClick={() => go('develop')}>
            去嫁接
          </button>
        </div>
      ) : mode === 'manifesto' ? (
        <Manifesto groups={groups} byId={byId} />
      ) : (
        <>
          <div className="filters chips filter-row">
            <button className={`chip${!starred ? ' on' : ''}`} onClick={() => setStarred(false)}>
              全部 <span className="n">({history.length})</span>
            </button>
            <button className={`chip${starred ? ' on' : ''}`} onClick={() => setStarred((x) => !x)} aria-pressed={starred}>
              只看留下的 <span className="n">({nStar})</span>
            </button>
          </div>
          <div className="history">
            {shown.map((g) =>
              g.devs.length === 1 && !g.batch ? (
                <div key={g.key} className="hbatch single">
                  <HistoryRow dev={g.devs[0]} byId={byId} index={0} focus={g.devs[0].id === focusId} />
                </div>
              ) : (
                <div key={g.key} className="hbatch" data-size={g.devs.length}>
                  <div className="hbatch-head">
                    <span className="label">
                      {new Date(g.devs[0].createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {g.devs.length} 根
                    </span>
                    <span className="hbatch-src meta-text">{g.devs[0].itemIds.map((id) => byId.get(id)?.title || '（已删除）').join(' / ')}</span>
                    {!starred && (
                      <button
                        className="btn text hbatch-star"
                        onClick={async () => {
                          const all = g.devs.every((d) => d.starred);
                          await db.developments.bulkUpdate(g.devs.map((d) => ({ key: d.id!, changes: { starred: !all } })));
                          toast(all ? '这一捆都不留了' : '三根都留下了');
                        }}
                      >
                        {g.devs.every((d) => d.starred) ? '三根都已留下' : '三根都留下'}
                      </button>
                    )}
                  </div>
                  {g.devs.map((d, i) => (
                    <HistoryRow key={d.id} dev={d} byId={byId} index={d.batch?.index ?? i} focus={d.id === focusId} />
                  ))}
                  {g.batch && <GraftTrail batch={g.batch} names={g.devs[0].itemIds.map((id) => byId.get(id)?.title || '（已删除）')} />}
                </div>
              ),
            )}
            {shown.length === 0 && <div className="empty small meta-text">还没有留下的新枝。</div>}
          </div>
        </>
      )}
    </section>
  );
}

/** 宣言：黑底、居中、最大宽 1000px；新枝 01 / 03 → 大字（提到的穗用细体）→ 因为这几穗 → 动作；底部页码 */
function Manifesto({ groups, byId }: { groups: ReturnType<typeof groupBranches>; byId: Map<number, Item> }) {
  const { developFrom, toast, openItem, confirm } = useApp();
  const [gi, setGi] = useState(0);
  const [bi, setBi] = useState(0);
  const g = groups[Math.min(gi, groups.length - 1)];
  const dev: Development | undefined = g?.devs[Math.min(bi, g.devs.length - 1)];
  useEffect(() => setBi(0), [gi]);
  if (!g || !dev) return null;
  const ids = sourceIds(dev, dev.idea);
  const srcs = ids.map((id) => byId.get(id)).filter(Boolean) as Item[];
  const line = manifestoLine(dev.idea.idea);
  const segs = splitMentions(line, srcs);
  const weak = evidenceOf(dev, dev.idea) === 'weak';
  return (
    <div className="manifesto" data-theme="dark">
      <div className="mf-inner">
        <div className="label mf-k">
          新枝 {nn(dev.batch?.index ?? bi)} / {String(g.devs.length).padStart(2, '0')} · {dev.idea.title.replace(/^《|》$/g, '')}
          {dev.idea.transform ? ` · ${transformName(dev.idea.transform)}` : ''}
          {weak ? ' · 证据不足' : ''}
        </div>
        <p className="mf-text">
          {segs.map((s, i) =>
            s.id ? (
              <span key={i} className="mf-em">
                {s.text}
              </span>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
        <div className="mf-src">
          <span className="label">因为这几穗</span>
          <span>
            {srcs.length ? (
              srcs.map((it, i) => (
                <span key={it.id}>
                  {i > 0 && ' / '}
                  <button className="linklike" onClick={() => openItem(it)}>
                    {it.title}
                  </button>
                </span>
              ))
            ) : (
              <span className="dim">说不清从哪几穗长出来</span>
            )}
          </span>
        </div>
        <div className="actions text-actions">
          <button className="btn text strong" onClick={() => db.developments.update(dev.id!, { starred: !dev.starred })}>
            {dev.starred ? '已留下' : '留下'}
          </button>
          <button className="btn text" onClick={() => developFrom(dev.itemIds.filter((x) => x > 0))}>
            再接一次
          </button>
          <button
            className="btn text faint"
            onClick={async () => {
              if (await confirm({ title: '不要这根新枝？', ok: '不要了', cancel: '留着', danger: true })) {
                await db.developments.delete(dev.id!);
                toast('已删掉这根新枝');
              }
            }}
          >
            不要
          </button>
        </div>
      </div>
      <footer className="mf-foot">
        <span className="label">© 2026 Q1f730</span>
        <span className="mf-batch">
          <button className="btn text" disabled={gi >= groups.length - 1} onClick={() => setGi(gi + 1)}>
            ← 上一捆
          </button>
          <span className="mf-pages">
            {g.devs.map((d, i) => (
              <button key={d.id} className={i === bi ? 'on' : ''} onClick={() => setBi(i)} aria-label={`第 ${i + 1} 根`}>
                {nn(i)}
              </button>
            ))}
          </span>
          <button className="btn text" disabled={gi <= 0} onClick={() => setGi(gi - 1)}>
            下一捆 →
          </button>
        </span>
      </footer>
    </div>
  );
}

/** 宣言只放一句：取第一句（到第一个句号 / 问号 / 叹号），太长就截断 */
export function manifestoLine(t: string, max = 64): string {
  const s = (t || '').trim();
  const m = s.match(/^[^。！？!?]*[。！？!?]/);
  const first = m ? m[0] : s;
  return first.length > max ? first.slice(0, max - 1) + '…' : first;
}
