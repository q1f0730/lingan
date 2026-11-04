// v0.40 口味页三块：ROADMAP v0.35 口味会说话（近 30 天 vs 前 30 天）+ 0919 现在的我 vs 一年前的我 + 0915 改变了看法的穗；
// 0923 本月有 n 天在拾 + 休耕；0926 / 0939 田埂（只记第一次，不弹窗、无积分，可整块关掉）。
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../lib/db';
import { changedMind, firsts, monthDays, tasteTalk, toggleFallow, type Fallow } from '../lib/review';
import { shortDate } from '../lib/studio';
import { useApp } from '../lib/store';
import type { Item } from '../lib/types';
import '../styles/v040.css';

export function TasteTalk({ items }: { items: Item[] }) {
  const t = useMemo(() => tasteTalk(items), [items]);
  const k = useMemo(() => changedMind(items), [items]);
  if (!items.length) return null;
  return (
    <section className="taste-sec wide taste-talk">
      <div className="label">口味会说话</div>
      <p className="talk-line">{t.line}</p>
      {t.year && (
        <p className="meta-text talk-year">
          和一年前比：{t.year.kept.length ? `留下的 ${t.year.kept.join('、')}` : '没有一个标签留下来'}
          {t.year.fresh.length ? `；新来的 ${t.year.fresh.join('、')}` : ''}
          {t.year.gone.length ? `；不见了的 ${t.year.gone.join('、')}` : ''}。
        </p>
      )}
      {k > 0 && (
        <p className="meta-text talk-mind">
          一年后重写过为什么的穗 <span className="num">{k}</span>
        </p>
      )}
    </section>
  );
}

/** 0923 口味页顶部那行：本月有 n 天在拾（断了不清零）· 休耕 */
export function MonthDays({ items, fallow, onFallow }: { items: Item[]; fallow: Fallow; onFallow: (f: Fallow) => void }) {
  const m = monthDays(items, undefined, fallow);
  return (
    <>
      本月有 <span className="stat-n num month-days">{m.days}</span> 天在拾{m.rest ? ` · 休耕 ${m.rest} 天` : ''}{' '}
      <button className="btn text fallow-btn" onClick={() => onFallow(toggleFallow(fallow))}>
        {m.resting ? '结束休耕' : '休耕 7 天'}
      </button>
    </>
  );
}

const RIDGE_OFF = 'glean.ridge.off';
export function Ridge({ items }: { items: Item[] }) {
  const { openItem, go } = useApp();
  const [off, setOff] = useState(() => !!localStorage.getItem(RIDGE_OFF));
  const devs = useLiveQuery(() => db.developments.toArray(), []);
  const works = useLiveQuery(() => db.works.toArray(), []);
  const list = useMemo(() => (devs && works ? firsts(items, devs, works) : []), [items, devs, works]);
  const flip = () => (off ? localStorage.removeItem(RIDGE_OFF) : localStorage.setItem(RIDGE_OFF, '1'), setOff(!off));
  if (!list.length) return null;
  return (
    <section className="taste-sec ridge">
      <div className="label">
        田埂 <span className="dim">· 只记第一次</span>{' '}
        <button className="btn text faint ridge-toggle" onClick={flip}>
          {off ? '打开' : '关掉'}
        </button>
      </div>
      {!off && (
        <ul className="plain ridge-list">
          {list.map((f) => (
            <li key={f.k}>
              <span className="dim num">{shortDate(f.at)}</span>{' '}
              <button className="linklike" onClick={() => (f.item ? openItem(f.item) : go(f.k === 'work' ? 'works' : 'branches'))}>
                {f.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
