import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { DecodeText, TypeReveal } from './Motion';
import { db } from '../lib/db';
import { useApp } from '../lib/store';
import type { Development, Idea, Item } from '../lib/types';

const cleanTitle = (t: string) => `《${t.replace(/^《|》$/g, '')}》`;

/** 一根新枝（嫁接的结果） */
export function IdeaCard({ idea, source, devId, animate }: { idea: Idea; source: 'ai' | 'offline'; devId?: number; animate?: boolean }) {
  const { toast } = useApp();
  const dev = useLiveQuery(() => (devId ? db.developments.get(devId) : undefined), [devId]);
  const srcItems = useLiveQuery(async () => (dev ? (await db.items.bulkGet(dev.itemIds)).filter(Boolean) : []), [dev?.id]);
  async function copy() {
    const t = `${idea.title}\n\n${idea.bridge}\n\n${idea.idea}${idea.form ? `\n\n形式：${idea.form}` : ''}${idea.firstStep ? `\n第一步：${idea.firstStep}` : ''}`;
    try {
      await navigator.clipboard.writeText(t);
      toast('已复制');
    } catch {
      toast('复制失败，请长按选择文字', 'err');
    }
  }
  return (
    <article className="paper idea">
      <div className="idea-meta">
        <span className="kicker">新枝{dev ? ` · ${new Date(dev.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        <span className="idea-src">{source === 'ai' ? 'AI 嫁接' : '离线嫁接'}</span>
      </div>
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
      {idea.firstStep && (
        <p className="idea-step">
          <span className="label-inline">第一步</span> {idea.firstStep}
        </p>
      )}
      {idea.oblique && <p className="idea-oblique">斜策略：{idea.oblique}</p>}
      {srcItems && srcItems.length > 0 && (
        <div className="provenance">
          <span className="label">来自你拾的穗</span>
          <div className="tags">
            {srcItems.map((it) => (
              <span key={it!.id} className="tag">
                {it!.title}
              </span>
            ))}
          </div>
        </div>
      )}
      {idea.cliches.length > 0 && (
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
