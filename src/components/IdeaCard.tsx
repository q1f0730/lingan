import { itemHasImage } from '../lib/imagestore';
import { useThumbSrc } from '../lib/useImage';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { DecodeText, TypeReveal } from './Motion';
import { db } from '../lib/db';
import { useApp } from '../lib/store';
import { transformName } from '../lib/graft';
import { evidenceOf, MIN_EVIDENCE, sourceIds, splitMentions, type Evidence } from '../lib/provenance';
import { TYPE_LABEL, type Development, type GraftBatch, type Idea, type Item } from '../lib/types';

const cleanTitle = (t: string) => `《${t.replace(/^《|》$/g, '')}》`;

/** 一根新枝（嫁接的结果） */
export function IdeaCard({ idea, source, devId, animate, index, hideCliches }: { idea: Idea; source: 'ai' | 'offline'; devId?: number; animate?: boolean; index?: number; hideCliches?: boolean }) {
  const { toast, openItem } = useApp();
  const dev = useLiveQuery(() => (devId ? db.developments.get(devId) : undefined), [devId]);
  const ids = useMemo(() => (dev ? sourceIds(dev, idea) : []), [dev, idea]);
  const srcItems = useLiveQuery(async () => (ids.length ? await db.items.bulkGet(ids) : []), [ids.join(',')]);
  const [hl, setHl] = useState<number | null>(null);
  const ptr = useRef('');
  const evidence = dev ? evidenceOf(dev, idea) : idea.evidence || 'legacy';
  const present = useMemo(() => (srcItems || []).filter((x): x is Item => !!x), [srcItems]);
  const segments = useMemo(() => splitMentions(idea.idea, present), [idea.idea, present]);
  const marked = segments.some((x) => x.id) ? (
    <>
      {segments.map((sg, i) =>
        sg.id ? (
          <mark
            key={i}
            className={`mention${hl === sg.id ? ' on' : ''}`}
            data-item-id={sg.id}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setHl(sg.id!)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHl(null)}
            onPointerDown={(e) => (ptr.current = e.pointerType)}
            onClick={() => (ptr.current === 'mouse' ? setHl(sg.id!) : setHl(hl === sg.id ? null : sg.id!))}
          >
            {sg.text}
          </mark>
        ) : (
          <span key={i}>{sg.text}</span>
        ),
      )}
    </>
  ) : null;
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
    <article className={`paper idea${evidence === 'weak' ? ' idea-weak' : ''}`} data-transform={idea.transform || undefined} data-evidence={evidence}>
      <div className="idea-meta">
        <span className="kicker">
          {typeof index === 'number' ? `第 ${index + 1} 根` : '新枝'}
          {dev && typeof index !== 'number' ? ` · ${new Date(dev.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <span className="idea-src">
          {evidence === 'weak' && <span className="weak-badge">证据不足</span>}
          {source === 'ai' ? 'AI 嫁接' : '离线嫁接'}
        </span>
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
      {animate ? <TypeReveal className="idea-body" text={idea.idea} done={marked} /> : <p className="idea-body">{marked ?? idea.idea}</p>}
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
      {dev && <SourceSprigs ids={ids} items={srcItems} evidence={evidence} note={idea.evidenceNote} hl={hl} setHl={setHl} onOpen={openItem} />}
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
          {evidenceOf(dev, dev.idea) === 'weak' && <span className="hrow-weak">证据不足</span>}
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

/** 「因为这几穗」：新枝下面一排小穗卡（3–5 件，带缩略图），点一下回到那一穗；悬停 / 长按时正文里提到它的地方一起亮起来 */
export function SourceSprigs({
  ids,
  items,
  evidence,
  note,
  hl,
  setHl,
  onOpen,
}: {
  ids: number[];
  items: (Item | undefined)[] | undefined;
  evidence: Evidence;
  note?: string;
  hl: number | null;
  setHl: (id: number | null) => void;
  onOpen: (it: Item) => void;
}) {
  const press = useRef<{ t: number; long: boolean }>({ t: 0, long: false });
  if (!items) return null;
  const found = items.filter(Boolean).length;
  return (
    <section className={`sprigs${evidence === 'weak' ? ' weak' : ''}`} aria-label="因为这几穗">
      <div className="sprigs-head">
        <span className="label">因为这几穗</span>
        <span className="sprigs-whisper">where this one grew from</span>
      </div>
      {evidence === 'weak' && (
        <p className="sprigs-weak" role="note">
          <strong>证据不足</strong>：这根新枝说不清它是从哪几穗长出来的{note ? `（${note}）` : ''}。先把它当一粒种子看，别太当真。
        </p>
      )}
      {evidence === 'legacy' && found < MIN_EVIDENCE && found > 0 && <p className="sprigs-note">这根是早先长的，只记得这 {found} 穗。</p>}
      {ids.length > 0 && (
        <div className="sprig-row">
          {ids.map((id, i) => {
            const it = items[i];
            if (!it) {
              return (
                <div key={id} className="sprig gone" data-item-id={id}>
                  <span className="sprig-thumb" aria-hidden>
                    ·
                  </span>
                  <span className="sprig-text">
                    <span className="sprig-title">这穗已经不在穗仓了</span>
                  </span>
                </div>
              );
            }
            return (
              <button
                key={id}
                type="button"
                className={`sprig sprig-${it.type}${hl === id ? ' on' : ''}`}
                data-item-id={id}
                title={`回到「${it.title}」`}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHl(id)}
                onPointerLeave={(e) => {
                  if (e.pointerType === 'mouse') setHl(null);
                  clearTimeout(press.current.t);
                }}
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse') return;
                  press.current.long = false;
                  clearTimeout(press.current.t);
                  press.current.t = window.setTimeout(() => {
                    press.current.long = true;
                    setHl(id);
                  }, 380);
                }}
                onPointerUp={() => clearTimeout(press.current.t)}
                onContextMenu={(e) => {
                  // 长按时别弹系统菜单
                  e.preventDefault();
                  setHl(hl === id ? null : id);
                }}
                onClick={() => {
                  if (press.current.long) {
                    press.current.long = false;
                    return;
                  }
                  onOpen(it);
                }}
              >
                <span className="sprig-thumb" aria-hidden>
                  {itemHasImage(it) ? <SprigThumb it={it} /> : <span className="sprig-glyph">{glyphOf(it)}</span>}
                </span>
                <span className="sprig-text">
                  <span className="sprig-title">{it.title}</span>
                  <span className="sprig-sub">
                    {TYPE_LABEL[it.type]}
                    {it.creator ? ` · ${it.creator}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function glyphOf(it: Item): string {
  const t = (it.type === 'text' && it.content ? it.content : it.title).replace(/^[《「“"『\s]+/, '');
  return Array.from(t)[0] || '穗';
}

/** 小穗卡缩略图：读缩略图，卸载回收 objectURL */
function SprigThumb({ it }: { it: Item }) {
  const src = useThumbSrc(it);
  return src ? <img src={src} alt="" decoding="async" /> : null;
}
