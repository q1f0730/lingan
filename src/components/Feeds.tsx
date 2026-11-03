// v0.39 0804 订阅进「待拾」：设置里管订阅源（FeedPanel，含 0826 RSSHub 模板、0847 Letterboxd），穗仓里看待拾（FeedInbox）。
// 待拾只有标题 + 一行摘要；左滑 / 「丢」= 不要，右滑 / 「拾」= 写一句为什么或 #标签 才进穗仓。
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { fdb, pickReady, removeFeed, rsshubBase, RSSHUB_DEFAULT, RSSHUB_KEY, setState, TEMPLATES, tplUrl, type Entry } from '../lib/feeds';
import { useApp } from '../lib/store';
import { normalizeTags } from '../lib/db';
import { DisplayTitle } from './DisplayTitle';
import '../styles/v039.css';

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u.slice(0, 30);
  }
};
const day = (t?: number) => (t ? new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—');

export function FeedPanel() {
  const { toast } = useApp();
  const feeds = useLiveQuery(() => fdb().feeds.toArray(), []);
  const counts = useLiveQuery(async () => {
    const m = new Map<number, number>();
    for (const e of await fdb().entries.where('state').equals('new').toArray()) m.set(e.feedId, (m.get(e.feedId) || 0) + 1);
    return m;
  }, []);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [tpl, setTpl] = useState(TEMPLATES[0].id);
  const [tv, setTv] = useState('');
  const [hub, setHub] = useState(rsshubBase);
  const t = TEMPLATES.find((x) => x.id === tpl) || TEMPLATES[0];

  async function add(u: string) {
    if (!u.trim() || busy) return;
    setBusy('订阅中…');
    try {
      const { addFeed } = await import('../lib/feeds');
      const r = await addFeed(u);
      toast(`订阅了「${r.feed.title}」 · ${r.added} 条进了待拾`);
      setUrl('');
      setTv('');
    } catch (e) {
      toast('没订阅上：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy('');
    }
  }
  async function pull() {
    if (busy) return;
    setBusy('拉取中…');
    try {
      const { pullAll } = await import('../lib/feeds');
      const r = await pullAll();
      toast(`拉完了 · 新进待拾 ${r.added} 条${r.failed ? ` · ${r.failed} 个源没拉到` : ''}`, r.failed ? 'err' : 'ok');
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="set-sec feed-panel" id="set-feed">
      <h2 className="sec-title">订阅 · 待拾</h2>
      <p className="meta-text">RSS / Atom 订阅每天拉一次，进「待拾」而不是穗仓：只显示标题和一行摘要，你写一句为什么（或打个标签）拾下来才算一穗。订阅只存在这台设备上。</p>
      <label className="field">
        <span className="label">订阅地址</span>
        <div className="inline">
          <input className="feed-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/feed.xml" inputMode="url" onKeyDown={(e) => e.key === 'Enter' && void add(url)} />
          <button type="button" className="btn text feed-add" onClick={() => add(url)} disabled={!url.trim() || !!busy}>
            {busy === '订阅中…' ? busy : '订阅'}
          </button>
        </div>
      </label>
      <div className="field feed-tpl">
        <span className="label">常用模板</span>
        <div className="radio-list" role="radiogroup" aria-label="订阅模板">
          {TEMPLATES.map((x) => (
            <button key={x.id} role="radio" aria-checked={tpl === x.id} className={`radio chip tpl-${x.id}${tpl === x.id ? ' on' : ''}`} onClick={() => setTpl(x.id)}>
              <i className="sq" aria-hidden />
              <span className="radio-name">{x.name}</span>
            </button>
          ))}
        </div>
        <div className="inline">
          <input className="tpl-val" value={tv} onChange={(e) => setTv(e.target.value)} placeholder={t.hint} onKeyDown={(e) => e.key === 'Enter' && tv.trim() && void add(tplUrl(t, tv, hub))} />
          <button type="button" className="btn text tpl-add" onClick={() => add(tplUrl(t, tv, hub))} disabled={!tv.trim() || !!busy}>
            订阅
          </button>
        </div>
        {tv.trim() && <p className="meta-text tpl-preview">{tplUrl(t, tv, hub)}</p>}
        {t.rsshub && (
          <label className="field">
            <span className="label">RSSHub 实例（公共实例常限流，可换成自己的）</span>
            <input
              className="hub-url"
              value={hub}
              onChange={(e) => setHub(e.target.value.trim())}
              onBlur={() => {
                const v = /^https?:\/\//.test(hub) ? hub.replace(/\/+$/, '') : RSSHUB_DEFAULT;
                setHub(v);
                if (v === RSSHUB_DEFAULT) localStorage.removeItem(RSSHUB_KEY);
                else localStorage.setItem(RSSHUB_KEY, v);
              }}
              placeholder={RSSHUB_DEFAULT}
              inputMode="url"
            />
          </label>
        )}
      </div>
      {!!feeds?.length && (
        <div className="table action-table feed-table">
          {feeds.map((f) => (
            <div key={f.id} className="trow static feed-row">
              <span className="tc tc-title">{f.title}</span>
              <span className="tc tc-src meta-text">
                {host(f.url)} · 待拾 {counts?.get(f.id!) || 0} · {f.lastErr ? `上次没拉到：${f.lastErr}` : `${day(f.lastAt)} 拉过`}
              </span>
              <span className="tc tc-date">
                <button className="btn text faint feed-del" onClick={() => void removeFeed(f.id!).then(() => toast(`退订了「${f.title}」`))}>
                  退订
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {!!feeds?.length && (
        <div className="actions">
          <button className="btn text feed-pull" onClick={pull} disabled={!!busy}>
            {busy === '拉取中…' ? busy : '现在拉一次'}
          </button>
        </div>
      )}
    </section>
  );
}

/** 一条待拾：左滑丢，右滑拾（或点按钮）；拾要写为什么 / #标签 */
function EntryRow({ e, feed, onDrop, onKeep }: { e: Entry; feed: string; onDrop: () => void; onKeep: (why: string, tags: string[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState('');
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const parse = () => {
    const tags: string[] = [];
    const why = txt.replace(/(^|\s)#([^\s#]{1,24})(?=\s|$)/g, (_, p: string, t: string) => (tags.push(t), p)).replace(/\s{2,}/g, ' ').trim();
    return { why, tags: normalizeTags(tags) };
  };
  const { why, tags } = parse();
  return (
    <li
      className={`feed-entry${open ? ' open' : ''}`}
      data-entry-id={e.id}
      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      onPointerDown={(ev) => {
        if (ev.pointerType !== 'mouse' && !(ev.target as HTMLElement).closest('input,button,a')) start.current = { x: ev.clientX, y: ev.clientY };
      }}
      onPointerMove={(ev) => {
        const s = start.current;
        if (s && Math.abs(ev.clientY - s.y) < 40) setDx(Math.max(-120, Math.min(120, ev.clientX - s.x)));
      }}
      onPointerUp={() => {
        const d = dx;
        start.current = null;
        setDx(0);
        if (d < -80) onDrop();
        else if (d > 80) setOpen(true);
      }}
      onPointerCancel={() => ((start.current = null), setDx(0))}
    >
      <div className="fe-main">
        <a className="fe-title" href={e.link} target="_blank" rel="noreferrer">
          {e.title}
        </a>
        <span className="meta-text fe-sub">
          {feed} · {day(e.at)}
          {e.summary ? ` · ${e.summary}` : ''}
        </span>
      </div>
      <div className="fe-acts">
        <button className="btn text faint fe-drop" onClick={onDrop}>
          丢
        </button>
        <button className="btn text strong fe-pick" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          拾
        </button>
      </div>
      {open && (
        <form
          className="fe-why inline"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (pickReady(why, tags)) void onKeep(why, tags);
          }}
        >
          <input className="fe-why-input" value={txt} onChange={(ev) => setTxt(ev.target.value)} placeholder="为什么拾它？或 #标签（至少写一样）" autoFocus maxLength={200} />
          <button className="btn text strong fe-keep" type="submit" disabled={!pickReady(why, tags)}>
            收进穗仓
          </button>
        </form>
      )}
    </li>
  );
}

export function FeedInbox({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const list = useLiveQuery(() => fdb().entries.where('state').equals('new').reverse().sortBy('at'), []);
  const feeds = useLiveQuery(async () => new Map((await fdb().feeds.toArray()).map((f) => [f.id!, f.title])), []);
  async function keep(e: Entry, why: string, tags: string[]) {
    const { guessType } = await import('../lib/linkmeta');
    const { addItem } = await import('../lib/repo');
    const id = await addItem({ type: guessType(e.link), title: e.title, url: e.link, content: e.summary, creator: '', year: '', why, tags, source: feeds?.get(e.feedId) || '订阅' }, undefined, {});
    await setState([e.id!], 'kept');
    toast(`拾下了「${e.title.slice(0, 16)}」`);
    // 后台补封面 / 快照（同速记收链接）
    void import('../lib/linkretry').then((m) => m.fillFromLink(id, e.link)).catch(() => undefined);
  }
  const n = list?.length ?? 0;
  return (
    <section className="view feed-inbox">
      <DisplayTitle title="待拾" count={n} />
      <div className="actions">
        <button className="btn text" onClick={onClose}>
          ← 回穗仓
        </button>
        {n > 0 && (
          <button className="btn text faint fe-drop-all" onClick={() => void setState(list!.map((x) => x.id!), 'dropped').then(() => toast(`丢掉了 ${n} 条`))}>
            全部丢掉
          </button>
        )}
      </div>
      <p className="meta-text">订阅来的东西先放这里，不算你拾的。看中的写一句为什么再收；左滑丢，右滑拾。</p>
      {n === 0 ? (
        <p className="meta-text fe-empty">待拾是空的。订阅在 设置 → 订阅 · 待拾。</p>
      ) : (
        <ul className="plain feed-list">
          {list!.map((e) => (
            <EntryRow key={e.id} e={e} feed={feeds?.get(e.feedId) || ''} onDrop={() => void setState([e.id!], 'dropped')} onKeep={(w, t) => keep(e, w, t)} />
          ))}
        </ul>
      )}
    </section>
  );
}
