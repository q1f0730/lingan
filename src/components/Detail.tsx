import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { fromLocalInput, toLocalInput } from '../lib/quick';
import { useApp } from '../lib/store';
import { bookTitle, branchesFrom, displayTitle, quoteSource } from '../lib/studio';
import { TYPE_LABEL, type Item, type ItemType } from '../lib/types';
import { useOriginalSrc } from '../lib/useImage';
import { safeHost } from './ItemCard';

const CREATOR: Record<ItemType, string> = { music: '歌手', film: '导演', image: '来源', text: '作者', link: '来源', idea: '来源' };

/** 穗详情（m12–m16 / d6）：照片满铺，下面是一张无线信息表、为什么收、长进了这些新枝、文字动作 */
export function Detail({ it, onEdit, onDelete, onDevelop, onReAI, onWhen }: { it: Item; onEdit: () => void; onDelete: () => void; onDevelop: () => void; onReAI: () => void; onWhen: (ts: number) => void }) {
  const { toast, go } = useApp();
  const full = useOriginalSrc(it);
  const grown = useLiveQuery(async () => (it.id != null ? branchesFrom(await db.developments.toArray(), it.id) : []), [it.id]);
  const quote = it.type === 'text' && !!it.content;
  async function copy() {
    try {
      await navigator.clipboard.writeText(it.content || it.title);
      toast('已复制原文');
    } catch {
      toast('复制失败，请长按选择文字', 'err');
    }
  }
  return (
    <article className={`detail detail-${it.type}${full ? ' has-img' : ''}`}>
      {full && (
        <figure className="detail-figure">
          <img className="detail-img" src={full} alt={it.title} decoding="async" />
        </figure>
      )}
      <div className="detail-info">
        <div className="label detail-kicker">
          {it.sample ? '示例 · ' : ''}
          {TYPE_LABEL[it.type]}
        </div>
        {quote ? (
          <>
            <h2 className="detail-title quote">{displayTitle(it)}</h2>
            <p className="detail-src">— {quoteSource(it) || bookTitle(it.title)}</p>
          </>
        ) : (
          <h2 className="detail-title">{displayTitle(it)}</h2>
        )}
        <dl className="kv">
          <div>
            <dt>拾于</dt>
            <dd>
              <input
                type="datetime-local"
                className="when-input"
                aria-label="记录时间"
                defaultValue={toLocalInput(it.createdAt)}
                key={it.createdAt}
                onChange={(e) => {
                  const t = fromLocalInput(e.target.value);
                  if (t && Math.abs(t - it.createdAt) >= 60000) onWhen(t);
                }}
              />
            </dd>
          </div>
          {it.creator && !quote && (
            <div>
              <dt>{CREATOR[it.type]}</dt>
              <dd>{it.creator}</dd>
            </div>
          )}
          {quote && it.title && (
            <div>
              <dt>出处</dt>
              <dd>{bookTitle(it.title)}</dd>
            </div>
          )}
          {it.year && (
            <div>
              <dt>年份</dt>
              <dd className="num">{it.year}</dd>
            </div>
          )}
          {it.url && (
            <div>
              <dt>链接</dt>
              <dd>
                <a className="detail-url" href={it.url} target="_blank" rel="noreferrer">
                  {safeHost(it.url)}
                </a>
              </dd>
            </div>
          )}
          {it.tags.length > 0 && (
            <div>
              <dt>标签</dt>
              <dd className="tags">
                {it.tags.map((t) => (
                  <span key={t} className="tag">
                    #{t}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {it.embedding ? (
            <div>
              <dt>向量</dt>
              <dd className="dim">已向量化</dd>
            </div>
          ) : null}
        </dl>
        {it.content && !quote && (
          <section className="detail-sec">
            <div className="label">{it.type === 'idea' ? '展开' : '内容'}</div>
            <p className="detail-content">{it.content}</p>
          </section>
        )}
        {it.why && (
          <section className="detail-sec detail-why">
            <div className="label">为什么收</div>
            <p>{it.why}</p>
          </section>
        )}
        {it.caption && (
          <section className="detail-sec detail-caption">
            <div className="label">AI 看到的</div>
            <p>{it.caption}</p>
          </section>
        )}
        {!!grown?.length && (
          <section className="detail-sec detail-grown">
            <div className="label">长进了这些新枝 ({grown.length})</div>
            <ul className="plain">
              {grown.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <button className="linklike" onClick={() => go('branches')}>
                    {d.idea.title.replace(/^《|》$/g, '')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="actions text-actions">
          <button className="btn text strong detail-graft" onClick={onDevelop}>
            拿去嫁接
          </button>
          {it.url && (
            <a className="btn text" href={it.url} target="_blank" rel="noreferrer">
              打开链接
            </a>
          )}
          {quote && (
            <button className="btn text" onClick={copy}>
              复制原文
            </button>
          )}
          <button className="btn text" onClick={onEdit}>
            编辑
          </button>
          <button className="btn text" onClick={onReAI}>
            AI 重新整理
          </button>
          <button className="btn text faint danger" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
    </article>
  );
}
