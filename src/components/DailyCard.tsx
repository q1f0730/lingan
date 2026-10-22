import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { daysUntouched, todayKey } from '../lib/daily';
import { db, ensureDaily } from '../lib/db';
import { useApp } from '../lib/store';
import type { DailyPick, Item } from '../lib/types';

const FOLD_KEY = 'glean.daily.folded';

/** 卡片上的短名字：摘抄显示原文开头，其他显示标题 */
export function shortName(it: Item, max = 16): string {
  const s = it.type === 'text' && it.content ? `“${it.content.replace(/^[「“"『]+|[」”"』]+$/g, '')}”` : it.type === 'film' ? `《${(it.title || '无题').replace(/^《|》$/g, '')}》` : it.title || '无题';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** 当前本地日期；回到前台 / 跨过午夜时更新 */
function useToday(): string {
  const [day, setDay] = useState(() => todayKey());
  useEffect(() => {
    const check = () => setDay(todayKey());
    const now = new Date();
    const toMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5).getTime() - now.getTime();
    const t = window.setTimeout(check, toMidnight);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [day]);
  return day;
}

/** v0.14 每日一穗：穗仓顶部的「今日」卡。完全本地，同一天内容不变 */
export function DailyCard({ items }: { items: Item[] }) {
  const { openItem, developFrom } = useApp();
  const day = useToday();
  const [pick, setPick] = useState<DailyPick | null>(null);
  const [folded, setFolded] = useState(() => localStorage.getItem(FOLD_KEY) === day);
  const devs = useLiveQuery(() => db.developments.toArray().then((ds) => ds.map((x) => ({ itemIds: x.itemIds, createdAt: x.createdAt }))), []);
  const byId = useMemo(() => new Map(items.map((i) => [i.id!, i])), [items]);
  // 穗的「身份」变了（增删 / 示例被清）才需要重新确认今天的内容；改个标题、碰一下不会让内容变
  const sig = useMemo(() => items.map((i) => `${i.id}${i.sample ? 's' : ''}`).join(','), [items]);

  useEffect(() => {
    let alive = true;
    ensureDaily(items)
      .then((p) => alive && setPick(p))
      .catch(() => alive && setPick(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, day]);
  useEffect(() => setFolded(localStorage.getItem(FOLD_KEY) === day), [day]);

  if (!pick || pick.day !== day) return null;
  const old = pick.oldIds.map((id) => byId.get(id)).filter(Boolean) as Item[];
  const combo = pick.comboIds.map((id) => byId.get(id)).filter(Boolean) as Item[];
  if (old.length < 3 || combo.length < 4) return null;
  const d = new Date();

  if (folded) {
    return (
      <div className="daily-ear folded note-row" data-day={pick.day}>
        <button
          className="btn text daily-unfold"
          onClick={() => {
            localStorage.removeItem(FOLD_KEY);
            setFolded(false);
          }}
        >
          每日一穗 · 展开
        </button>
      </div>
    );
  }

  const [hero, ...rest] = old;
  const nOf = (it: Item) => (devs ? daysUntouched(it, devs) : 0);
  const untouched = (n: number) => (n > 0 ? `${n} 天没碰` : '今天碰过');
  return (
    <section className="daily-ear" data-day={pick.day} aria-label="每日一穗">
      <div className="daily-head">
        <span className="label">每日一穗 · {String(d.getMonth() + 1).padStart(2, '0')}/{String(d.getDate()).padStart(2, '0')}</span>
        <span className="daily-acts">
          <button className="btn text strong daily-go" onClick={() => developFrom(combo.map((c) => c.id!))}>
            拿去嫁接这 4 穗
          </button>
          <button
            className="btn text faint daily-fold"
            onClick={() => {
              localStorage.setItem(FOLD_KEY, day);
              setFolded(true);
            }}
          >
            放下
          </button>
        </span>
      </div>
      <ul className="daily-old">
        <li className="hero">
          <button className="linklike" data-item-id={hero.id} onClick={() => openItem(hero)}>
            {shortName(hero, 40)}
          </button>
          <span className="daily-n"> {untouched(nOf(hero))}</span>
        </li>
        {rest.map((it) => (
          <li key={it.id} className="rest">
            <button className="linklike" data-item-id={it.id} onClick={() => openItem(it)}>
              {shortName(it, 22)}
            </button>
            <span className="daily-n"> {untouched(nOf(it))}</span>
          </li>
        ))}
      </ul>
      {hero.why && <p className="daily-why meta-text">当时写的：{hero.why}</p>}
      <p className="daily-combo">
        <span className="label">可能和它接得上</span>{' '}
        {combo.map((it, i) => (
          <span key={it.id}>
            {i > 0 && <span className="dim"> / </span>}
            <button className="linklike" data-item-id={it.id} onClick={() => openItem(it)}>
              {shortName(it)}
            </button>
          </span>
        ))}
      </p>
    </section>
  );
}
