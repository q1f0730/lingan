// v0.40 穗仓里的两张回看卡（懒加载，首屏画完、空闲后才来）：
// 0922 / 0155 周日的「本周拾穗 · 周记」三问；ROADMAP v0.37 每月 1–7 号「上个月的麦捆」（一月顺带「一年的麦田」）+ 0925 被遗忘的好东西（留着 / 放下）。
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { addItem, keepAround, setDown, unsealItem } from '../lib/repo';
import { daysBetween, dueLetters, needWhy, sealedSummary, staleWork, WORK_SEEN_KEY, yearAgo } from '../lib/rhythm';
import { shortDate } from '../lib/studio';
import { fieldItems, forgotten, sheaf, sheafMonth, WEEK_QS, weekKey, weekNote, yearField } from '../lib/review';
import { displayTitle } from '../lib/studio';
import { useApp } from '../lib/store';
import type { Development, Item } from '../lib/types';
import '../styles/v040.css';

const WEEK_OFF = 'glean.week.off';
const SHEAF_OFF = 'glean.sheaf.off';
const off = (k: string, v: string | null) => !!v && localStorage.getItem(k) === v;

export function ReviewNotes({ items, devs }: { items: Item[]; devs: Development[] }) {
  const { openItem, toast, go } = useApp();
  const [, bump] = useState(0);
  const [now] = useState(Date.now);
  const wk = weekKey(now);
  const sm = useMemo(() => sheafMonth(now), [now]);
  const smKey = sm ? `${sm[0]}-${sm[1] + 1}` : null;
  const field = useMemo(() => fieldItems(items), [items]);
  const week = useMemo(() => (wk ? weekNote(field, now) : null), [field, wk, now]);
  const sh = useMemo(() => (sm ? sheaf(field, devs, sm[0], sm[1]) : null), [field, devs, sm]);
  const yr = useMemo(() => (sm && sm[1] === 11 ? yearField(field, devs, sm[0]) : null), [field, devs, sm]);
  const lost = useMemo(() => (sm ? forgotten(items, devs, now) : []), [items, devs, sm, now]);
  const [ans, setAns] = useState(['', '', '']);
  const [writing, setWriting] = useState(false);
  const hide = (k: string, v: string) => (localStorage.setItem(k, v), bump((x) => x + 1));

  async function saveWeek() {
    const md = new Date(now);
    const body = WEEK_QS.map((q, i) => (ans[i].trim() ? `${q}\n${ans[i].trim()}` : '')).filter(Boolean).join('\n\n');
    await addItem({ type: 'idea', title: `周记 · ${md.getMonth() + 1}/${md.getDate()}`, content: body, tags: ['周记'] });
    hide(WEEK_OFF, wk!);
    toast('周记存成了一穗想法（标签 #周记）');
  }
  async function keep(it: Item, down: boolean) {
    await (down ? setDown([it.id!], true) : keepAround([it.id!]));
    bump((x) => x + 1);
    toast(down ? `放下了「${displayTitle(it)}」：不进穗仓和每日一穗，搜得到，详情里能拿回来` : '留着：半年内不再提它');
  }

  const showWeek = !!week && week.n > 0 && !off(WEEK_OFF, wk);
  const showSheaf = !!sh && (sh.n > 0 || lost.length > 0) && !off(SHEAF_OFF, smKey);
  const rhythm = <RhythmNotes items={items} now={now} />;
  if (!showWeek && !showSheaf) return rhythm;
  return (
    <>
      {rhythm}
      {showWeek && (
        <div className="note-row review-card week-card">
          <span className="label">本周拾穗 · 周记</span>
          <span className="meta-text">
            7 天拾了 <span className="num">{week.n}</span> 穗{week.tag ? ` · 最常出现 #${week.tag}` : week.type ? ` · ${week.type}最多` : ''}
            {week.noWhy ? ` · ${week.noWhy} 穗还没写为什么` : ''}
          </span>
          {writing && (
          <div className="review-qs">
            {WEEK_QS.map((q, i) => (
              <label key={q} className="field">
                <span className="label">{q}</span>
                <input className={`week-a${i}`} value={ans[i]} maxLength={200} onChange={(e) => setAns(ans.map((x, j) => (j === i ? e.target.value : x)))} />
              </label>
            ))}
          </div>
          )}
          <span className="note-acts">
            {writing ? (
              <button className="btn text strong week-save" disabled={!ans.some((x) => x.trim())} onClick={saveWeek}>
                存成想法穗
              </button>
            ) : (
              <button className="btn text strong week-write" onClick={() => setWriting(true)}>
                写三句周记
              </button>
            )}
            <button className="btn text faint week-skip" onClick={() => hide(WEEK_OFF, wk!)}>
              这周不写
            </button>
          </span>
        </div>
      )}
      {showSheaf && (
        <div className="note-row review-card sheaf-card">
          <span className="label">
            {sh.m + 1} 月的麦捆
          </span>
          <span className="meta-text sheaf-line">
            拾了 <span className="num">{sh.n}</span> 穗 · <span className="num">{sh.days}</span> 天在拾{sh.peak ? ` · 最常在${sh.peak}收` : ''} · 长出 <span className="num">{sh.branches}</span> 根新枝
          </span>
          {sh.odd && (
            <span className="meta-text">
              最意外的一根：
              <button className="linklike sheaf-odd" onClick={() => go('branches')}>
                {sh.odd.idea.title.replace(/^《|》$/g, '')}
              </button>
            </span>
          )}
          {yr && yr.n > 0 && (
            <span className="meta-text year-line">
              一年的麦田 · {yr.y}：<span className="num">{yr.n}</span> 穗 / <span className="num">{yr.days}</span> 天 / <span className="num">{yr.branches}</span> 根新枝{yr.tag ? ` · 最常出现 #${yr.tag}` : ''}
            </span>
          )}
          {lost.length > 0 && (
            <div className="review-lost">
              <span className="label">被遗忘的好东西</span>
              {lost.map((it) => (
                <span key={it.id} className="lost-row">
                  <button className="linklike" onClick={() => openItem(it)}>
                    {displayTitle(it)}
                  </button>
                  <button className="btn text lost-keep" onClick={() => keep(it, false)}>
                    留着
                  </button>
                  <button className="btn text faint lost-down" onClick={() => keep(it, true)}>
                    放下
                  </button>
                </span>
              ))}
            </div>
          )}
          <span className="note-acts">
            <button className="btn text faint sheaf-skip" onClick={() => hide(SHEAF_OFF, smKey!)}>
              收起
            </button>
          </span>
        </div>
      )}
    </>
  );
}

