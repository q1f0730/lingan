import { useEffect, useMemo, useRef, useState } from 'react';
import { motifMap, stars, type MotifMap } from '../lib/motifs';
import { useApp } from '../lib/store';
import { displayTitle } from '../lib/studio';
import { TYPE_LABEL, type Item } from '../lib/types';

/** v0.38 口味页：母题（0106 / 0123 / 0124）+ 星图（ROADMAP v0.39）。算在空闲里做，不挡口味页首帧 */
export function MotifPanel({ items }: { items: Item[] }) {
  const { openItem } = useApp();
  const [map, setMap] = useState<MotifMap | null>();
  const [open, setOpen] = useState(-1);
  useEffect(() => {
    const t = setTimeout(() => setMap(motifMap(items)), 40);
    return () => clearTimeout(t);
  }, [items]);
  const byId = useMemo(() => new Map(items.map((x) => [x.id!, x])), [items]);
  if (map === undefined) return null;
  if (!map)
    return (
      <section className="taste-sec wide motif-sec">
        <div className="label">母题</div>
        <p className="meta-text">拾满 12 穗之后，这里会把它们按意思聚成几个反复出现的母题。</p>
      </section>
    );
  return (
    <>
      <section className="taste-sec wide motif-sec">
        <div className="label">
          母题 <span className="num">({map.motifs.length})</span> <span className="dim">· {map.how === 'vector' ? '按向量聚' : '按标签和为什么聚（配上向量会更准）'}</span>
        </div>
        <div className="table two-col">
          {map.motifs.map((m, i) => (
            <div key={m.c} className="motif">
              <button className="trow motif-row" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                <span className="tc tc-title">
                  {m.name} <span className="n">({m.ids.length})</span>
                  {m.words.length > 0 && <span className="dim"> {m.words.join(' · ')}</span>}
                </span>
                <span className="tc meta-text">
                  {m.cross ? `跨媒介 · ${m.types.map((t) => TYPE_LABEL[t]).join(' ')} · ` : ''}
                  {m.trend > 0 && m.recent > 1 ? `升起 +${m.trend}` : m.trend < 0 && !m.recent ? '冷下来了' : `近 60 天 ${m.recent}`}
                </span>
              </button>
              {open === i && (
                <ul className="plain motif-items">
                  {m.ids.slice(0, 8).map((id) => {
                    const x = byId.get(id);
                    return x ? (
                      <li key={id}>
                        <button className="linklike" data-item-id={id} onClick={() => openItem(x, m.ids)}>
                          {displayTitle(x)}
                        </button>
                      </li>
                    ) : null;
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
      <StarMap map={map} byId={byId} />
    </>
  );
}

type View = { s: number; x: number; y: number };

/** 星图：近的挨着、远的离得远。拖动平移、滚轮 / 按钮缩放，点两颗星一键嫁接 */
function StarMap({ map, byId }: { map: MotifMap; byId: Map<number, Item> }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="taste-sec wide star-sec">
      <div className="label">
        星图 <span className="num">({map.ids.length})</span> <span className="dim">· 近的挨着，远的离得远；点两颗远星去嫁接</span>
      </div>
      {open ? (
        <Stars map={map} byId={byId} />
      ) : (
        <button className="btn text strong star-open" onClick={() => setOpen(true)}>
          展开星图
        </button>
      )}
    </section>
  );
}

function Stars({ map, byId }: { map: MotifMap; byId: Map<number, Item> }) {
  const { developFrom, openItem } = useApp();
  const pts0 = useMemo(() => stars(map), [map]);
  const ref = useRef<HTMLCanvasElement>(null);
  const [v, setV] = useState<View>({ s: 1, x: 0, y: 0 });
  const [sel, setSel] = useState<number[]>([]);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  const centers = useMemo(
    () =>
      map.motifs.slice(0, 10).map((m) => {
        const ps = pts0.filter((p) => p.c === m.c);
        return { name: m.name, x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
      }),
    [map, pts0],
  );
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const w = c.clientWidth,
        h = c.clientHeight,
        r = window.devicePixelRatio || 1;
      c.width = w * r;
      c.height = h * r;
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(r, 0, 0, r, 0, 0);
      const fg = getComputedStyle(c).color;
      const at = (x: number, y: number) => [w / 2 + (x * v.s + v.x) * (w / 2 - 16), h / 2 + (y * v.s + v.y) * (h / 2 - 16)];
      const pts: Array<[number, number, number]> = [];
      g.fillStyle = fg;
      for (const p of pts0) {
        const [x, y] = at(p.x, p.y);
        pts.push([x, y, p.id]);
        const on = sel.includes(p.id);
        g.globalAlpha = on ? 1 : 0.55;
        g.beginPath();
        g.arc(x, y, on ? 5 : 2.5, 0, 7);
        g.fill();
      }
      g.globalAlpha = 0.8;
      g.font = '600 12px "Glean Inter","Glean Sans",sans-serif';
      for (const m of centers) {
        const [x, y] = at(m.x, m.y);
        g.fillText(m.name, Math.max(2, Math.min(w - g.measureText(m.name).width - 2, x + 6)), Math.max(14, y - 6));
      }
      (c as HTMLCanvasElement & { _pts?: typeof pts })._pts = pts;
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [pts0, v, sel, centers]);
  const zoom = (f: number) => setV((o) => ({ s: Math.min(12, Math.max(1, o.s * f)), x: o.x * f, y: o.y * f }));
  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const pts = (e.currentTarget as HTMLCanvasElement & { _pts?: Array<[number, number, number]> })._pts || [];
    let best = -1,
      bd = 18 * 18;
    for (const [x, y, id] of pts) {
      const d = (x - e.clientX + b.left) ** 2 + (y - e.clientY + b.top) ** 2;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    if (best >= 0) setSel((s) => (s.includes(best) ? s.filter((x) => x !== best) : [...s, best].slice(-2)));
  };
  const chosen = sel.map((id) => byId.get(id)).filter((x): x is Item => !!x);
  return (
    <>
      <canvas
        ref={ref}
        className="star-map"
        aria-label="星图"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, v, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
          if (d.moved) {
            const w = e.currentTarget.clientWidth / 2 - 16,
              h = e.currentTarget.clientHeight / 2 - 16;
            setV({ ...d.v, x: d.v.x + dx / w, y: d.v.y + dy / h });
          }
        }}
        onPointerUp={(e) => {
          if (drag.current && !drag.current.moved) pick(e);
          drag.current = null;
        }}
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.25 : 0.8)}
      />
      <div className="star-bar">
        <span className="seg">
          <button onClick={() => zoom(1.5)}>放大</button>
          <button onClick={() => zoom(1 / 1.5)}>缩小</button>
          <button onClick={() => setV({ s: 1, x: 0, y: 0 })}>复位</button>
        </span>
        {chosen.map((x) => (
          <button key={x.id} className="linklike star-pick" onClick={() => openItem(x)}>
            {displayTitle(x)}
          </button>
        ))}
        {chosen.length === 2 && (
          <button className="btn primary star-graft" onClick={() => developFrom(sel)}>
            嫁接这两颗
          </button>
        )}
      </div>
    </>
  );
}
