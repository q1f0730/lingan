// v0.34 0900「别人递来的」：待理页顶上一栏。别人递来的穗只在这里（本机），不进穗仓、口味、嫁接；
// 「也拾一穗」要先写一句自己的为什么，才复制进穗仓（直接入仓，不再进待理）；「不要」丢掉。
import { useEffect, useState } from 'react';
import { addItem, db } from '../lib/db';
import { dropHanded, readHanded, type Handed as H } from '../lib/handed';
import { parseQuick } from '../lib/quick';
import { useApp } from '../lib/store';
import { shortDate } from '../lib/studio';
import '../styles/share.css';

function Row({ h }: { h: H }) {
  const { toast } = useApp();
  const [why, setWhy] = useState('');
  const [open, setOpen] = useState(false);
  async function take() {
    if (!why.trim()) return toast('先写一句你自己为什么要它', 'err');
    const d = parseQuick([h.text, h.url && !h.text.includes(h.url) ? h.url : ''].filter(Boolean).join(' ') || h.title);
    if (!d) return;
    if (h.title) d.title = h.title;
    d.why = why.trim();
    d.tags = Array.from(new Set([...d.tags, ...h.tags])).slice(0, 12);
    await addItem({ ...d, source: `${h.from} 递来的` }, db);
    dropHanded(h.id);
    toast(`拾进穗仓：「${d.title.slice(0, 16)}」`);
  }
  return (
    <article className="handed-row" data-handed={h.id}>
      <span className="meta-text">
        {h.from} 递来 · <span className="num">{shortDate(h.at)}</span>
      </span>
      <span className="handed-title">{h.title}</span>
      {h.text && h.text !== h.title && <p className="handed-text">{h.text.slice(0, 280)}</p>}
      {h.url && <p className="handed-text">{h.url.replace(/^https?:\/\//, '').slice(0, 60)}</p>}
      {open ? (
        <div className="handed-why field">
          <input autoFocus value={why} placeholder="你为什么也要它？" aria-label="你自己的为什么" onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void take()} />
          <button className="btn text strong handed-take" onClick={() => void take()}>
            拾
          </button>
        </div>
      ) : (
        <div className="handed-acts">
          <button className="btn text strong handed-also" onClick={() => setOpen(true)}>
            也拾一穗
          </button>
          <button className="btn text faint handed-drop" onClick={() => dropHanded(h.id)}>
            不要
          </button>
        </div>
      )}
    </article>
  );
}

export function Handed() {
  const [list, setList] = useState(readHanded);
  useEffect(() => {
    const on = () => setList(readHanded());
    window.addEventListener('glean:handed', on);
    return () => window.removeEventListener('glean:handed', on);
  }, []);
  if (!list.length) return null;
  return (
    <section className="handed" aria-label="别人递来的">
      <span className="label">
        别人递来的 <span className="num">({list.length})</span> · 不算口味、不进嫁接，拾了才进穗仓
      </span>
      {[...list].reverse().map((h) => (
        <Row key={h.id} h={h} />
      ))}
    </section>
  );
}
