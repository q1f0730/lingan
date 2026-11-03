// v0.30 0211 穗仓对话：在秒搜里问一句，先本地检索 top20，再只基于这些穗回答（每句带穗）；没命中直说没有。
// 0237 对话沉淀：有用的回答一键收成穗。
import { useState } from 'react';
import { answerItem, askLibrary, type AskAnswer } from '../lib/ask';
import { addItem } from '../lib/db';
import { aiVisible } from '../lib/privacy';
import { aiReady } from '../lib/settings';
import { useApp } from '../lib/store';
import type { Item } from '../lib/types';
import '../styles/v030.css';

export function AskPanel({ items, initial, onOpen }: { items: Item[]; initial: string; onOpen: (it: Item) => void }) {
  const { settings, toast } = useApp();
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Array<AskAnswer & { saved?: boolean }>>([]);
  const byId = new Map(items.map((i) => [i.id!, i]));
  async function ask() {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const ai = aiReady(settings);
      // 用云端模型时私密穗不进检索（不会被发出去）
      const pool = ai ? items.filter((x) => aiVisible(x, settings)) : items;
      const a = await askLibrary(ai ? settings : null, pool, text);
      setLog((l) => [a, ...l].slice(0, 8));
    } catch (e) {
      toast('没问成：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }
  async function save(i: number) {
    const a = log[i];
    if (!a || a.saved) return;
    try {
      await addItem(answerItem(a));
      setLog((l) => l.map((x, j) => (j === i ? { ...x, saved: true } : x)));
      toast('收成了一穗（想法）');
    } catch (e) {
      toast('没收成：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  }
  return (
    <section className="ask-panel" aria-label="问穗仓">
      <div className="ask-line">
        <input className="line-input ask-input" value={q} maxLength={120} autoFocus onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ask()} placeholder="例如：我收过哪些关于雨的东西" aria-label="问穗仓" />
        <button className="btn primary ask-go" onClick={() => void ask()} disabled={!q.trim() || busy}>
          {busy ? '在想…' : '问'}
        </button>
      </div>
      <p className="meta-text ask-note">只基于你穗仓里的穗回答：先按字面找出最相关的 20 穗，{aiReady(settings) ? '再让模型只用它们回答（私密穗不发出去）' : '没连模型就直接列出来'}；没有就说没有。</p>
      {log.map((a, i) => (
        <article key={i} className="ask-a" data-source={a.source}>
          <p className="ask-q">
            <span className="label">问</span> {a.q}
          </p>
          <p className="ask-text">{a.text}</p>
          {a.refs.length > 0 && (
            <p className="ask-refs meta-text">
              <span className="label">依据</span>{' '}
              {a.refs
                .map((id) => byId.get(id))
                .filter((x): x is Item => !!x)
                .map((it, k) => (
                  <span key={it.id}>
                    {k > 0 && ' / '}
                    <button className="linklike ask-ref" data-item-id={it.id} onClick={() => onOpen(it)}>
                      {it.title}
                    </button>
                  </span>
                ))}
            </p>
          )}
          {a.source !== 'none' && (
            <button className="btn text ask-save" onClick={() => void save(i)} disabled={a.saved}>
              {a.saved ? '已收成穗' : '收成穗'}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
