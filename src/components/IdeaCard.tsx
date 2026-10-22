import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { DecodeText, TypeReveal } from './Motion';
import { db } from '../lib/db';
import { useApp } from '../lib/store';
import { transformName } from '../lib/graft';
import type { Development, GraftBatch, Idea, Item } from '../lib/types';

const cleanTitle = (t: string) => `《${t.replace(/^《|》$/g, '')}》`;

/** 一根新枝（嫁接的结果） */
export function IdeaCard({ idea, source, devId, animate, index, hideCliches }: { idea: Idea; source: 'ai' | 'offline'; devId?: number; animate?: boolean; index?: number; hideCliches?: boolean }) {
  const { toast } = useApp();
  const dev = useLiveQuery(() => (devId ? db.developments.get(devId) : undefined), [devId]);
  const srcItems = useLiveQuery(async () => {
    if (!dev) return [];
    const ids = idea.refs?.length ? idea.refs.map((r) => dev.itemIds[r - 1]).filter((x) => typeof x === 'number') : dev.itemIds;
    return (await db.items.bulkGet(ids.length ? ids : dev.itemIds)).filter(Boolean);
  }, [dev?.id, idea.refs?.join(',')]);
  async function copy() {
    const t = [
      idea.title,
      idea.transform ? `变形：${transformName(idea.transform)}` : '',
      idea.bridge,
      idea.idea,
      idea.form ? `形式：${idea.form}` : '',
      idea.unlike ? `和另外两根不同：${idea.unlike}` : '',
      idea.experiment ? `20 分钟小实验：${idea.experiment}` : idea.firstStep ? `第一步：${idea.firstStep}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(t);
      toast('已复制');
    } catch {
      toast('复制失败，请长按选择文字', 'err');
    }
  }
  return (
    <article className="paper idea" data-transform={idea.transform || undefined}>
      <div className="idea-meta">
        <span className="kicker">
          {typeof index === 'number' ? `第 ${index + 1} 根` : '新枝'}
          {dev && typeof index !== 'number' ? ` · ${new Date(dev.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <span className="idea-src">{source === 'ai' ? 'AI 嫁接' : '离线嫁接'}</span>
      </div>
      {idea.transform && <div className="idea-transform">变形 · {transformName(idea.transform)}</div>}
      <h2 className="idea-title">{animate ? <DecodeText text={cleanTitle(idea.title)} ms={1100} /> : cleanTitle(idea.title)}</h2>
      {idea.form && <div className="idea-form">形式 · {idea.form}</div>}
      {idea.bridge && (
        <div className="idea-bridge">
          <div className="label">嫁接点</div>
          {idea.bridge}
        </div>
      )}
      <div className="label">长出来的</div>
      {animate ? <TypeReveal className="idea-body" text={idea.idea} /> : <p className="idea-body">{idea.idea}</p>}
      {idea.unlike && (
        <p className="idea-unlike">
          <span className="label-inline">和另外两根不同</span>
          {idea.unlike}
        </p>
      )}
      {idea.experiment ? (
        <div className="idea-exp">
          <div className="label">20 分钟小实验</div>
          {idea.experiment}
        </div>
      ) : (
        idea.firstStep && (
          <p className="idea-step">
            <span className="label-inline">第一步</span> {idea.firstStep}
          </p>
        )
      )}
      {idea.oblique && <p className="idea-oblique">斜策略：{idea.oblique}</p>}
      {srcItems && srcItems.length > 0 && (
        <div className="provenance">
          <span className="label">因为这几穗</span>
          <div className="tags">
            {srcItems.map((it) => (
              <span key={it!.id} className="tag">
                {it!.title}
              </span>
            ))}
          </div>
        </div>
      )}
      {!hideCliches && idea.cliches.length > 0 && (
        <div className="cliches">
          <div className="label">剪掉的旧枝（套路）</div>
          <ul>
            {idea.cliches.map((c, i) => (
              <li key={i}>
                <s>{c}</s>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        <button className="btn ghost small" onClick={copy}>
          复制
        </button>
        {devId && (
          <button className="btn ghost small" onClick={() => db.developments.update(devId, { starred: !dev?.starred })}>
            {dev?.starred ? '★ 已收藏' : '☆ 收藏'}
          </button>
        )}
      </div>
    </article>
  );
}

export function HistoryRow({ dev, byId }: { dev: Development; byId: Map<number, Item> }) {
  const [open, setOpen] = useState(false);
  const { toast } = useApp();
  const names = dev.itemIds.map((id) => byId.get(id)?.title || '（已删除）');
  return (
    <div className={`paper hrow${open ? ' open' : ''}`}>
      <button className="hrow-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="hrow-when">{new Date(dev.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        <span className="hrow-title">
          {dev.starred ? '★ ' : ''}
          {dev.idea.title}
          {dev.idea.transform && <span className="hrow-t">{transformName(dev.idea.transform)}</span>}
        </span>
        <span className="hrow-src">{names.join(' × ')}</span>
      </button>
      {open && (
        <div className="hrow-body">
          <IdeaCard idea={dev.idea} source={dev.source} devId={dev.id} />
          <button
            className="btn ghost small danger"
            onClick={async () => {
              if (confirm('删除这根新枝？')) {
                await db.developments.delete(dev.id!);
                toast('已删除');
              }
            }}
          >
            删除这根新枝
          </button>
        </div>
      )}
    </div>
  );
}

/** 四步嫁接的中间产物：张力、八粒种子（哪几粒被换过、哪三粒长成了新枝）、找到的套路 */
export function GraftTrail({ batch, names }: { batch: GraftBatch; names: string[] }) {
  if (!batch.tensions?.length && !batch.seeds?.length) return null;
  const nm = (refs: number[]) => refs.map((r) => names[r - 1]).filter(Boolean).join(' · ');
  return (
    <details className="paper trail">
      <summary>看看它们是怎么长出来的：{batch.tensions?.length || 0} 个张力 · {batch.seeds?.length || 0} 粒种子</summary>
      {!!batch.tensions?.length && (
        <>
          <div className="label">张力</div>
          <ol className="trail-tensions">
            {batch.tensions.map((t, i) => (
              <li key={i}>
                {t.text}
                {t.refs.length > 0 && <span className="trail-refs">{nm(t.refs)}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
      {!!batch.seeds?.length && (
        <>
          <div className="label">种子</div>
          <ol className="trail-seeds">
            {batch.seeds.map((s, i) => (
              <li key={i} className={`${s.chosen ? 'chosen' : ''}${s.replaced ? ' replaced' : ''}`}>
                <span className="trail-t">{transformName(s.transform)}</span>
                {s.text}
                {s.replaced && <span className="trail-badge">换过</span>}
                {s.chosen && <span className="trail-badge on">长成新枝</span>}
              </li>
            ))}
          </ol>
        </>
      )}
      {batch.pattern && <p className="trail-pattern">换掉的原因：{batch.pattern}</p>}
    </details>
  );
}
