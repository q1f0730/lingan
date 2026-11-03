// v0.29 0308 自由情绪板：一块大画布（transform 平移 + 缩放），穗图 / 穗字 / 自由文字 / 灰阶色块随便摆。
// 桌面：拖块移动、拖空白处平移、滚轮缩放；手机：单指拖、双指捏合缩放。存在作品的 board 字段里（停手 400ms 写库）。
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { itemHasImage } from '../lib/imagestore';
import { useApp } from '../lib/store';
import { TYPE_LABEL, type BoardNode, type Item, type Work } from '../lib/types';
import { useThumbSrc } from '../lib/useImage';
import { itemsByUids } from '../lib/workstore';
import { BOARD_H, BOARD_W, boardFrom, clampZoom, GRAYS, zoomAt } from '../lib/works';

const rid = () => Math.random().toString(36).slice(2, 10);
type View = { x: number; y: number; k: number };

function NodeImg({ it }: { it: Item }) {
  const src = useThumbSrc(it);
  return src ? <img src={src} alt="" draggable={false} decoding="async" /> : null;
}

export default function WorkBoard({ work, mats, save }: { work: Work; mats: Item[]; save: (c: Partial<Work>) => void }) {
  const { openItem } = useApp();
  const [nodes, setNodesRaw] = useState<BoardNode[]>(work.board?.nodes || []);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 0.5 });
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const latest = useRef(nodes);
  const setNodes = (n: BoardNode[]) => {
    latest.current = n;
    setNodesRaw(n);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save({ board: { nodes: latest.current } }), 400);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (latest.current !== (work.board?.nodes || [])) save({ board: { nodes: latest.current } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const uids = useMemo(() => [...new Set(nodes.filter((n) => n.kind === 'item' && n.uid).map((n) => n.uid!))], [nodes]);
  const rows = useLiveQuery(() => itemsByUids(uids), [uids.join(',')]);
  const byUid = useMemo(() => new Map((rows || []).map((x) => [x.uid!, x])), [rows]);

  // 适配：把所有块放进视口
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!nodes.length) return setView({ x: 20, y: 20, k: clampZoom(Math.min(W / BOARD_W, H / BOARD_H)) });
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    const k = clampZoom(Math.min((W - 32) / Math.max(1, maxX - minX), (H - 32) / Math.max(1, maxY - minY), 1.2));
    setView({ x: 16 - minX * k, y: 16 - minY * k, k });
  };
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 指针：拖块 / 平移 / 双指缩放
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ kind: 'node' | 'pan'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; k: number; cx: number; cy: number; v: View } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: React.PointerEvent, id?: string) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, local(e));
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: view };
      drag.current = null;
      return;
    }
    const n = id ? nodes.find((x) => x.id === id) : undefined;
    if (n) {
      setSel(n.id);
      drag.current = { kind: 'node', id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
    } else {
      setSel(null);
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, local(e));
    if (pinch.current && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const p = pinch.current;
      setView(zoomAt(p.v, p.cx, p.cy, p.k * (d / Math.max(1, p.d))));
      return;
    }
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
    if (g.kind === 'pan') setView((v) => ({ ...v, x: g.ox + dx, y: g.oy + dy }));
    else if (g.id) {
      const nx = Math.round(Math.max(-200, Math.min(BOARD_W, g.ox + dx / view.k)));
      const ny = Math.round(Math.max(-200, Math.min(BOARD_H, g.oy + dy / view.k)));
      setNodesRaw((ns) => ns.map((n) => (n.id === g.id ? { ...n, x: nx, y: ny } : n)));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    const g = drag.current;
    drag.current = null;
    if (g?.kind === 'node' && g.moved) setNodes(latestFrom());
  };
  // setNodesRaw 在拖动中更新；松手时取当前 state 存库
  const stateRef = useRef(nodes);
  stateRef.current = nodes;
  const latestFrom = () => stateRef.current;
  // 滚轮缩放：React 的 onWheel 是被动监听、拦不住页面滚动，这里自己挂非被动的
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => zoomAt(v, px, py, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const center = () => {
    const el = wrap.current;
    const W = el?.clientWidth || 600;
    const H = el?.clientHeight || 400;
    return { x: Math.round((W / 2 - view.x) / view.k), y: Math.round((H / 2 - view.y) / view.k) };
  };
  const addText = () => {
    const c = center();
    const n: BoardNode = { id: rid(), kind: 'text', x: c.x - 120, y: c.y - 40, w: 240, h: 80, text: '一句话' };
    setNodes([...nodes, n]);
    setSel(n.id);
  };
  const addColor = (color: string) => {
    const c = center();
    const n: BoardNode = { id: rid(), kind: 'color', x: c.x - 80, y: c.y - 80, w: 160, h: 160, color };
    setNodes([...nodes, n]);
    setSel(n.id);
  };
  const placeMats = () => {
    const have = new Set(nodes.map((n) => n.uid));
    const fresh = boardFrom(mats.filter((m) => !have.has(m.uid)));
    if (!fresh.length) return;
    const maxY = nodes.length ? Math.max(...nodes.map((n) => n.y + n.h)) + 40 : 0;
    setNodes([...nodes, ...fresh.map((n) => ({ ...n, y: n.y + maxY }))]);
    setTimeout(fit, 30);
  };
  const selected = nodes.find((n) => n.id === sel);
  const resize = (f: number) => selected && setNodes(nodes.map((n) => (n.id === sel ? { ...n, w: Math.round(Math.max(60, Math.min(900, n.w * f))), h: Math.round(Math.max(40, Math.min(900, n.h * f))) } : n)));
  const remove = () => {
    if (!sel) return;
    setNodes(nodes.filter((n) => n.id !== sel));
    setSel(null);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        remove();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <div className="work-board">
      <div className="board-bar text-actions actions">
        <button className="btn text strong board-place" onClick={placeMats} disabled={!mats.length}>
          把素材摆上
        </button>
        <button className="btn text board-text" onClick={addText}>
          + 文字
        </button>
        <span className="board-colors" role="group" aria-label="加一块色块">
          {GRAYS.map((c) => (
            <button key={c} className="board-swatch" style={{ background: c }} onClick={() => addColor(c)} aria-label={`加色块 ${c}`} />
          ))}
        </span>
        <button className="btn text board-fit" onClick={fit}>
          看全部
        </button>
        <span className="meta-text board-zoom num">{Math.round(view.k * 100)}%</span>
      </div>
      {selected && (
        <div className="board-sel text-actions actions">
          <span className="label">已选 · {selected.kind === 'item' ? '穗' : selected.kind === 'text' ? '文字' : '色块'}</span>
          <button className="btn text" onClick={() => resize(1.2)} aria-label="放大">
            放大
          </button>
          <button className="btn text" onClick={() => resize(1 / 1.2)} aria-label="缩小">
            缩小
          </button>
          {selected.kind === 'item' && selected.uid && byUid.get(selected.uid) && (
            <button className="btn text" onClick={() => openItem(byUid.get(selected.uid!)!)}>
              打开这穗
            </button>
          )}
          <button className="btn text faint danger board-del" onClick={remove}>
            拿掉
          </button>
        </div>
      )}
      <div
        ref={wrap}
        className="board-wrap"
        onPointerDown={(e) => onDown(e)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="application"
        aria-label="情绪板：拖动摆放，滚轮或双指缩放"
      >
        <div className="board-canvas" style={{ width: BOARD_W, height: BOARD_H, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          {nodes.map((n) => {
            const it = n.uid ? byUid.get(n.uid) : undefined;
            return (
              <div
                key={n.id}
                className={`board-node bn-${n.kind}${sel === n.id ? ' on' : ''}`}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h, background: n.kind === 'color' ? n.color : undefined }}
                onPointerDown={(e) => onDown(e, n.id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                data-node={n.kind}
              >
                {n.kind === 'item' &&
                  (it ? (
                    itemHasImage(it) ? (
                      <NodeImg it={it} />
                    ) : (
                      <div className="bn-card">
                        <span className="label">{TYPE_LABEL[it.type]}</span>
                        <span className="bn-title">{it.title}</span>
                        {it.why && <span className="bn-why">{it.why}</span>}
                      </div>
                    )
                  ) : (
                    <div className="bn-card gone meta-text">这穗已经不在了</div>
                  ))}
                {n.kind === 'text' &&
                  (sel === n.id ? (
                    <textarea
                      className="bn-text-edit"
                      value={n.text || ''}
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => setNodes(nodes.map((x) => (x.id === n.id ? { ...x, text: e.target.value.slice(0, 200) } : x)))}
                      aria-label="情绪板文字"
                    />
                  ) : (
                    <span className="bn-text-v">{n.text}</span>
                  ))}
              </div>
            );
          })}
        </div>
        {!nodes.length && <p className="board-empty meta-text">空板。点「把素材摆上」，或加文字、色块。</p>}
      </div>
    </div>
  );
}
