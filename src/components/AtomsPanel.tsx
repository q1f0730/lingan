// v0.30 0205 口味原子：「我在意的东西」（AI 从为什么里抽，没模型就离线按反复出现的短语），可删可改可加，嫁接时带前 8 个。
// 0244 口味导出卡：复制成一段能贴进任何 AI 的提示词（只含原子与代表作，不含私密穗）。
import { useEffect, useState } from 'react';
import { addAtom, atomsPrompt, editAtom, extractAtoms, loadAtoms, removeAtom, saveAtoms, topAtoms, type AtomStore } from '../lib/atoms';
import { aiVisible } from '../lib/privacy';
import { aiReady } from '../lib/settings';
import { useApp } from '../lib/store';
import type { Item } from '../lib/types';
import '../styles/v030.css';

export function AtomsPanel({ items }: { items: Item[] }) {
  const { settings, toast, openItem } = useApp();
  const [st, setSt] = useState<AtomStore | null>(loadAtoms);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const on = () => setSt(loadAtoms());
    window.addEventListener('glean:atoms', on);
    return () => window.removeEventListener('glean:atoms', on);
  }, []);
  const put = (n: AtomStore | null) => {
    saveAtoms(n);
    setSt(n);
  };
  const byUid = new Map(items.filter((i) => i.uid).map((i) => [i.uid!, i]));
  const top = new Set(topAtoms(st));
  async function run() {
    setBusy(true);
    try {
      const ai = aiReady(settings);
      // 私密穗不发给云端模型
      const src = ai ? items.filter((x) => aiVisible(x, settings)) : items;
      const next = await extractAtoms(ai ? settings : null, src);
      // 自己改过 / 加的原子留着
      const mine = (st?.atoms || []).filter((a) => a.mine);
      put({ ...next, atoms: [...mine, ...next.atoms.filter((a) => !mine.some((m) => m.atom === a.atom))] });
      toast(`抽出 ${next.atoms.length} 个原子${next.source === 'offline' ? '（离线）' : ''}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!st) return;
    const t = atomsPrompt(st, items);
    try {
      await navigator.clipboard.writeText(t);
      toast('已复制口味提示词（' + t.length + ' 字）');
    } catch {
      toast('复制失败', 'err');
    }
  }
  return (
    <section className="taste-sec wide atoms" data-count={st?.atoms.length || 0}>
      <div className="fb-head">
        <h2 className="fb-title">
          我在意的东西 <span className="n num">({st?.atoms.length || 0})</span>
        </h2>
        <p className="meta-text fb-sub">从你写的「为什么」里抽出来的口味原子{st ? (st.source === 'ai' ? ' · AI 抽的' : ' · 离线按反复出现的词') : ''}。嫁接时带上前 8 个（黑底的），新枝至少要接住其中一个。点一个看它从哪几穗来；不对就改、删。</p>
      </div>
      {st?.atoms.length ? (
        <ul className="atom-list">
          {st.atoms.map((a, i) => (
            <li key={a.atom + i} className={`atom${top.has(a.atom) ? ' top' : ''}${open === i ? ' open' : ''}`} data-w={a.weight}>
              {edit === i ? (
                <span className="atom-edit">
                  <input
                    className="line-input atom-input"
                    value={text}
                    maxLength={8}
                    autoFocus
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        put(editAtom(st, i, text));
                        setEdit(null);
                      } else if (e.key === 'Escape') setEdit(null);
                    }}
                    aria-label="改这个原子"
                  />
                  <button
                    className="btn text strong atom-save"
                    onClick={() => {
                      put(editAtom(st, i, text));
                      setEdit(null);
                    }}
                  >
                    好
                  </button>
                </span>
              ) : (
                <>
                  <button className="atom-name" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                    {a.atom}
                    {a.uids.length ? <span className="n">({a.uids.length})</span> : null}
                  </button>
                  <button
                    className="btn text faint atom-change"
                    onClick={() => {
                      setEdit(i);
                      setText(a.atom);
                    }}
                    aria-label={`改「${a.atom}」`}
                  >
                    改
                  </button>
                  <button className="btn text faint atom-del" onClick={() => put(removeAtom(st, i))} aria-label={`删掉「${a.atom}」`}>
                    删
                  </button>
                </>
              )}
              {open === i && (
                <span className="atom-src meta-text">
                  {a.uids.map((u) => byUid.get(u)).filter(Boolean).length
                    ? a.uids
                        .map((u) => byUid.get(u))
                        .filter((x): x is Item => !!x)
                        .map((it, k) => (
                          <span key={it.uid}>
                            {k > 0 && ' / '}
                            <button className="linklike" onClick={() => openItem(it)}>
                              {it.title}
                            </button>
                          </span>
                        ))
                    : a.mine
                      ? '你自己加的'
                      : '那几穗已经不在了'}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta-text atom-empty">还没抽过。先给穗写几句「为什么」，再点「抽一次」。</p>
      )}
      <div className="atom-acts">
        <button className="btn text strong atom-run" onClick={() => void run()} disabled={busy}>
          {busy ? '在抽…' : st ? '重新抽' : '抽一次'}
        </button>
        <input className="line-input atom-add-input" value={adding} maxLength={8} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adding.trim() && (put(addAtom(st, adding)), setAdding(''))} placeholder="自己加一个" aria-label="自己加一个原子" />
        <button className="btn text atom-add" disabled={!adding.trim()} onClick={() => (put(addAtom(st, adding)), setAdding(''))}>
          加
        </button>
        {st?.atoms.length ? (
          <button className="btn text atom-copy" onClick={() => void copy()}>
            复制为提示词
          </button>
        ) : null}
      </div>
    </section>
  );
}
