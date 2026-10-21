import { formatWhen } from '../lib/quick';
import { AsciiImage } from './AsciiDevelop';
import { TYPE_LABEL, type Item } from '../lib/types';

export function frameNo(id?: number) {
  return '№ ' + String(id ?? 0).padStart(3, '0');
}

export function ItemCard({ item, onOpen, compact }: { item: Item; onOpen?: (i: Item) => void; compact?: boolean }) {
  return (
    <article
      className={`card card-${item.type}${compact ? ' compact' : ''}`}
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
      <div className="card-meta">
        <span className="mono">{frameNo(item.id)}</span>
        <time className="card-when mono" dateTime={new Date(item.createdAt).toISOString()}>
          {formatWhen(item.createdAt)}
        </time>
        <span className="type-badge">{TYPE_LABEL[item.type]}</span>
      </div>
      {item.image && (
        <div className="card-imgwrap">
          <AsciiImage className="card-img" id={item.id} src={item.image} alt={item.title} />
          <span className="exp mono">EXP {String(item.id ?? 0).padStart(2, '0')}A</span>
        </div>
      )}
      {item.type === 'music' && !item.image && (
        <div className="vinyl" aria-hidden>
          <span />
        </div>
      )}
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
      {item.type === 'idea' && item.content && !compact && <p className="card-body">{item.content}</p>}
      {item.type === 'link' && item.url && <div className="card-url mono">{safeHost(item.url)}</div>}
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
