// v0.23 待理（0101）+ 三秒整理（0115）：刚收进来的穗先在这里，理完（留下 / 补一句 / 丢掉）才进穗仓；超过 7 天的自动出现在穗仓。
// 列表一行一穗；「三秒整理」一次一穗，键盘 1 留下 · 2 补一句 · 3 丢掉 · → 稍后，手机右滑留下、左滑丢掉。
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db, findDupes, INBOX_DAYS, keepAllInbox, keepItems, reInbox, trashItems, untrashItems } from '../lib/db';
import { acceptSugg, addTagsTo, setWhy } from '../lib/batch';
import { mergeDupe } from '../lib/dupnotice';
import { dupReason } from '../lib/dupe';
import { bumpSorted, cooccur, sortedToday, whyPrompts } from '../lib/organize';
import { formatWhen } from '../lib/quick';
import { useApp } from '../lib/store';
import { displayTitle, shortDate } from '../lib/studio';
import { TYPE_LABEL, type Item } from '../lib/types';
import { DisplayTitle, Loading } from './DisplayTitle';
import { Handed } from './Handed';

const DAY = 86400000;

function useDupe(it: Item): Item | null {
  return useLiveQuery(async () => (it.id != null ? (await findDupes(it.id))[0] || null : null), [it.id, (it.dup || []).join()]) ?? null;
}

