// v0.23「缺为什么」专栏（0102）+ 提示问题（0146）：没写为什么的穗集中在这里，一次给 5 条，直接在列表里补；可跳过、换一批。
// 不替你写：只给几个提示问题，点一下当句子开头。
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { db } from '../lib/db';
import { setWhy } from '../lib/batch';
import { WHY_BATCH, whyPrompts, whyQueue } from '../lib/organize';
import { formatWhen } from '../lib/quick';
import { useApp } from '../lib/store';
import { displayTitle } from '../lib/studio';
import { TYPE_LABEL, type Item } from '../lib/types';
import { DisplayTitle, Loading } from './DisplayTitle';

const SKIP_KEY = 'glean.whyskip.v1';
function loadSkip(): Set<number> {
  try {
    const v = JSON.parse(sessionStorage.getItem(SKIP_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'number') : []);
  } catch {
    return new Set();
  }
}
function saveSkip(s: Set<number>) {
  try {
    sessionStorage.setItem(SKIP_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* ignore */
  }
}

function WhyRow({ it, onSkip, onSaved }: { it: Item; onSkip: () => void; onSaved: () => void }) {
  const { openItem } = useApp();
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const prompts = useMemo(() => whyPrompts(it.type, it.id || 0), [it.type, it.id]);
  async function save() {
    if (!v.trim()) return ref.current?.focus();
    await setWhy(it.id!, v);
    onSaved();
  }
  return (
    <li className="why-row" data-item-id={it.id}>
      <button className="why-item" onClick={() => openItem(it)}>
        <span className="why-title">{displayTitle(it)}</span>
        <span className="meta-text">
          {TYPE_LABEL[it.type]} · <span className="num">{formatWhen(it.createdAt)}</span>
          {it.creator ? ` · ${it.creator}` : ''}
        </span>
      </button>
      <div className="why-edit">
        <input
          ref={ref}
          className="why-input"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={prompts[0]?.q || '为什么收它？'}
          aria-label={`为什么收「${displayTitle(it)}」`}
          maxLength={240}
        />
        <button className="btn why-save" onClick={save} disabled={!v.trim()}>
          存
        </button>
        <button className="btn text faint why-skip" onClick={onSkip}>
          跳过
        </button>
      </div>
      <div className="why-prompts">
        {prompts.map((p) => (
          <button key={p.q} className="linklike why-prompt" onClick={() => (setV((x) => x || p.s), ref.current?.focus())}>
            {p.q}
          </button>
        ))}
      </div>
    </li>
  );
}

export function WhyView({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const items = useLiveQuery(() => db.items.toArray().then((a) => a.filter((x) => !x.deletedAt)), []);
  const [skip, setSkip] = useState<Set<number>>(loadSkip);
  const [filled, setFilled] = useState(0);
  const queue = useMemo(() => (items ? whyQueue(items, skip) : []), [items, skip]);
  const own = items ? items.filter((i) => !i.sample).length : 0;
  if (!items) return <Loading />;
  const batch = queue.slice(0, WHY_BATCH);
  const skipOne = (id: number) => {
    const n = new Set(skip);
    n.add(id);
    setSkip(n);
    saveSkip(n);
  };
  const nextBatch = () => {
    const n = new Set(skip);
    for (const it of batch) n.add(it.id!);
    setSkip(n);
    saveSkip(n);
  };
  const withWhy = own - queue.length;
  return (
    <section className="view library why-view" aria-label="缺为什么">
      <DisplayTitle
        title="缺为什么"
        count={queue.length}
        sub={own ? `${own} 穗里 ${withWhy} 穗写了为什么。每次 ${WHY_BATCH} 条，写一句就好，不想写就跳过。${filled ? `这次补了 ${filled} 条。` : ''}` : '还没有自己拾的穗。'}
        aside={
          <div className="page-tools">
            {queue.length > WHY_BATCH && (
              <button className="chip why-next" onClick={nextBatch}>
                换 {WHY_BATCH} 条
              </button>
            )}
            <button className="chip why-back" onClick={onClose}>
              回穗仓
            </button>
          </div>
        }
      />
      {queue.length === 0 ? (
        <div className="empty small why-empty">
          <p className="lead">每一穗都有为什么了</p>
          <p className="meta-text">为什么收，是嫁接时最有用的线索。</p>
        </div>
      ) : (
        <ol className="why-list">
          {batch.map((it) => (
            <WhyRow
              key={it.id}
              it={it}
              onSkip={() => skipOne(it.id!)}
              onSaved={() => {
                setFilled((n) => n + 1);
                toast(`补上了「${displayTitle(it).slice(0, 14)}」`);
              }}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
