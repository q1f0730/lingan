import { useEffect, useRef, useState } from 'react';
import { basketHint, getBasket, toggleBasket } from '../lib/basket';
import { db } from '../lib/db';
import { setGarden } from '../lib/repo';
import { useApp } from '../lib/store';
import { displayTitle } from '../lib/studio';
import type { Item } from '../lib/types';

import { LONG_PRESS_MS, MOVE_TOL } from '../lib/press';

export { LONG_PRESS_MS };

/** 菜单放在哪：贴着点的位置，但不出屏幕（纯函数，单测覆盖） */
export function placeMenu(x: number, y: number, w: number, h: number, vw: number, vh: number, pad = 8): { left: number; top: number } {
  const left = Math.max(pad, Math.min(x, vw - w - pad));
  const top = y + h + pad > vh ? Math.max(pad, y - h) : y;
  return { left, top: Math.max(pad, Math.min(top, vh - h - pad)) };
}

type Act = 'open' | 'edit' | 'graft' | 'basket' | 'copy' | 'link' | 'glean' | 'share' | 'garden' | 'delete';

/**
 * v0.27 0411：长按卡片（手机）或右键（电脑）弹出上下文菜单：打开 / 编辑 / 拿去嫁接 / 复制文字 / 复制链接 / 删掉。
 * 认 `[data-item-id]`（网格卡、列表行、时间线帧、月历行），有弹层时不出。
 */
