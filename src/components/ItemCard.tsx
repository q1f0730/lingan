import { memo, useState, type ReactNode } from 'react';
import { formatWhen } from '../lib/quick';
import { itemHasImage } from '../lib/imagestore';
import { useThumbSrc } from '../lib/useImage';
import { displayTitle, quoteSource, shortDate, splitHits } from '../lib/studio';
import { TYPE_LABEL, type Item } from '../lib/types';

/** 卡片上的图：只读缩略图，挂载时才建 objectURL，卸载即回收；解码好了淡入 */
function CardImage({ item }: { item: Item }) {
  const src = useThumbSrc(item);
  const [ok, setOk] = useState(false);
  return (
    <div className="card-imgwrap">
      {src ? <img className={`card-img${ok ? ' loaded' : ''}`} src={src} alt={item.title} decoding="async" draggable={false} onLoad={() => setOk(true)} /> : <div className="card-img empty" aria-hidden />}
    </div>
  );
}

/** 命中字黑底白字（搜索） */
export function Hits({ text, q }: { text: string; q?: string }): ReactNode {
  if (!q) return text;
  return splitHits(text, q).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.t}</mark> : <span key={i}>{p.t}</span>));
}

export const ItemCard = memo(ItemCardImpl);

/** 网格里的一穗：4:5 图块。照片满铺 + 底部压暗小字说明；文字穗是浅灰色块，左上正文，左下来源与类型·日期 */
function ItemCardImpl({ item, onOpen, compact, q }: { item: Item; onOpen?: (i: Item) => void; compact?: boolean; q?: string }) {
  const img = itemHasImage(item);
  const quote = item.type === 'text' && !!item.content;
  const src = quote ? quoteSource(item) : item.type === 'link' ? '' : item.creator || '';
  return (
    <article
      className={`card card-${item.type}${img ? ' has-img' : ' no-img'}${compact ? ' compact' : ''}`}
      data-item-id={item.id}
      data-sample={item.sample ? '1' : undefined}
      onClick={() => onOpen?.(item)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen(item);
        }
      }}
    >
      {img && <CardImage item={item} />}
      {item.sample && <span className="tag sample-badge">示例</span>}
      <div className="card-cap">
        <h3 className={`card-title${quote ? ' quote' : ''}`}>
          <Hits text={displayTitle(item)} q={q} />
        </h3>
        {item.type === 'link' && item.url && <div className="card-url">{safeHost(item.url)}</div>}
        {(item.type === 'idea' || (item.type === 'image' && !img)) && item.content && !compact && (
          <p className="card-body">
            <Hits text={item.content} q={q} />
          </p>
        )}
        <div className="card-foot">
          {src && !img && <div className="card-sub">{src}</div>}
          <div className="card-meta">
            <span className="type-badge">{TYPE_LABEL[item.type]}</span>
            <span aria-hidden> · </span>
            <time className="card-when" dateTime={new Date(item.createdAt).toISOString()}>
              {formatWhen(item.createdAt)}
            </time>
          </div>
        </div>
      </div>
    </article>
  );
}

/** 列表视图的一行（无线表格）：穗 / 类型 / 来源 / 标签（桌面）/ 日期右对齐 */
export const ItemRow = memo(function ItemRow({ item, onOpen, q, onHover }: { item: Item; onOpen: (i: Item) => void; q?: string; onHover?: (i: Item | null, e?: React.PointerEvent) => void }) {
  return (
    <div
      className="trow card-row"
      role="button"
      tabIndex={0}
      data-item-id={item.id}
      data-sample={item.sample ? '1' : undefined}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(item))}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHover?.(item, e)}
      onPointerMove={(e) => e.pointerType === 'mouse' && onHover?.(item, e)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onHover?.(null)}
    >
      <span className="tc tc-title">
        <span className="trow-title">
          <Hits text={displayTitle(item)} q={q} />
        </span>
        {item.sample && <span className="tag sample-badge">示例</span>}
      </span>
      <span className="tc tc-type">{TYPE_LABEL[item.type]}</span>
      <span className="tc tc-src">{item.type === 'link' && item.url ? safeHost(item.url) : item.type === 'text' ? quoteSource(item) : item.creator || '自己'}</span>
      <span className="tc tc-tags">{item.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}</span>
      <span className="tc tc-date num">{shortDate(item.createdAt)}</span>
    </div>
  );
});

/** 列表悬停预览（桌面）：光标旁 240×320 的图 */
export function HoverPreview({ item, x, y }: { item: Item; x: number; y: number }) {
  const src = useThumbSrc(item);
  if (!src) return null;
  const left = Math.min(x + 24, window.innerWidth - 260);
  const top = Math.max(16, Math.min(y - 160, window.innerHeight - 336));
  return (
    <div className="hover-preview" style={{ left, top }} aria-hidden>
      <img src={src} alt="" decoding="async" />
    </div>
  );
}

export function safeHost(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u.slice(0, 40);
  }
}
