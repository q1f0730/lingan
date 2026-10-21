import { useMemo, useState } from 'react';
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
  return (
    <div className="panel heat">
      <div className="label mono">
        收集热力图 · 近 365 天 <span className="dim">· {h.total} 件 / {h.activeDays} 天 · 最长连续 {h.longest} 天</span>
      </div>
      <div className="heat-scroll" tabIndex={0} aria-label="收集热力图，可横向滚动">
        <div className="heat-wrap" style={{ ['--weeks' as string]: h.weeks }}>
          <div className="heat-months mono" aria-hidden>
            {h.months.map((m) => (
              <span key={m.col + m.label} style={{ gridColumn: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heat-rows mono" aria-hidden>
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
                title={`${c.key} · ${c.count} 件`}
                aria-label={`${c.key}，${c.count} 件`}
                onClick={() => setSel(sel === c.key ? null : c.key)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="heat-legend mono dim" aria-hidden>
        少 {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heat-cell lv${l}`} />)} 多
        <span className="heat-streak">{h.current > 0 ? `当前连续 ${h.current} 天` : '今天收一件，开始新的连续'}</span>
      </div>
      {selCell && (
        <div className="heat-day">
          <div className="label mono">
            {selCell.key} · {selCell.count} 件
          </div>
          {day.length === 0 ? (
            <p className="dim">这天暗房没开灯。</p>
          ) : (
            <ul className="plain heat-list">
              {day.map((it) => (
                <li key={it.id}>
                  <button className="linklike" onClick={() => openItem(it)}>
                    <span className="mono dim">{formatWhen(it.createdAt).replace(/^.*?(\d\d:\d\d)$/, '$1')}</span> {TYPE_LABEL[it.type]} · {it.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