export function CardMenu({ blocked, onAct, early, onLive }: { blocked: boolean; early?: { id: number; x: number; y: number; n: number } | null; onLive?: () => void; onAct: (a: Exclude<Act, 'copy' | 'link' | 'glean' | 'basket' | 'share' | 'garden'>, it: Item) => void }) {
  const { toast, desktop } = useApp();
  const [st, setSt] = useState<{ it: Item; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const lastOpen = useRef(0);
  const openRef = useRef<(id: number, x: number, y: number) => void>(() => {});

  useEffect(() => {
    const hit = (t: EventTarget | null) => {
      const el = (t as HTMLElement | null)?.closest?.('[data-item-id]') as HTMLElement | null;
      if (!el || !el.closest('.main')) return null;
      const id = Number(el.dataset.itemId);
      return Number.isFinite(id) ? id : null;
    };
    const open = async (id: number, x: number, y: number) => {
      if (blockedRef.current) return;
      const it = await db.items.get(id);
      if (!it || it.deletedAt) return;
      setPos(null);
      setSt({ it, x, y });
    };
    openRef.current = (id, x, y) => void open(id, x, y);
    const onCtx = (e: MouseEvent) => {
      const id = hit(e.target);
      if (id == null || blockedRef.current) return;
      e.preventDefault();
      // 安卓长按也会发 contextmenu：我们自己的长按已经开过就不再开
      if (Date.now() - lastOpen.current < 700) return;
      void open(id, e.clientX, e.clientY);
    };
    let timer = 0;
    let start: { x: number; y: number; id: number } | null = null;
    let fired = false;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    const onDown = (e: PointerEvent) => {
      // 新的一次按下：上一次长按留下的「吞掉松手 click」作废（松手时没产生 click 的情况）
      fired = false;
      if (e.pointerType === 'mouse') return;
      const id = hit(e.target);
      if (id == null) return;
      start = { x: e.clientX, y: e.clientY, id };
      timer = window.setTimeout(() => {
        if (!start) return;
        fired = true;
        lastOpen.current = Date.now();
        navigator.vibrate?.(12);
        void open(start.id, start.x, start.y);
        start = null;
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOL) cancel();
    };
    // 长按开了菜单，松手那一下的 click 不能再打开详情
    const onClick = (e: MouseEvent) => {
      if (fired) {
        fired = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', cancel, { passive: true });
    document.addEventListener('pointercancel', cancel, { passive: true });
    document.addEventListener('click', onClick, true);
    return () => {
      cancel();
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  // 上面的监听已挂好（同一组件里副作用按声明顺序执行）：从这一刻起右键归这里管，App 不再代收
  useEffect(() => onLive?.(), [onLive]);
  // v0.40：菜单开始监听之前右键的那一下（App 先拦下、按穗 id 记住），挂上后直接补开（不再对当时的 DOM 节点补发事件：卡片可能已经重画过）
  // v0.41 0436 穗仓全键盘：J / K 在卡片间移动，Enter 打开（卡片自己处理），G 放进 / 拿出嫁接篮，E 编辑，Del 删除。
  // 打字时（输入框 / 可编辑区）、有弹层、在秒搜里都不接管；不带 Ctrl / Alt / ⌘
  const actRef = useRef(onAct);
  actRef.current = onAct;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || blockedRef.current) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k !== 'j' && k !== 'k' && k !== 'g' && k !== 'e' && k !== 'Delete') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], .sheet')) return;
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.main .view.library:not(.search-view) :is(.card, .trow, .tl-frame)[data-item-id]')).filter((el) => el.offsetParent !== null);
      if (!cards.length) return;
      const cur = (document.activeElement as HTMLElement | null)?.closest?.('[data-item-id]') as HTMLElement | null;
      const i = cur ? cards.indexOf(cur) : -1;
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const n = i < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, i + (k === 'j' ? 1 : -1)));
        cards[n].focus({ preventScroll: true });
        cards[n].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (i < 0) return;
      e.preventDefault();
      const id = Number(cards[i].dataset.itemId);
      void db.items.get(id).then((it) => {
        if (!it || it.deletedAt || it.id == null) return;
        if (k === 'g') {
          const n = getBasket().length;
          toast(toggleBasket(it.id) ? `放进嫁接篮 · ${basketHint(Math.min(n + 1, 5))}` : '从嫁接篮拿出来了');
        } else actRef.current(k === 'e' ? 'edit' : 'delete', it);
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast]);
  // v0.41：手机上早长按（App 代收）补开时也记一下，安卓随后那一下 contextmenu 不再重开
  useEffect(() => {
    if (!early) return;
    lastOpen.current = Date.now();
    openRef.current(early.id, early.x, early.y);
  }, [early]);

  useEffect(() => {
    if (!st) return;
    const b = boxRef.current;
    if (b && desktop) setPos(placeMenu(st.x, st.y, b.offsetWidth, b.offsetHeight, window.innerWidth, window.innerHeight));
    b?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type !== 'keydown' && boxRef.current?.contains(e.target as Node)) return;
      setSt(null);
    };
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', close, true);
      window.addEventListener('keydown', close);
      // 电脑上滚动页面就收起（手机是底部弹层 + 遮罩，不跟滚动）
      if (desktop) window.addEventListener('scroll', close);
      window.addEventListener('resize', close);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [st, desktop]);

  if (!st) return null;
  const it = st.it;
  const text = it.content || it.title;
  const run = async (a: Act) => {
    setSt(null);
    if (a === 'copy' || a === 'link' || a === 'glean') {
      try {
        // v0.33 0510：glean://item/<uid> 在别的 App / 书签里一点回到这一穗
        await navigator.clipboard.writeText(a === 'glean' ? 'glean://item/' + it.uid : a === 'link' ? it.url || '' : text || '');
        toast(a === 'copy' ? '已复制' : '已复制链接');
      } catch {
        toast('复制失败', 'err');
      }
      return;
    }
    // v0.34 0899 分享（逐项勾选）/ 0902 放进花园（私密穗不能放）
    if (a === 'share') return void window.dispatchEvent(new CustomEvent('glean:share', { detail: { item: it.id } }));
    if (a === 'garden') {
      if ((it.private || it.locked || it.shut?.includes('garden')) && !it.garden) return toast(it.locked ? '上锁的穗不能放进花园' : it.private ? '私密穗不能放进花园' : '这一穗关了花园出口', 'err');
      await setGarden([it.id!], !it.garden);
      return toast(it.garden ? '从花园拿出来了' : '放进花园 · 设置 → 分享与花园 里生成网页');
    }
    if (a === 'basket') {
      // v0.28 0408 待嫁接篮
      if (it.id == null) return;
      const n = getBasket().length;
      toast(toggleBasket(it.id) ? `放进嫁接篮 · ${basketHint(Math.min(n + 1, 5))}` : '从嫁接篮拿出来了');
      return;
    }
    onAct(a, it);
  };
  const items: Array<[Act, string]> = [
    ['open', '打开'],
    ['edit', '编辑'],
    ['graft', '拿去嫁接'],
    ['basket', it.id != null && getBasket().includes(it.id) ? '拿出嫁接篮' : '放进嫁接篮'],
    ['copy', it.type === 'text' ? '复制原文' : '复制文字'],
    ...(it.url ? ([['link', '复制链接']] as Array<[Act, string]>) : []),
    ...(it.uid ? ([['glean', '复制 glean:// 链接']] as Array<[Act, string]>) : []),
    ['share', '分享…'],
    ['garden', it.garden ? '拿出花园' : '放进花园'],
    ['delete', '删掉'],
  ];
  return (
    <>
      {!desktop && <div className="ctxmenu-scrim" aria-hidden onClick={() => setSt(null)} />}
      <div
        ref={boxRef}
        className={`ctxmenu${desktop ? ' at-point' : ' as-sheet'}`}
        role="menu"
        aria-label={`「${displayTitle(it).slice(0, 18)}」的操作`}
        style={desktop ? (pos ? { left: pos.left, top: pos.top } : { left: st.x, top: st.y, visibility: 'hidden' }) : undefined}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const bs = Array.from(boxRef.current?.querySelectorAll('button') || []);
          const i = bs.indexOf(document.activeElement as HTMLButtonElement);
          bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
        }}
      >
        {!desktop && <div className="ctxmenu-title">{displayTitle(it).slice(0, 30)}</div>}
        {items.map(([a, label]) => (
          <button key={a} role="menuitem" className={`ctxmenu-item ctx-${a}${a === 'delete' ? ' danger' : ''}`} onClick={() => void run(a)}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
