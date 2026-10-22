import { useEffect, useMemo, useRef, useState } from 'react';
import { buildHeatmap, itemsOnDay } from '../lib/heatmap';
import { formatWhen } from '../lib/quick';
import { useApp } from '../lib/store';
import { TYPE_LABEL, type Item } from '../lib/types';

const ROW_LABELS = ['一', '', '三', '', '五', '', '日'];

export function HeatmapPanel({ items }: { items: Item[] }) {
  const { openItem } = useApp();
  const h = useMemo(() => buildHeatmap(items), [items]);
  const [sel, setSel] = useState<string | null>(null);
  const day = sel ? itemsOnDay(items, sel) : [];
  const selCell = sel ? h.cells.find((c) => c.key === sel) : null;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 默认滚到最右（今天）
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [h.weeks]);
  return (
    <section className="heat taste-sec">
      <div className="label">
        拾穗的日子 · 近 365 天 <span className="dim">· {h.total} 穗 / {h.activeDays} 天</span>
      </div>
      <div className="heat-scroll" ref={scroller} tabIndex={0} aria-label="拾穗热力图，可横向滚动">
        <div className="heat-wrap" style={{ ['--weeks' as string]: h.weeks }}>
          <div className="heat-months" aria-hidden>
            {h.months.map((m) => (
              <span key={m.col + m.label} style={{ gridColumn: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heat-rows" aria-hidden>
            {ROW_LABELS.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
          <div className="heat-grid" role="grid">
            {h.cells.map((c) => (
              <button
                key={c.key}
                role="gridcell"
                className={`heat-cell lv${c.level}${sel === c.key ? ' sel' : ''}`}
                style={{ gridColumn: c.col + 1, gridRow: c.row + 1 }}
                title={`${c.key} · ${c.count} 穗`}
                aria-label={`${c.key}，${c.count} 穗`}
                onClick={() => setSel(sel === c.key ? null : c.key)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="heat-legend dim" aria-hidden>
        少 {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heat-cell lv${l}`} />)} 多
      </div>
      {selCell && (
        <div className="heat-day">
          <div className="label">
            {selCell.key} · {selCell.count} 穗
          </div>
          {day.length === 0 ? (
            <p className="dim">这天没有下田。</p>
          ) : (
            <ul className="plain heat-list">
              {day.map((it) => (
                <li key={it.id}>
                  <button className="linklike" onClick={() => openItem(it)}>
                    <span className="dim num">{formatWhen(it.createdAt).replace(/^.*?(\d\d:\d\d)$/, '$1')}</span> {TYPE_LABEL[it.type]} · {it.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