const WHY_OFF = 'glean.needwhy.off';
const YEAR_OFF = 'glean.yearago.off';
const readSeen = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(WORK_SEEN_KEY) || '{}');
  } catch {
    return {};
  }
};

/**
 * v0.45 拾穗的节奏：0924 给未来的穗（到期来信 + 封存中几穗）、0942 一年前的今天（只在打开时安静出现，不推送）、
 * 0311 作品停了 7 天（同一段停顿只推一次）、0843 补一句为什么（拾进来 24 小时还没写的，最多 3 条）
 */
function RhythmNotes({ items, now }: { items: Item[]; now: number }) {
  const { openItem, toast, go } = useApp();
  const [, bump] = useState(0);
  const day = new Date(now).toDateString();
  const works = useLiveQuery(() => db.works.toArray(), []);
  const letters = useMemo(() => dueLetters(items, now), [items, now]);
  const sealedN = useMemo(() => sealedSummary(items, now), [items, now]);
  const year = useMemo(() => yearAgo(items, now), [items, now]);
  const why = useMemo(() => needWhy(items, now), [items, now]);
  const stale = useMemo(() => (works ? staleWork(works, readSeen(), now) : null), [works, now]);
  const hide = (k: string) => (localStorage.setItem(k, day), bump((x) => x + 1));
  async function open(it: Item) {
    await unsealItem(it.id!);
    toast(`拆开了：${daysBetween(it.sealAt || it.createdAt, now)} 天前封存的一穗回到穗仓`);
    openItem({ ...it, sealUntil: undefined, sealAt: undefined });
  }
  function seenWork() {
    if (!stale?.work.uid) return;
    const s = readSeen();
    s[stale.work.uid] = stale.work.updatedAt || stale.work.createdAt;
    localStorage.setItem(WORK_SEEN_KEY, JSON.stringify(s));
    bump((x) => x + 1);
  }
  const showYear = !!year && localStorage.getItem(YEAR_OFF) !== day;
  const showWhy = why.length > 0 && localStorage.getItem(WHY_OFF) !== day;
  if (!letters.length && !sealedN.n && !showYear && !stale && !showWhy) return null;
  return (
    <>
      {letters.length > 0 && (
        <div className="note-row review-card letter-card">
          <span className="label">给未来的穗 · 到了 {letters.length > 1 && <span className="num">({letters.length})</span>}</span>
          {letters.slice(0, 3).map((it) => (
            <span key={it.id} className="lost-row letter-row">
              <span className="meta-text">
                {shortDate(it.sealAt || it.createdAt)} 封存的一穗 · 等了 <span className="num">{daysBetween(it.sealAt || it.createdAt, now)}</span> 天
              </span>
              <button className="btn text strong letter-open" onClick={() => void open(it)}>
                拆开
              </button>
            </span>
          ))}
        </div>
      )}
      {sealedN.n > 0 && !letters.length && (
        <div className="note-row sealed-row">
          <span className="meta-text">
            封存中 <span className="num">{sealedN.n}</span> 穗 · 最早 {shortDate(sealedN.next!)} 拆开
          </span>
        </div>
      )}
      {showYear && (
        <div className="note-row review-card yearago-card">
          <span className="label">一年前的今天</span>
          <span className="lost-row">
            <button className="linklike yearago-open" data-item-id={year.id} onClick={() => openItem(year)}>
              {displayTitle(year)}
            </button>
            <span className="meta-text">{new Date(year.createdAt).getFullYear()} 年拾的</span>
            <button className="btn text faint yearago-skip" onClick={() => hide(YEAR_OFF)}>
              收起
            </button>
          </span>
        </div>
      )}
      {stale && (
        <div className="note-row stale-row">
          <span className="meta-text">
            《{stale.work.title || '无题'}》停了 <span className="num">{stale.days}</span> 天，补一穗？
          </span>
          <span className="note-acts">
            <button className="btn text strong stale-go" onClick={() => (seenWork(), go('works'))}>
              去看看
            </button>
            <button className="btn text faint stale-skip" onClick={seenWork}>
              先放着
            </button>
          </span>
        </div>
      )}
      {showWhy && (
        <div className="note-row review-card needwhy-card">
          <span className="label">补一句为什么</span>
          {why.map((it) => (
            <span key={it.id} className="lost-row">
              <button className="linklike needwhy-open" data-item-id={it.id} onClick={() => openItem(it)}>
                {displayTitle(it)}
              </button>
              <span className="meta-text">{shortDate(it.createdAt)} 拾的</span>
            </span>
          ))}
          <span className="note-acts">
            <button className="btn text faint needwhy-skip" onClick={() => hide(WHY_OFF)}>
              今天不补
            </button>
          </span>
        </div>
      )}
    </>
  );
}