/** 一穗的整理卡（列表行和三秒整理共用） */
function SortCard({ it, all, big, onDone, inputRef }: { it: Item; all: Item[]; big?: boolean; onDone: (what: 'keep' | 'why' | 'drop' | 'merge') => void; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const { toast, openItem, desktop } = useApp();
  const keys = big && desktop;
  const [why, setW] = useState('');
  const [open, setOpen] = useState(!!big);
  const dupe = useDupe(it);
  const suggest = useMemo(() => {
    const co = cooccur(all, it.tags, 3);
    return [...(it.tagSugg || []).filter((t) => !it.tags.includes(t)), ...co.filter((t) => !(it.tagSugg || []).includes(t))].slice(0, 5);
  }, [all, it.tags, it.tagSugg]);
  const prompts = useMemo(() => whyPrompts(it.type, it.id || 0), [it.type, it.id]);
  const old = it.createdAt < Date.now() - INBOX_DAYS * DAY;
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef || localRef;

  async function saveWhy() {
    if (!why.trim()) {
      ref.current?.focus();
      return;
    }
    await setWhy(it.id!, why);
    setW('');
    onDone('why');
  }
  return (
    <article className={`sort-card${big ? ' big' : ''}`} data-item-id={it.id}>
      <button className="sort-main" onClick={() => openItem(it)}>
        <span className="sort-title">{displayTitle(it)}</span>
        <span className="sort-meta meta-text">
          {TYPE_LABEL[it.type]} · <span className="num">{formatWhen(it.createdAt)}</span>
          {it.source ? ` · 来自 ${it.source}` : ''}
          {it.tags.length ? ` · ${it.tags.slice(0, 3).map((t) => '#' + t).join(' ')}` : ''}
          {old ? ' · 已超 7 天，穗仓里也看得到' : ''}
        </span>
        {it.why && <span className="sort-why">「{it.why}」</span>}
      </button>
      {dupe && (
        <div className="sort-dupe">
          <span>
            这穗 {shortDate(dupe.createdAt)} 收过了（{dupReason(it.dup, dupe.dup) || '很像'}）：「{displayTitle(dupe).slice(0, 18)}」
          </span>
          <button
            className="btn text strong dupe-merge"
            onClick={async () => {
              await mergeDupe(dupe.id!, it.id!, toast);
              onDone('merge');
            }}
          >
            合并
          </button>
        </div>
      )}
      {suggest.length > 0 && (
        <div className="sort-sugg" aria-label="建议标签">
          <span className="label">加标签</span>
          {suggest.map((t) => (
            <button key={t} className={`chip sugg-tag${(it.tagSugg || []).includes(t) ? ' fresh' : ''}`} onClick={() => void ((it.tagSugg || []).includes(t) ? acceptSugg(it.id!, t) : addTagsTo([it.id!], [t]))}>
              {(it.tagSugg || []).includes(t) ? `新：${t}？` : `#${t}`}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="sort-whyrow">
          <input
            ref={ref}
            className="sort-why-input"
            value={why}
            onChange={(e) => setW(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void saveWhy();
              }
              if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
            placeholder={prompts[0]?.q || '为什么打动你？'}
            aria-label="补一句为什么"
            maxLength={240}
          />
          <span className="why-prompts">
            {prompts.map((p) => (
              <button key={p.q} className="linklike why-prompt" onClick={() => (setW((w) => (w ? w : p.s)), ref.current?.focus())}>
                {p.q}
              </button>
            ))}
          </span>
        </div>
      )}
      <div className="sort-acts">
        <button className="btn sort-keep" onClick={() => onDone('keep')}>
          {keys && <kbd>1</kbd>}留下
        </button>
        <button
          className="btn sort-whybtn"
          onClick={() => {
            if (open && why.trim()) void saveWhy();
            else {
              setOpen(true);
              setTimeout(() => ref.current?.focus(), 0);
            }
          }}
        >
          {keys && <kbd>2</kbd>}
          {open && why.trim() ? '存下这句' : '补一句'}
        </button>
        <button className="btn sort-drop" onClick={() => onDone('drop')}>
          {keys && <kbd>3</kbd>}丢掉
        </button>
      </div>
    </article>
  );
}

export function InboxView({ onClose }: { onClose: () => void }) {
  const { toast, desktop } = useApp();
  const inbox = useLiveQuery(() => db.items.where('inbox').equals(1).toArray().then((a) => a.filter((x) => !x.deletedAt).sort((x, y) => y.createdAt - x.createdAt)), []);
  const all = useLiveQuery(() => db.items.toArray().then((a) => a.filter((x) => !x.deletedAt)), []);
  const [focus, setFocus] = useState(false);
  const [later, setLater] = useState<number[]>([]);
  const [done, setDone] = useState(sortedToday);
  const whyRef = useRef<HTMLInputElement>(null);
  const queue = useMemo(() => {
    if (!inbox) return [];
    const l = new Set(later);
    return [...inbox.filter((x) => !l.has(x.id!)), ...inbox.filter((x) => l.has(x.id!))];
  }, [inbox, later]);
  const cur = queue[0];

  const act = useCallback(
    async (it: Item, what: 'keep' | 'why' | 'drop' | 'merge' | 'later') => {
      const id = it.id!;
      if (what === 'later') {
        setLater((l) => [...l.filter((x) => x !== id), id]);
        return;
      }
      if (what === 'keep') {
        await keepItems([id]);
        toast(`「${displayTitle(it).slice(0, 14)}」进了穗仓`, 'ok', { label: '撤销', run: () => void reInbox([id]) });
      } else if (what === 'drop') {
        await trashItems([id]);
        toast('丢掉了 1 穗（在回收站）', 'ok', { label: '撤销', run: () => void untrashItems([id]) });
      } else if (what === 'why') toast('补上了 · 进了穗仓');
      setDone(bumpSorted());
    },
    [toast],
  );

  // 三秒整理的键盘：1 留下 · 2 补一句 · 3 丢掉 · → / S 稍后 · Esc 退出
  useEffect(() => {
    if (!focus) return;
    const h = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape') {
        if (typing) return;
        e.preventDefault();
        setFocus(false);
        return;
      }
      if (typing || !cur || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '1') (e.preventDefault(), void act(cur, 'keep'));
      else if (e.key === '2') {
        e.preventDefault();
        whyRef.current?.focus();
      } else if (e.key === '3') (e.preventDefault(), void act(cur, 'drop'));
      else if (e.key === 'ArrowRight' || e.key === 's' || e.key === 'S') (e.preventDefault(), void act(cur, 'later'));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [focus, cur, act]);

  // 手机：右滑留下、左滑丢掉
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('input,button') || !cur) return;
    drag.current = { x: e.clientX, y: e.clientY, id: cur.id! };
    dxRef.current = 0;
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const x = e.clientX - drag.current.x;
    if (Math.abs(e.clientY - drag.current.y) > 60 && Math.abs(x) < 30) {
      drag.current = null;
      dxRef.current = 0;
      setDx(0);
      return;
    }
    dxRef.current = x;
    setDx(x);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    const x = dxRef.current;
    dxRef.current = 0;
    setDx(0);
    if (!d || !cur || cur.id !== d.id) return;
    if (x > 90) void act(cur, 'keep');
    else if (x < -90) void act(cur, 'drop');
  };

  if (!inbox || !all) return <Loading />;

  async function keepAll() {
    const ids = await keepAllInbox();
    setDone(bumpSorted(ids.length));
    toast(`${ids.length} 穗全部进了穗仓`, 'ok', { label: '撤销', run: () => void reInbox(ids) });
  }

  return (
    <section className="view library inbox-view" aria-label="待理">
      <DisplayTitle
        title="待理"
        count={inbox.length}
        sub={`刚收进来的先放这里，理完再进穗仓；超过 ${INBOX_DAYS} 天的穗仓里也看得到。${done ? `今天理了 ${done} 穗。` : ''}`}
        aside={
          <div className="page-tools">
            {inbox.length > 0 && (
              <button className={`chip inbox-focus${focus ? ' on' : ''}`} onClick={() => setFocus(!focus)}>
                {focus ? '看全部' : '三秒整理'}
              </button>
            )}
            {inbox.length > 0 && (
              <button className="chip inbox-keepall" onClick={keepAll}>
                全部入仓
              </button>
            )}
            <button className="chip inbox-back" onClick={onClose}>
              回穗仓
            </button>
          </div>
        }
      />
      <Handed />
      {inbox.length === 0 ? (
        <div className="empty small inbox-empty">
          <p className="lead">待理清空了</p>
          <p className="meta-text">速记、分享、极速拾、选字、正在播放收进来的穗会先到这里。</p>
        </div>
      ) : focus && cur ? (
        <div className="sort-focus">
          <div className="sort-progress meta-text">
            还剩 <span className="num">{queue.length}</span> 穗 ·{' '}
            {desktop ? (
              <>
                <kbd>1</kbd> 留下 <kbd>2</kbd> 补一句 <kbd>3</kbd> 丢掉 <kbd>→</kbd> 稍后
              </>
            ) : (
              '右滑留下，左滑丢掉'
            )}
          </div>
          <div
            className={`sort-stage${dx > 40 ? ' to-keep' : dx < -40 ? ' to-drop' : ''}`}
            style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)` } : undefined}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <SortCard key={cur.id} it={cur} all={all} big inputRef={whyRef} onDone={(w) => void act(cur, w)} />
          </div>
          <button className="btn text faint sort-later" onClick={() => void act(cur, 'later')}>
            稍后再理 →
          </button>
        </div>
      ) : (
        <div className="sort-list">
          {inbox.map((it) => (
            <SortCard key={it.id} it={it} all={all} onDone={(w) => void act(it, w)} />
          ))}
        </div>
      )}
    </section>
  );
}
