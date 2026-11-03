import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../lib/db';
import { coGrafted, LINK_KINDS, LINK_LABEL, linkItems, sameWork, setWork, workName } from '../lib/relate';
import { useApp } from '../lib/store';
import { displayTitle } from '../lib/studio';
import type { Item, LinkKind } from '../lib/types';
import { InlineText } from './InlineText';

/** v0.38 详情里的「关系」：作品（0104 / 0153）、连线与被提到（0105 / 0120）、常和它一起被嫁接（0151） */
export function Relations({ it }: { it: Item }) {
  const { openItem, developFrom, toast } = useApp();
  const all = useLiveQuery(() => db.items.toArray().then((a) => a.filter((x) => !x.deletedAt)), []);
  const devs = useLiveQuery(() => db.developments.toArray(), []);
  const works = useLiveQuery(() => (it.uid ? db.works.toArray().then((w) => w.filter((x) => !x.deletedAt && x.itemUids.includes(it.uid!))) : []), [it.uid]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<LinkKind>('like');
  const byUid = useMemo(() => new Map((all || []).map((x) => [x.uid, x])), [all]);
  const byId = useMemo(() => new Map((all || []).map((x) => [x.id, x])), [all]);
  const name = workName(it);
  const mates = useMemo(() => (all ? sameWork(it, all) : []), [all, it]);
  const links = (it.links || []).map((l) => ({ l, x: byUid.get(l.to) })).filter((p): p is { l: typeof p.l; x: Item } => !!p.x);
  const co = useMemo(() => (devs && it.id != null ? coGrafted(devs, it.id).filter(([id]) => byId.has(id)) : []), [devs, it.id, byId]);
  const pick = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !all) return [];
    const linked = new Set((it.links || []).map((l) => l.to));
    return all.filter((x) => x.id !== it.id && !linked.has(x.uid!) && `${x.title} ${x.creator || ''}`.toLowerCase().includes(s)).slice(0, 6);
  }, [q, all, it]);
  const grown = useMemo(() => {
    if (!devs || !mates.length) return 0;
    const ids = new Set([it.id, ...mates.map((m) => m.id)]);
    return devs.filter((d) => !d.deletedAt && d.itemIds.some((x) => ids.has(x))).length;
  }, [devs, mates, it.id]);
  if (!all) return null;
  const row = (x: Item, extra?: React.ReactNode) => (
    <li key={x.id}>
      <button className="linklike" data-item-id={x.id} onClick={() => openItem(x)}>
        {displayTitle(x)}
      </button>
      {extra}
    </li>
  );
  return (
    <>
      <section className="detail-sec detail-work">
        <div className="label">
          作品{name ? ` · 《${name}》` : ''}
          {mates.length ? <span className="num"> ({mates.length + 1} 穗{grown ? ` · ${grown} 根新枝` : ''})</span> : null}
        </div>
        {mates.length > 0 && <ul className="plain">{mates.slice(0, 8).map((x) => row(x))}</ul>}
        <p className="rel-acts">
          <InlineText value="" label="作品" allowEmpty={false} maxLength={60} placeholder={name ? '归到别的作品…' : '归到一部作品…'} onSave={(v) => setWork(it.id!, v.trim())} />
          {name && (
            <button className="btn text faint rel-split" onClick={() => setWork(it.id!, '').then(() => toast('拆出来了，不再归入《' + name + '》'))}>
              不归入
            </button>
          )}
          {it.work !== undefined && (
            <button className="btn text faint" onClick={() => setWork(it.id!, undefined)}>
              按标题自动认
            </button>
          )}
        </p>
      </section>
      <section className="detail-sec detail-links">
        <div className="label">
          连线 <span className="num">({links.length + (works?.length || 0)})</span>
        </div>
        {(links.length > 0 || !!works?.length) && (
          <ul className="plain rel-list">
            {links.map(({ l, x }) =>
              row(
                x,
                <>
                  <span className="meta-text"> · {LINK_LABEL[l.k][l.r ? 1 : 0]}</span>
                  <button className="btn text faint rel-cut" onClick={() => linkItems(it, x, null)}>
                    拆
                  </button>
                </>,
              ),
            )}
            {works?.map((w) => (
              <li key={w.id} className="meta-text">
                用在作品「{w.title}」
              </li>
            ))}
          </ul>
        )}
        <div className="rel-add">
          <span className="seg rel-kinds">
            {LINK_KINDS.map((k) => (
              <button key={k} className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>
                {LINK_LABEL[k][0]}
              </button>
            ))}
          </span>
          <input className="rel-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="连到…（搜标题）" aria-label="连到哪一穗" />
        </div>
        {pick.length > 0 && (
          <ul className="plain rel-pick">
            {pick.map((x) => (
              <li key={x.id}>
                <button
                  className="linklike"
                  onClick={async () => {
                    await linkItems(it, x, kind);
                    setQ('');
                    toast(`连上了：${LINK_LABEL[kind][0]}「${x.title}」`);
                  }}
                >
                  {displayTitle(x)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {co.length > 0 && (
        <section className="detail-sec detail-co">
          <div className="label">常和它一起被嫁接</div>
          <ul className="plain">
            {co.map(([id, n]) =>
              row(
                byId.get(id)!,
                <>
                  <span className="meta-text num"> · {n} 次</span>
                  <button className="btn text faint rel-regraft" onClick={() => developFrom([it.id!, id])}>
                    再接一次
                  </button>
                </>,
              ),
            )}
          </ul>
        </section>
      )}
    </>
  );
}
