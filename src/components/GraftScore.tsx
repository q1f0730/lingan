// v0.42 ROADMAP v0.32 嫁接成绩：证据覆盖 / 三枝差异 / 平均意外 / 采用率 + 0239 高产穗 + 0240 变形法胜率（口味页）
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../lib/db';
import { graftScore } from '../lib/graftlab';
import { useApp } from '../lib/store';
import { displayTitle } from '../lib/studio';
import type { Item } from '../lib/types';

const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function GraftScore({ items }: { items: Item[] }) {
  const { openItem } = useApp();
  const devs = useLiveQuery(() => db.developments.toArray(), []);
  const s = useMemo(() => (devs ? graftScore(devs) : null), [devs]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id!, i])), [items]);
  if (!s || !s.n) return null;
  const seeds = s.seeds.filter((x) => byId.has(x.id));
  return (
    <section className="taste-sec graft-score">
      <div className="table two-col">
        <div className="thead">
          <span className="tc">嫁接成绩</span>
          <span className="tc tc-date">{s.n} 根</span>
        </div>
        <div className="trow static gs-evidence" title="说得出从哪几穗长出来的（≥3 穗）占比，早先长的不算">
          <span className="tc tc-title">证据覆盖</span>
          <span className="tc tc-date num">{pct(s.evidence)}</span>
        </div>
        <div className="trow static gs-diff" title="每次三根里最像的那一对，1 − 相似度，再平均">
          <span className="tc tc-title">三枝差异</span>
          <span className="tc tc-date num">{pct(s.diff)}</span>
        </div>
        <div className="trow static gs-surprise">
          <span className="tc tc-title">
            平均意外 <span className="n">（评了 {s.rated} 根）</span>
          </span>
          <span className="tc tc-date num">{s.surprise == null ? '—' : s.surprise.toFixed(1)}</span>
        </div>
        <div className="trow static gs-adopt" title="留下、推进到试过 / 做成、复制或分享过、追问或再嫁接过的占比">
          <span className="tc tc-title">采用率</span>
          <span className="tc tc-date num">{pct(s.adoption)}</span>
        </div>
      </div>
      {seeds.length > 0 && (
        <div className="table two-col gs-seeds">
          <div className="thead">
            <span className="tc">高产穗</span>
            <span className="tc tc-date">用上的新枝</span>
          </div>
          {seeds.map((x) => (
            <button key={x.id} className="trow gs-seed" onClick={() => openItem(byId.get(x.id)!)}>
              <span className="tc tc-title">{displayTitle(byId.get(x.id)!)}</span>
              <span className="tc tc-date num">{x.n}</span>
            </button>
          ))}
        </div>
      )}
      {s.transforms.length > 0 && (
        <div className="table two-col gs-trans">
          <div className="thead">
            <span className="tc">变形法</span>
            <span className="tc tc-date">用上 / 长出</span>
          </div>
          {s.transforms.map((t) => (
            <div key={t.t} className="trow static gs-t" data-t={t.t}>
              <span className="tc tc-title">{t.name}</span>
              <span className="tc tc-date num">
                {t.won} / {t.n}
              </span>
            </div>
          ))}
          <p className="meta-text gs-note">用上得多的变形法，AI 收拢时会在同等条件下优先（至少 12 根后才开始）。</p>
        </div>
      )}
    </section>
  );
}
