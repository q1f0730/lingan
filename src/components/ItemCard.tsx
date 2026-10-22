import { memo } from 'react';
import { formatWhen } from '../lib/quick';
import { itemHasImage } from '../lib/imagestore';
import { useThumbSrc } from '../lib/useImage';
import { AsciiImage } from './AsciiDevelop';
import { TYPE_LABEL, type Item } from '../lib/types';

/** 卡片上的图：只读缩略图，挂载时才建 objectURL，卸载即回收 */
function CardImage({ item }: { item: Item }) {
  const src = useThumbSrc(item);
  const ratio = item.thumbW && item.thumbH ? item.thumbW / item.thumbH : undefined;
  return (
    <div className="card-imgwrap">
      {src ? (
        <AsciiImage className="card-img" id={item.id} src={src} alt={item.title} playKey={`img:${item.id}`} ratio={ratio} />
      ) : (
        <div className="card-img" style={{ aspectRatio: String(ratio || 4 / 3) }} aria-hidden />
      )}
    </div>
  );
}

export const ItemCard = memo(ItemCardImpl);

function ItemCardImpl({ item, onOpen, compact }: { item: Item; onOpen?: (i: Item) => void; compact?: boolean }) {
  return (
    <article
      className={`card card-${item.type}${compact ? ' compact' : ''}`}
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
      {itemHasImage(item) && <CardImage item={item} />}
      <div className="card-meta">
        <span>
          <span className="type-badge">{TYPE_LABEL[item.type]}</span>
          {item.sample && <span className="tag sample-badge">示例</span>}
        </span>
        <time className="card-when" dateTime={new Date(item.createdAt).toISOString()}>
          {formatWhen(item.createdAt)}
        </time>
      </div>
      <h3 className={`card-title${item.type === 'text' && item.content ? ' quote' : ''}`}>
        {item.type === 'text' && item.content ? `「${item.content.replace(/^[「“"『]+|[」”"』]+$/g, '')}」` : item.title}
      </h3>
      {item.type === 'text' && item.content && <div className="card-sub">—— {item.creator || item.title}</div>}
      {item.type !== 'text' && (item.creator || item.year) && (
        <div className="card-sub">
          {item.creator}
          {item.creator && item.year ? ' · ' : ''}
          {item.year}
        </div>
      )}
      {(item.type === 'idea' || (item.type === 'image' && !itemHasImage(item))) && item.content && !compact && <p className="card-body">{item.content}</p>}
      {item.type === 'link' && item.url && <div className="card-url">{safeHost(item.url)}</div>}
      {item.why && !compact && <p className="card-why">{item.why}</p>}
      {item.tags.length > 0 && !compact && (
        <div className="tags">
          {item.tags.slice(0, 5).map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export function safeHost(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u.slice(0, 40);
  }
}
