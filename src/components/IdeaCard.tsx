import { itemHasImage } from '../lib/imagestore';
import { useThumbSrc } from '../lib/useImage';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/db';
import { useApp } from '../lib/store';
import { transformName } from '../lib/graft';
import { evidenceOf, MIN_EVIDENCE, sourceIds, splitMentions, type Evidence } from '../lib/provenance';
import { TYPE_LABEL, type Development, type GraftBatch, type Idea, type Item } from '../lib/types';
import { nn } from '../lib/studio';


/** 一根新枝（m3 / m25 / d4）：细体序号 → 标题 → 一句话 → 因为这几穗 → 文字动作「留下 / 再接一次 / 不要」 */
export function IdeaCard({ idea, source, devId, animate, index, hideCliches, onAgain }: { idea: Idea; source: 'ai' | 'offline'; devId?: number; animate?: boolean; index?: number; hideCliches?: boolean; onAgain?: () => void }) {
  const { toast, openItem, confirm } = useApp();
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
  async function drop() {
    if (!devId) return;
    const ok = await confirm({ title: `不要「${idea.title.replace(/^《|》$/g, '')}」？`, body: '这根新枝会从新枝里删掉，它的来源穗不受影响。', ok: '不要了', cancel: '留着', danger: true });
    if (!ok) return;
    await db.developments.delete(devId);
    toast('已删掉这根新枝');
  }
  return (
    <article
      className={`idea${evidence === 'weak' ? ' idea-weak' : ''}${animate ? ' fade' : ''}`}
      style={animate && typeof index === 'number' ? ({ '--d': `${index * 40}ms` } as React.CSSProperties) : undefined}
      data-transform={idea.transform || undefined}
      data-evidence={evidence}
    >
      <div className="idea-meta">
        <span className="numeral">{typeof index === 'number' ? nn(index) : '—'}</span>
        <span className="idea-tags label">
          {evidence === 'weak' && <span className="weak-badge">证据不足</span>}
          {idea.transform && <span className="idea-transform">{transformName(idea.transform)}</span>}
          <span className="idea-src">{source === 'ai' ? 'AI 嫁接' : '离线嫁接'}</span>
          {dev && typeof index !== 'number' ? <span className="dim"> · {new Date(dev.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> : null}
        </span>
      </div>
      <h2 className="idea-title">{idea.title.replace(/^《|》$/g, '')}</h2>
      <p className="idea-body">{marked ?? idea.idea}</p>
      {idea.form && <div className="idea-form meta-text">形式 · {idea.form}</div>}
      {idea.bridge && (
        <div className="idea-bridge">
          <span className="label">嫁接点</span>
          <span>{idea.bridge}</span>
        </div>
      )}
      {idea.unlike && (
        <p className="idea-unlike">
          <span className="label">和另外两根不同</span>
          <span>{idea.unlike}</span>
        </p>
      )}
      {idea.experiment ? (
        <div className="idea-exp">
          <span className="label">20 分钟小实验</span>
          <span>{idea.experiment}</span>
        </div>
      ) : (
        idea.firstStep && (
          <p className="idea-step">
            <span className="label">第一步</span> <span>{idea.firstStep}</span>
          </p>
        )
      )}
      {idea.oblique && <p className="idea-oblique meta-text">斜策略：{idea.oblique}</p>}
      {dev && <SourceSprigs ids={ids} items={srcItems} evidence={evidence} note={idea.evidenceNote} hl={hl} setHl={setHl} onOpen={openItem} />}
      {!hideCliches && idea.cliches.length > 0 && (
        <div className="cliches">
          <span className="label">剪掉的旧枝（套路）</span>
          <span className="cliche-list">
            {idea.cliches.map((c, i) => (
              <s key={i}>{c}</s>
            ))}
          </span>
        </div>
      )}
      <div className="actions text-actions idea-acts">
        {devId && (
          <button className="btn text strong idea-keep" onClick={() => db.developments.update(devId, { starred: !dev?.starred })} aria-pressed={!!dev?.starred}>
            {dev?.starred ? '已留下' : '留下'}
          </button>
        )}
        {onAgain && (
          <button className="btn text idea-again" onClick={onAgain}>
            再接一次
          </button>
        )}
        <button className="btn text idea-copy" onClick={copy}>
          复制
        </button>
        {devId && (
          <button className="btn text faint idea-drop" onClick={drop}>
            不要
          </button>
        )}
      </div>
    </article>
  );
}

export function HistoryRow({ dev, byId, index, focus }: { dev: Development; byId: Map<number, Item>; index?: number; focus?: boolean }) {
  const [open, setOpen] = useState(!!focus);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) rowRef.current?.scrollIntoView({ block: 'start' });
  }, [focus]);
  const { developFrom } = useApp();
  const names = dev.itemIds.map((id) => byId.get(id)?.title || '（已删除）');
  const i = index ?? dev.batch?.index ?? 0;
  return (
    <div ref={rowRef} className={`hrow${open ? ' open' : ''}${focus ? ' focus' : ''}`} data-dev-id={dev.id}>
      <button className="hrow-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="numeral small">{nn(i)}</span>
        <span className="hrow-title">
          {dev.idea.title.replace(/^《|》$/g, '')}
          {dev.starred ? <span className="hrow-kept label">已留下</span> : null}
          {evidenceOf(dev, dev.idea) === 'weak' && <span className="hrow-weak">证据不足</span>}
        </span>
        <span className="hrow-src">{names.join(' / ')}</span>
        <span className="hrow-when num">{new Date(dev.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>
      </button>
      {open && (
        <div className="hrow-body">
          <IdeaCard idea={dev.idea} source={dev.source} devId={dev.id} index={i} onAgain={() => developFrom(dev.itemIds.filter((x) => x > 0))} />
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
    <details className="trail">
      <summary>看看它们是怎么长出来的 · {batch.tensions?.length || 0} 个张力 / {batch.seeds?.length || 0} 粒种子</summary>
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
                  <span className="sprig-thumb" aria-hidden />
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
                className={`sprig sprig-${it.type}${itemHasImage(it) ? ' has-img' : ''}${hl === id ? ' on' : ''}`}
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
                {itemHasImage(it) && (
                  <span className="sprig-thumb" aria-hidden>
                    <SprigThumb it={it} />
                  </span>
                )}
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

/** 小穗卡缩略图：读缩略图，卸载回收 objectURL */
function SprigThumb({ it }: { it: Item }) {
  const src = useThumbSrc(it);
  return src ? <img src={src} alt="" decoding="async" /> : null;
}
