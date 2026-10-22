import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { daysUntouched, todayKey } from '../lib/daily';
import { db, ensureDaily } from '../lib/db';
import { useApp } from '../lib/store';
import type { DailyPick, Item } from '../lib/types';

const FOLD_KEY = 'glean.daily.folded';

/** 卡片上的短名字：摘抄显示原文开头，其他显示标题 */
export function shortName(it: Item, max = 16): string {
  const s = it.type === 'text' && it.content ? `「${it.content.replace(/^[「“"『]+|[」”"』]+$/g, '')}」` : it.title || '无题';
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
      <div className="paper throwback daily-ear folded" data-day={pick.day}>
        <button
          className="btnlike daily-unfold"
          onClick={() => {
            localStorage.removeItem(FOLD_KEY);
            setFolded(false);
          }}
        >
          今日一穗 · 展开
        </button>
      </div>
    );
  }

  return (
    <div className="paper throwback daily-ear" data-day={pick.day}>
      <div className="kicker">
        今日一穗 · {d.getMonth() + 1}月{d.getDate()}日
      </div>
      <p className="dim daily-sub">很久没碰的三穗</p>
      <ul className="daily-old">
        {old.map((it) => {
          const n = devs ? daysUntouched(it, devs) : 0;
          return (
            <li key={it.id}>
              <button className="btnlike" data-item-id={it.id} onClick={() => openItem(it)}>
                {shortName(it, 22)}
              </button>
              <span className="dim"> · {n > 0 ? `${n} 天没碰` : '今天碰过'}</span>
            </li>
          );
        })}
      </ul>
      <p className="dim daily-sub">没试过的远组合</p>
      <p className="daily-combo">
        {combo.map((it, i) => (
          <span key={it.id}>
            {i > 0 && <span className="dim"> × </span>}
            <button className="btnlike" data-item-id={it.id} onClick={() => openItem(it)}>
              {shortName(it)}
            </button>
          </span>
        ))}
      </p>
      <div className="actions">
        <button className="btn ghost small daily-go" onClick={() => developFrom(combo.map((c) => c.id!))}>
          一键去嫁接这 4 穗
        </button>
        <button
          className="btn ghost small daily-fold"
          onClick={() => {
            localStorage.setItem(FOLD_KEY, day);
            setFolded(true);
          }}
        >
          收起
        </button>
      </div>
    </div>
  );
}
