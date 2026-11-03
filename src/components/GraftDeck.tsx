// v0.30 嫁接前的约束台：斜策略卡（可重抽 / 钉住 / 写自己的卡，ROADMAP v0.23）+ 约束骰子（0216）+ 野一点 + 先挑张力（0201）。
// 0201 停在「挑张力」时的那张纸也在这里（TensionPick）。
import { useState } from 'react';
import { addMyCard, cleanCard, dailyConstraint, rollConstraint, WILD_TEMP } from '../lib/constraints';
import type { GraftTension } from '../lib/types';
import '../styles/v030.css';

export interface DeckState {
  card: string;
  pinned: boolean;
  constraint: string | null;
  wild: boolean;
  pick: boolean;
}

export function GraftDeck({ st, set, onDraw, theme, ai, disabled }: { st: DeckState; set: (p: Partial<DeckState>) => void; onDraw: () => void; theme: string; ai: boolean; disabled?: boolean }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const save = () => {
    const c = cleanCard(text);
    if (!c) return;
    addMyCard(c);
    set({ card: c, pinned: true });
    setText('');
    setWriting(false);
  };
  return (
    <section className="deck" aria-label="这次的约束">
      <div className="label">这次的约束</div>
      <div className={`oblique-card${st.pinned ? ' pinned' : ''}`} data-pinned={st.pinned ? '1' : '0'}>
        <span className="oblique-k label">斜策略{st.pinned ? ' · 已钉住' : ''}</span>
        <p className="oblique-text">{st.card}</p>
        <div className="oblique-acts">
          <button className="btn text oblique-draw" onClick={onDraw} disabled={disabled || st.pinned}>
            重抽
          </button>
          <button className="btn text oblique-pin" aria-pressed={st.pinned} onClick={() => set({ pinned: !st.pinned })} disabled={disabled}>
            {st.pinned ? '松开' : '钉住'}
          </button>
          <button className="btn text oblique-write" aria-expanded={writing} onClick={() => setWriting((x) => !x)} disabled={disabled}>
            {writing ? '收起' : '写一张'}
          </button>
        </div>
        {writing && (
          <div className="oblique-new">
            <input className="line-input oblique-input" value={text} maxLength={40} autoFocus onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="一句话，例如：只用夜里的声音" aria-label="自己写一张斜策略卡" />
            <button className="btn text strong oblique-save" onClick={save} disabled={!cleanCard(text)}>
              存成卡并钉住
            </button>
          </div>
        )}
      </div>
      <div className="dice-row">
        <span className="label">硬约束</span>
        {st.constraint ? <span className="dice-text">{st.constraint}</span> : <span className="dice-none meta-text">没有（掷一个，新枝必须满足它）</span>}
        <span className="dice-acts">
          <button className="btn text dice-roll" onClick={() => set({ constraint: st.constraint ? rollConstraint(theme, st.constraint) : dailyConstraint(theme) })} disabled={disabled}>
            {st.constraint ? '重掷' : '掷一个'}
          </button>
          {st.constraint && (
            <button className="btn text faint dice-clear" onClick={() => set({ constraint: null })} disabled={disabled}>
              不要
            </button>
          )}
        </span>
      </div>
      <div className="deck-toggles">
        <button className={`chip deck-wild${st.wild ? ' on' : ''}`} role="switch" aria-checked={st.wild} onClick={() => set({ wild: !st.wild })} disabled={disabled}>
          野一点{st.wild ? ` · 温度 ${WILD_TEMP}` : ''}
        </button>
        {ai && (
          <button className={`chip deck-pick${st.pick ? ' on' : ''}`} role="switch" aria-checked={st.pick} onClick={() => set({ pick: !st.pick })} disabled={disabled}>
            先挑张力再长
          </button>
        )}
      </div>
      {st.wild && <p className="deck-note meta-text">野一点：这次第一步温度临时提到 {WILD_TEMP}，并先打破这组穗默认的一个前提；关掉就回到设置里的温度。</p>}
    </section>
  );
}

/** 0201：第一步找到的张力，勾 1–2 条再往下长；也可以「都要」 */
export function TensionPick({ tensions, names, onDone }: { tensions: GraftTension[]; names: string[]; onDone: (idx: number[] | null) => void }) {
  const [sel, setSel] = useState<number[]>([]);
  const nm = (refs: number[]) => refs.map((r) => names[r - 1]).filter(Boolean).join(' · ');
  const toggle = (i: number) => setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : s.length >= 2 ? [s[1], i] : [...s, i]));
  return (
    <section className="tension-pick" aria-label="挑张力">
      <div className="label">第一步找到 {tensions.length} 个张力 · 勾 1–2 个</div>
      <div className="tension-list" role="group">
        {tensions.map((t, i) => (
          <button key={i} type="button" role="checkbox" aria-checked={sel.includes(i)} className={`tension-chip${sel.includes(i) ? ' on' : ''}`} onClick={() => toggle(i)}>
            <span className="tension-n numeral small">{String(i + 1).padStart(2, '0')}</span>
            <span className="tension-t">{t.text}</span>
            {t.refs.length > 0 && <span className="tension-refs meta-text">{nm(t.refs)}</span>}
          </button>
        ))}
      </div>
      <div className="actions tension-acts">
        <button className="btn primary tension-go" disabled={!sel.length} onClick={() => onDone(sel)}>
          {sel.length ? `沿这 ${sel.length} 条长` : '先勾 1–2 条'}
        </button>
        <button className="btn text tension-all" onClick={() => onDone(null)}>
          都要，直接长
        </button>
      </div>
    </section>
  );
}
