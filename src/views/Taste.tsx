import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { chat } from '../lib/ai';
import { db } from '../lib/db';
import { HeatmapPanel } from '../components/Heatmap';
import { DisplayTitle, Loading } from '../components/DisplayTitle';
import { aiReady } from '../lib/settings';
import { useApp } from '../lib/store';
import { displayTitle } from '../lib/studio';
import { computeTaste, tastePrompt } from '../lib/taste';
import { TYPE_LABEL, TYPE_ORDER, type Item } from '../lib/types';

const TASTE_KEY = 'lingan.taste.ai';
const TASTE_AT = 'lingan.taste.at';
const DAY = 86400000;
const WD = ['日', '一', '二', '三', '四', '五', '六'];

/** 最近冷下来的：30 天前常拾、最近 30 天一次没出现的标签 */
function cooled(items: Item[], now = Date.now()): Array<{ tag: string; n: number; last: number }> {
  const recent = new Set(items.filter((i) => i.createdAt >= now - 30 * DAY).flatMap((i) => i.tags));
  const m = new Map<string, { n: number; last: number }>();
  for (const it of items) {
    if (it.createdAt >= now - 30 * DAY) continue;
    for (const t of it.tags) {
      if (recent.has(t)) continue;
      const x = m.get(t) || { n: 0, last: 0 };
      x.n++;
      x.last = Math.max(x.last, it.createdAt);
      m.set(t, x);
    }
  }
  return [...m.entries()].filter(([, v]) => v.n >= 2).map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.n - a.n).slice(0, 5);
}

