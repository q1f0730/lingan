import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef } from 'react';
import { db, findDupes, keepItems, reInbox, updateItem } from '../lib/db';
import { InlineText } from './InlineText';
import { basketHint, toggleBasket, useBasket } from '../lib/basket';
import { BUNDLE_EVENT, BUNDLE_OPEN_KEY, splitBundles, withBundles } from '../lib/bundles';
// v0.23 瘦首包：batch / organize 点到才加载（详情首屏不需要）
const batch = () => import('../lib/batch');
import { dupReason } from '../lib/dupe';
import { mergeDupe } from '../lib/dupnotice';
import { fromLocalInput, toLocalInput } from '../lib/quick';
import { useApp } from '../lib/store';
import { bookTitle, branchesFrom, displayTitle, quoteSource, shortDate } from '../lib/studio';
import { TYPE_LABEL, type Item, type ItemType } from '../lib/types';
import { useOriginalSrc } from '../lib/useImage';
import { safeHost } from './ItemCard';
import { clock, timeMark } from '../lib/platforms';

const CREATOR: Record<ItemType, string> = { music: '歌手', film: '导演', image: '来源', text: '作者', link: '来源', idea: '来源' };

/** 穗详情（m12–m16 / d6）：照片满铺，下面是一张无线信息表、为什么收、长进了这些新枝、文字动作 */
export function Detail({ it: it0, onEdit, onDelete, onDevelop, onReAI, onWhen, pos, onStep }: { it: Item; onEdit: () => void; onDelete: () => void; onDevelop: () => void; onReAI: () => void; onWhen: (ts: number) => void; pos?: { i: number; n: number }; onStep?: (dir: 1 | -1) => void }) {
  const { toast, go } = useApp();
  // v0.23 详情跟着库走：补了标签 / 留下 / 合并之后立刻刷新
  const live = useLiveQuery(() => (it0.id != null ? db.items.get(it0.id) : undefined), [it0.id]);
  const it = live && !live.deletedAt ? live : it0;
  const dupe = useLiveQuery(async () => (it.id != null ? (await findDupes(it.id))[0] || null : null), [it.id, (it.dup || []).join()]);
  const co = useLiveQuery(async () => (it.tags.length ? (await import('../lib/organize')).cooccur((await db.items.where('tags').anyOf(it.tags).distinct().toArray()).filter((x) => !x.deletedAt), it.tags, 3) : []), [it.tags.join()]);
  const sugg = useMemo(() => (it.tagSugg || []).filter((t) => !it.tags.includes(t)), [it.tagSugg, it.tags]);
  // 手机左右滑翻穗（0113）
  const sw = useRef<{ x: number; y: number } | null>(null);
  const full = useOriginalSrc(it);
  const grown = useLiveQuery(async () => (it.id != null ? branchesFrom((await db.developments.toArray()).filter((x) => !x.deletedAt), it.id) : []), [it.id]);
  const quote = it.type === 'text' && !!it.content;
  // v0.28 0408 待嫁接篮
  const basket = useBasket();
  const inBasket = it.id != null && basket.includes(it.id);
  const openBundle = (b: string) => {
    try {
      sessionStorage.setItem(BUNDLE_OPEN_KEY, b);
    } catch {
      /* 隐私模式 */
    }
    go('library');
    window.dispatchEvent(new CustomEvent(BUNDLE_EVENT, { detail: b }));
  };
  // v0.27 0409 点一下直接改：改了内容就让向量重算
  const save = async (patch: Partial<Item>) => {
    if (it.id == null) return;
    await updateItem(it.id, { ...patch, embedding: undefined, embedModel: undefined });
    toast('已保存');
  };
  async function copy() {
    try {
      await navigator.clipboard.writeText(it.content || it.title);
      toast('已复制原文');
    } catch {
      toast('复制失败，请长按选择文字', 'err');
    }
  }
  return (
    <article
      className={`detail detail-${it.type}${full ? ' has-img' : ''}`}
      onPointerDown={(e) => {
        if (onStep && e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('input,textarea')) sw.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s0 = sw.current;
        sw.current = null;
        if (!s0 || !onStep) return;
        const dx = e.clientX - s0.x;
        if (Math.abs(dx) > 70 && Math.abs(e.clientY - s0.y) < 50) onStep(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => (sw.current = null)}
    >
      {pos && pos.i >= 0 && onStep && (
        <nav className="detail-step" aria-label="上一穗 / 下一穗">
          <button className="btn text detail-prev" disabled={pos.i <= 0} onClick={() => onStep(-1)}>
            ← 上一穗
          </button>
          <span className="meta-text num">
            {pos.i + 1} / {pos.n}
          </span>
          <button className="btn text detail-next" disabled={pos.i >= pos.n - 1} onClick={() => onStep(1)}>
            下一穗 →
          </button>
        </nav>
      )}
      {full && (
        <figure className="detail-figure">
          <img className="detail-img" src={full} alt={it.title} decoding="async" />
        </figure>
      )}
      <div className="detail-info">
        <div className="label detail-kicker">
          {it.sample ? '示例 · ' : ''}
          {it.polarity === -1 ? '讨厌 · ' : ''}
          {it.private ? '私密 · ' : ''}
          {TYPE_LABEL[it.type]}
          {it.inbox ? ' · 待理' : ''}
        </div>
        {it.inbox ? (
          <div className="detail-inbox note-row">
            <span className="meta-text">还在待理：理好了就留下，它会进穗仓。</span>
            <button
              className="btn text strong detail-keep"
              onClick={async () => {
                await keepItems([it.id!]);
                toast('进了穗仓', 'ok', { label: '撤销', run: () => void reInbox([it.id!]) });
              }}
            >
              留下
            </button>
          </div>
        ) : null}
        {dupe ? (
          <div className="detail-dupe note-row">
            <span className="meta-text">
              {shortDate(dupe.createdAt)} 收过一穗{dupReason(it.dup, dupe.dup) ? `（${dupReason(it.dup, dupe.dup)}）` : ''}：「{displayTitle(dupe).slice(0, 18)}」
            </span>
            <button className="btn text strong dupe-merge" onClick={() => void mergeDupe(dupe.id!, it.id!, toast)}>
              合并进它
            </button>
          </div>
        ) : null}
        {quote ? (
          <>
            <h2 className="detail-title quote">
              <InlineText value={it.content || ''} label="原文" multiline allowEmpty={false} onSave={(v) => save({ content: v })}>
                {displayTitle(it)}
              </InlineText>
            </h2>
            <p className="detail-src">— {quoteSource(it) || (it.source ? `摘自${it.source}` : bookTitle(it.title))}</p>
          </>
        ) : (
          <h2 className="detail-title">
            <InlineText value={it.title} label="标题" allowEmpty={false} maxLength={120} onSave={(v) => save({ title: v })}>
              {displayTitle(it)}
            </InlineText>
          </h2>
        )}
        <dl className="kv">
          <div>
            <dt>{it.meets?.length ? '首次拾于' : '拾于'}</dt>
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
          {it.source && (
            <div className="kv-source">
              <dt>来自</dt>
              <dd>{it.source}</dd>
            </div>
          )}
          {quote && !it.creator && it.source && (
            <div className="kv-todo">
              <dt>作者</dt>
              <dd className="todo">
                <button type="button" className="btn text todo" onClick={onEdit}>
                  待补 · 点这里补上
                </button>
              </dd>
            </div>
          )}
          {it.creator && !quote && (
            <div>
              <dt>{it.source === '哔哩哔哩' ? 'UP 主' : CREATOR[it.type]}</dt>
              <dd>
                <InlineText value={it.creator} label={CREATOR[it.type]} maxLength={80} onSave={(v) => save({ creator: v })} />
              </dd>
            </div>
          )}
          {quote && it.title && it.title !== (it.content || '').replace(/^[「“"『]+/, '').slice(0, 18) && it.title !== (it.content || '').slice(0, 18) && (
            <div>
              <dt>出处</dt>
              <dd>{bookTitle(it.title)}</dd>
            </div>
          )}
          {it.year && (
            <div>
              <dt>年份</dt>
              <dd className="num">
                <InlineText value={it.year} label="年份" maxLength={12} onSave={(v) => save({ year: v })} />
              </dd>
            </div>
          )}
          {it.url && (
            <div>
              <dt>链接</dt>
              <dd>
                <a className="detail-url" href={it.url} target="_blank" rel="noreferrer">
                  {safeHost(it.url)}
                </a>
                {timeMark(it.url) > 0 && (
                  <>
                    {' · '}
                    <a className="detail-at" href={it.url} target="_blank" rel="noreferrer">
                      从 {clock(timeMark(it.url))} {it.type === 'film' ? '看' : '听'}
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
          {!!it.meets?.length && (
            <div className="kv-meets">
              <dt>重逢</dt>
              <dd className="num">
                {it.meets.length} 次 · 最近 {shortDate(it.meets[it.meets.length - 1])}
              </dd>
            </div>
          )}
          {(
            <div>
              <dt>标签</dt>
              <dd className="tags">
                {it.tags.map((t) => (
                  <span key={t} className="tag">
                    #{t}
                  </span>
                ))}
                <InlineText
                  value=""
                  label="加标签"
                  placeholder="＋标签"
                  tags="bare"
                  allowEmpty={false}
                  maxLength={120}
                  className="tag-add"
                  onSave={(v) => save({ tags: [...it.tags, ...v.split(/[\s,，、#]+/).filter(Boolean)] })}
                />
                {sugg.map((t) => (
                  <span key={'s' + t} className="tag-sugg">
                    <button className="tag sugg-yes" onClick={() => void batch().then((m) => m.acceptSugg(it.id!, t))} title="AI 想加的新词：点一下才算数">
                      新：{t}？
                    </button>
                    <button className="sugg-no" onClick={() => void batch().then((m) => m.dropSugg(it.id!, t))} aria-label={`不要「${t}」`}>
                      ✕
                    </button>
                  </span>
                ))}
                {!!co?.length && (
                  <span className="tag-co">
                    <span className="dim">常一起：</span>
                    {co.map((t) => (
                      <button key={'c' + t} className="tag co-tag" onClick={() => void batch().then((m) => m.addTagsTo([it.id!], [t]))}>
                        +{t}
                      </button>
                    ))}
                  </span>
                )}
              </dd>
            </div>
          )}
          <div className="kv-bundles">
            <dt>穗束</dt>
            <dd className="tags bundles">
              {(it.bundles || []).map((b) => (
                <span key={b} className="tag bundle-tag">
                  <button className="bundle-go" onClick={() => openBundle(b)} title={`看「${b}」这一束`}>
                    束 · {b}
                  </button>
                  <button className="bundle-x" onClick={() => void save({ bundles: (it.bundles || []).filter((x) => x !== b) })} aria-label={`从「${b}」拿出来`}>
                    ✕
                  </button>
                </span>
              ))}
              <InlineText
                value=""
                label="加进穗束"
                placeholder={it.bundles?.length ? '＋束' : '＋加进一个束（如：毕业设计参考）'}
                allowEmpty={false}
                maxLength={80}
                className="bundle-add"
                onSave={(v) => save({ bundles: withBundles(it.bundles, splitBundles(v)) })}
              />
            </dd>
          </div>
          <div className="kv-graft">
            <dt>嫁接</dt>
            <dd className="num">{it.graftCount ? `${it.graftCount} 次 · 最后 ${shortDate(it.graftedAt || it.createdAt)}` : '还没接过'}</dd>
          </div>
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
            <p className="detail-content">
              <InlineText value={it.content} label={it.type === 'idea' ? '展开' : '内容'} multiline onSave={(v) => save({ content: v })} />
            </p>
          </section>
        )}
        <section className={`detail-sec detail-why${it.why ? '' : ' is-empty'}`}>
          <div className="label">为什么收</div>
          <p>
            <InlineText value={it.why || ""} label="为什么收" multiline tags="hash" placeholder="还没写 · 点这里补一句为什么打动你" maxLength={1000} onSave={(v) => {
                const tags: string[] = [];
                const w = v.replace(/(^|\s)#([^\s#]{1,24})(?=\s|$)/g, (_, pre: string, t: string) => (tags.push(t), pre)).replace(/\s{2,}/g, ' ').trim();
                return save({ why: w, ...(tags.length ? { tags: [...it.tags, ...tags] } : {}) });
              }} />
          </p>
        </section>
        {it.caption && (
          <section className="detail-sec detail-caption">
            <div className="label">AI 看到的</div>
            <p>{it.caption}</p>
          </section>
        )}
        {it.ocr && (
          <section className="detail-sec detail-ocr">
            <div className="label">图中文字</div>
            <p style={{ whiteSpace: 'pre-line' }}>{it.ocr}</p>
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
          <button className={`btn text detail-basket${inBasket ? ' on' : ''}`} onClick={() => it.id != null && toast(toggleBasket(it.id) ? `放进嫁接篮 · ${basketHint(basket.length + 1)}` : '从嫁接篮拿出来了')} aria-pressed={inBasket}>
            {inBasket ? '在篮里 ✓' : '放进嫁接篮'}
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
