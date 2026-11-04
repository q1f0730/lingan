// v0.40 穗仓里的两张回看卡（懒加载，首屏画完、空闲后才来）：
// 0922 / 0155 周日的「本周拾穗 · 周记」三问；ROADMAP v0.37 每月 1–7 号「上个月的麦捆」（一月顺带「一年的麦田」）+ 0925 被遗忘的好东西（留着 / 放下）。
import { useMemo, useState } from 'react';
import { addItem, keepAround, setDown } from '../lib/repo';
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
  if (!showWeek && !showSheaf) return null;
  return (
    <>
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
