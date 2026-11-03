// v0.23 设置 → 待理与标签：待理开关（0101）、标签合并 + 别名（0103）、标签健康检查（0147）。
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db, inboxEnabled, keepAllInbox, setInboxEnabled } from '../lib/db';
import { mergeTags } from '../lib/batch';
import { tagHealth, tagStats } from '../lib/organize';
import { loadAliases, saveAliases } from '../lib/tagalias';
import { useApp } from '../lib/store';

const SHOW = 40;

export function TagPanel() {
  const { toast, confirm } = useApp();
  const items = useLiveQuery(() => db.items.toArray().then((a) => a.filter((x) => !x.deletedAt && !x.sample)), []);
  const [on, setOn] = useState(inboxEnabled);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [all, setAll] = useState(false);
  const [aliases, setAliases] = useState(loadAliases);
  const stats = useMemo(() => (items ? tagStats(items) : []), [items]);
  const health = useMemo(() => (items ? tagHealth(items) : null), [items]);
  const nInbox = items ? items.filter((i) => i.inbox).length : 0;

  async function toggle() {
    if (on) {
      const ok = nInbox ? await confirm({ title: '关掉待理？', body: `关掉后新收的穗直接进穗仓。现在待理里的 ${nInbox} 穗也会全部进穗仓。`, ok: '关掉', cancel: '留着' }) : true;
      if (!ok) return;
      setInboxEnabled(false);
      if (nInbox) await keepAllInbox();
      setOn(false);
      toast('待理已关 · 新穗直接进穗仓');
    } else {
      setInboxEnabled(true);
      setOn(true);
      toast('待理已开 · 速记和分享来的穗先进待理');
    }
  }
  function pick(t: string) {
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
    if (!target) setTarget(t);
  }
  async function merge(from: string[], to: string) {
    const dest = to.trim().replace(/^#/, '');
    const src = from.filter((x) => x !== dest);
    if (!dest || !src.length) return;
    const ok = await confirm({ title: `合并成 #${dest}？`, body: `${src.map((x) => '#' + x).join(' ')} 会改写成 #${dest}，以后再输入它们也自动写成 #${dest}。`, ok: '合并', cancel: '算了' });
    if (!ok) return;
    const n = await mergeTags(src, dest);
    setAliases(loadAliases());
    setPicked([]);
    setTarget('');
    toast(`合并好了 · 改了 ${n} 穗`);
  }
  function unalias(k: string) {
    const m = { ...aliases };
    delete m[k];
    saveAliases(m);
    setAliases(m);
  }
  const shown = all ? stats : stats.slice(0, SHOW);
  const aliasList = Object.entries(aliases);

  return (
    <section className="set-sec tag-panel" id="set-tags">
      <h2 className="sec-title">待理与标签</h2>
      <div className="table action-table">
        <button className="trow cap-switch inbox-switch" role="switch" aria-checked={on} onClick={toggle}>
          <span className="tc tc-title">待理</span>
          <span className="tc tc-src">速记、分享、极速拾、选字、正在播放收进来的穗先进待理，理完再进穗仓；超过 7 天自动出现在穗仓</span>
          <span className="tc tc-date">{on ? `开${nInbox ? ` · ${nInbox} 穗` : ''}` : '关'}</span>
        </button>
      </div>

      <h3 className="label tp-h">全部标签 ({stats.length})</h3>
      {stats.length === 0 ? (
        <p className="meta-text">还没有标签。</p>
      ) : (
        <>
          <p className="meta-text">点选几个，合并成一个：旧穗自动改写，以后输入别名也自动换成它。</p>
          <div className="tag-row tp-tags">
            {shown.map((s) => (
              <button key={s.tag} className={`tag btnlike tp-tag${picked.includes(s.tag) ? ' on' : ''}`} data-tag={s.tag} aria-pressed={picked.includes(s.tag)} onClick={() => pick(s.tag)}>
                {s.tag} <span className="n">{s.n}</span>
              </button>
            ))}
            {stats.length > SHOW && (
              <button className="btn text faint" onClick={() => setAll(!all)}>
                {all ? '收起' : `还有 ${stats.length - SHOW} 个`}
              </button>
            )}
          </div>
          {picked.length > 0 && (
            <div className="tp-merge">
              <span className="meta-text">已选 {picked.length} 个，合并成</span>
              <input className="tp-target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="标签" aria-label="合并成" maxLength={24} />
              <button className="btn primary tp-merge-ok" disabled={!target.trim() || (picked.length === 1 && picked[0] === target.trim())} onClick={() => merge(picked, target)}>
                合并
              </button>
              <button className="btn text faint" onClick={() => (setPicked([]), setTarget(''))}>
                取消
              </button>
            </div>
          )}
        </>
      )}

      {health && (health.near.length > 0 || health.once.length > 0 || health.stale.length > 0) && (
        <div className="tp-health">
          <h3 className="label tp-h">标签体检</h3>
          {health.near.length > 0 && (
            <div className="tp-hrow">
              <span className="tp-hk">写法很近</span>
              <span className="tp-hv">
                {health.near.map(([a, b]) => (
                  <span key={a + '|' + b} className="tp-pair">
                    #{b} → #{a}
                    <button className="btn text strong tp-pair-merge" onClick={() => merge([b], a)}>
                      合并
                    </button>
                  </span>
                ))}
              </span>
            </div>
          )}
          {health.once.length > 0 && (
            <div className="tp-hrow">
              <span className="tp-hk">只用过一次 ({health.once.length})</span>
              <span className="tp-hv meta-text">{health.once.slice(0, 16).map((t) => '#' + t).join(' ')}</span>
            </div>
          )}
          {health.stale.length > 0 && (
            <div className="tp-hrow">
              <span className="tp-hk">半年没用</span>
              <span className="tp-hv meta-text">{health.stale.map((t) => '#' + t).join(' ')}</span>
            </div>
          )}
        </div>
      )}

      {aliasList.length > 0 && (
        <div className="tp-alias">
          <h3 className="label tp-h">别名 ({aliasList.length})</h3>
          <div className="tag-row">
            {aliasList.map(([k, v]) => (
              <span key={k} className="tag tp-al">
                {k} → {v}
                <button className="sugg-no" aria-label={`去掉别名 ${k}`} onClick={() => unalias(k)}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