/** 口味（m4 / d5）：一句开头判断 → 倾向 / 来自这些穗 两列无线表格 → 构成 → 最近冷下来的 → 拾穗的日子。不出现分数、比例、雷达图 */
export function Taste() {
  const { settings, toast, go, openItem } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const stats = useMemo(() => (items ? computeTaste(items) : null), [items]);
  const [portrait, setPortrait] = useState<string>(() => localStorage.getItem(TASTE_KEY) || '');
  const [at, setAt] = useState<string>(() => localStorage.getItem(TASTE_AT) || '');
  const [busy, setBusy] = useState(false);
  const leaning = useMemo(() => {
    if (!items || !stats) return [];
    return stats.topTags.slice(0, 8).map(([t, n]) => ({ t, n, from: items.filter((i) => i.tags.includes(t)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3) }));
  }, [items, stats]);
  const cold = useMemo(() => (items ? cooled(items) : []), [items]);

  if (!items || !stats) return <Loading />;
  const topType = TYPE_ORDER.slice().sort((a, b) => stats.byType[b] - stats.byType[a])[0];
  const lead = items.length
    ? `你最常拾的是${TYPE_LABEL[topType]}${stats.topTags.length ? `，反复出现的是 ${stats.topTags.slice(0, 3).map(([t]) => t).join('、')}` : ''}。`
    : '还没有穗，拾几穗之后再来看口味。';

  async function genPortrait() {
    if (!items || items.length < 3) {
      toast('至少拾 3 穗再来看口味', 'err');
      return;
    }
    setBusy(true);
    try {
      const out = await chat(
        settings,
        [
          {
            role: 'system',
            content:
              '你是一个毒舌但精准的审美侧写师。根据用户的私人收藏，写出他的口味画像。不要恭维，不要泛泛而谈，不要用"独特""多元"这类空词。用中文，分四段，每段以【】小标题开头：【反复出现的母题】【你被什么击中】【你在回避什么】【盲区与下一步】。每段 2-3 句，总共不超过 320 字。',
          },
          { role: 'user', content: tastePrompt(items) },
        ],
        { temperature: 0.8, maxTokens: 900 },
      );
      const now = new Date().toLocaleString('zh-CN');
      localStorage.setItem(TASTE_KEY, out);
      localStorage.setItem(TASTE_AT, now);
      setPortrait(out);
      setAt(now);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setBusy(false);
    }
  }

  const t0 = new Date();
  t0.setHours(0, 0, 0, 0);
  return (
    <section className="view taste">
      <DisplayTitle title="口味" />
      <p className="lead taste-lead">{lead}</p>
      <p className="taste-facts meta-text">
        <span className="stat-n num">{stats.total}</span> 穗 · <span className="stat-n num">{stats.topTags.length}</span> 个常用标签 · 连着拾了 <span className="stat-n num">{stats.streakDays}</span> 天
      </p>

      <div className="taste-grid">
        {leaning.length > 0 && (
          <section className="taste-sec wide">
            <div className="table two-col">
              <div className="thead">
                <span className="tc">倾向</span>
                <span className="tc">来自这些穗</span>
              </div>
              {leaning.map((r) => (
                <div key={r.t} className="trow static">
                  <span className="tc tc-title">
                    {r.t} <span className="n">({r.n})</span>
                  </span>
                  <span className="tc tc-src">
                    {r.from.map((it, i) => (
                      <span key={it.id}>
                        {i > 0 && ' / '}
                        <button className="linklike" onClick={() => openItem(it)}>
                          {displayTitle(it)}
                        </button>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="taste-sec">
          <div className="table two-col">
            <div className="thead">
              <span className="tc">构成</span>
              <span className="tc tc-date">穗</span>
            </div>
            {TYPE_ORDER.map((t) => (
              <div key={t} className="trow static">
                <span className="tc tc-title">{TYPE_LABEL[t]}</span>
                <span className="tc tc-date num">{stats.byType[t]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="taste-sec">
          <div className="table two-col">
            <div className="thead">
              <span className="tc">最近 7 天</span>
              <span className="tc tc-date">穗</span>
            </div>
            {stats.last7.map((n, i) => {
              const d = new Date(t0.getTime() - (6 - i) * DAY);
              return (
                <div key={i} className="trow static">
                  <span className="tc tc-title">{i === 6 ? '今天' : `${d.getMonth() + 1}/${d.getDate()} 周${WD[d.getDay()]}`}</span>
                  <span className="tc tc-date num">{n}</span>
                </div>
              );
            })}
          </div>
        </section>

        {(stats.topCreators.length > 0 || stats.decades.length > 0) && (
          <section className="taste-sec">
            {stats.topCreators.length > 0 && (
              <div className="table two-col">
                <div className="thead">
                  <span className="tc">常客</span>
                  <span className="tc tc-date">穗</span>
                </div>
                {stats.topCreators.map(([c, n]) => (
                  <div key={c} className="trow static">
                    <span className="tc tc-title">{c}</span>
                    <span className="tc tc-date num">{n}</span>
                  </div>
                ))}
              </div>
            )}
            {stats.decades.length > 0 && (
              <div className="table two-col">
                <div className="thead">
                  <span className="tc">年代</span>
                  <span className="tc tc-date">穗</span>
                </div>
                {stats.decades.map(([d, n]) => (
                  <div key={d} className="trow static">
                    <span className="tc tc-title num">{d}</span>
                    <span className="tc tc-date num">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {stats.whyWords.length > 0 && (
          <section className="taste-sec">
            <div className="label">「为什么」里常出现的词</div>
            <p className="word-row">
              {stats.whyWords.map(([w, n]) => (
                <span key={w} className="tag">
                  {w} <span className="n">{n}</span>
                </span>
              ))}
            </p>
          </section>
        )}

        <section className="taste-sec">
          <div className="label">最近冷下来的</div>
          {cold.length ? (
            <div className="table two-col">
              {cold.map((c) => (
                <div key={c.tag} className="trow static">
                  <span className="tc tc-title">
                    {c.tag} <span className="n">({c.n})</span>
                  </span>
                  <span className="tc tc-date meta-text">{Math.round((Date.now() - c.last) / DAY)} 天没出现</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="meta-text">暂时没有冷下来的标签。</p>
          )}
        </section>
      </div>

      <HeatmapPanel items={items} />

      <section className="taste-sec portrait">
        <div className="label">AI 侧写 {at && <span className="dim">· {at}</span>}</div>
        {portrait ? <div className="portrait-text">{portrait}</div> : <p className="meta-text">让 AI 读一遍你拾的穗，说说你到底喜欢什么。嫁接时也会参考这份口味。</p>}
        <div className="actions">
          {aiReady(settings) ? (
            <button className="btn primary" onClick={genPortrait} disabled={busy}>
              {busy ? '侧写中…' : portrait ? '重新侧写' : '生成侧写'}
            </button>
          ) : (
            <button className="btn text strong" onClick={() => go('settings')}>
              先配置 AI
            </button>
          )}
        </div>
      </section>
    </section>
  );
}
