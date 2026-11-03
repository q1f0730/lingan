import { m } from 'framer-motion';
import { useState } from 'react';
import { itemHasImage } from '../../lib/imagestore';
import { useThumbSrc } from '../../lib/useImage';
import { TYPE_LABEL, type Item } from '../../lib/types';
import { displayTitle } from '../../lib/studio';

function Face({ it }: { it: Item }) {
  const src = useThumbSrc(it);
  return src && itemHasImage(it) ? (
    <img src={src} alt="" decoding="async" draggable={false} />
  ) : (
    <span className={`ds-text t-${it.type}`}>
      <span className="ds-type">{TYPE_LABEL[it.type]}</span>
      <span className="ds-title">{displayTitle(it)}</span>
    </span>
  );
}

/**
 * 每日一穗的三张旧穗叠成一小摞。移植自 Rewamp「Diagonal Card Stack」的叠放态（stacked deck）：
 * 只保留斜向错开的叠放与悬停 / 点按时摊开的弹簧，去掉原组件的连续自动滚动（不在后台跑 rAF）。纯装饰，点它等于打开最上面那一穗。
 */
export function DailyStack({ items, onOpen }: { items: Item[]; onOpen: (it: Item) => void }) {
  const [open, setOpen] = useState(false);
  const cards = items.slice(0, 3);
  return (
    <button
      type="button"
      className="daily-stack"
      aria-label={`打开「${displayTitle(cards[0])}」`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => onOpen(cards[0])}
    >
      {cards
        .map((it, i) => (
          <m.span
            key={it.id}
            className="ds-card"
            style={{ zIndex: 3 - i }}
            initial={false}
            animate={open ? { x: i * 30, y: i * -6, rotate: i * 7 } : { x: i * 9, y: i * -7, rotate: i * 4 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            aria-hidden
          >
            <Face it={it} />
          </m.span>
        ))
        .reverse()}
    </button>
  );
}
