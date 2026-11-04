// v0.40 详情里的「再看一句」（0131）与「一年后再写一次为什么」（0915）：只追加，原来的为什么不动；满一年的那句和当时的并排放。
import { useState } from 'react';
import { addRevisit } from '../lib/repo';
import { yearDue } from '../lib/review';
import { shortDate } from '../lib/studio';
import { useApp } from '../lib/store';
import type { Item } from '../lib/types';
import '../styles/v040.css';

export function Revisits({ it }: { it: Item }) {
  const { toast } = useApp();
  const due = yearDue(it);
  const [open, setOpen] = useState(due);
  const [v, setV] = useState('');
  const list = it.revisits || [];
  const year = list.find((r) => r.y);
  async function add() {
    const t = v.trim();
    if (!t || it.id == null) return;
    await addRevisit(it.id, it.revisits, t, due);
    setV('');
    setOpen(false);
    toast(due ? '记下了现在的为什么，和当时的并排放着' : '记下了这一次再看');
  }
  return (
    <section className="detail-sec detail-revisit">
      {year && it.why && (
        <div className="revisit-pair">
          <div>
            <div className="label">当时 · {shortDate(it.createdAt)}</div>
            <p>{it.why}</p>
          </div>
          <div>
            <div className="label">一年后 · {shortDate(year.at)}</div>
            <p>{year.text}</p>
          </div>
        </div>
      )}
      {list.some((r) => !r.y) && (
        <>
          <div className="label">再看</div>
          <ul className="plain revisit-list">
            {list.filter((r) => !r.y).map((r) => (
              <li key={r.at}>
                <span className="dim num">{shortDate(r.at)}</span> {r.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {open ? (
        <label className="field">
          <span className="label">{due ? '一年了 · 现在的为什么？' : '现在再看，想说一句'}</span>
          <input className="revisit-in" value={v} maxLength={500} autoFocus={!due} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        </label>
      ) : null}
      <div className="actions">
        {open ? (
          <>
            <button className="btn text strong revisit-save" disabled={!v.trim()} onClick={add}>
              记下
            </button>
            <button className="btn text faint" onClick={() => setOpen(false)}>
              不写了
            </button>
          </>
        ) : (
          <button className="btn text revisit-open" onClick={() => setOpen(true)}>
            再看一句
          </button>
        )}
      </div>
    </section>
  );
}
