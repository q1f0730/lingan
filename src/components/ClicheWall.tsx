import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { addUserCliche, db, strikeCliche } from '../lib/db';
import { useApp } from '../lib/store';
import { BUILTIN_FORBIDDEN, sortWall, type Cliche } from '../lib/wall';

const SHOW = 12;

/**
 * v0.19 我的套路墙（口味页）：模型列过的套路 + 我加的讨厌的词 / 梗。
 * 无线表格：套路 / 来源 / 拦下 / 划掉；底部一行输入加词；划掉的单独收在下面，可恢复。计数是真实条数。
 */
export function ClicheWall() {
  const { toast } = useApp();
  const rows = useLiveQuery(() => db.cliches.toArray(), []);
  const [text, setText] = useState('');
  const [all, setAll] = useState(false);
  const [showStruck, setShowStruck] = useState(false);
  const active = useMemo(() => sortWall((rows || []).filter((c) => !c.struck)), [rows]);
  const struck = useMemo(() => sortWall((rows || []).filter((c) => c.struck)), [rows]);
  if (!rows) return null;
  const shown = all ? active : active.slice(0, SHOW);

  async function add() {
    const r = await addUserCliche(text);
    if (r.status === 'invalid') {
      toast('至少两个字（英文至少三个字母）', 'err');
      return;
    }
    setText('');
    toast(r.status === 'added' ? `「${r.text}」上墙了，以后的新枝都不会出现它` : r.status === 'restored' ? `「${r.text}」恢复上墙` : `「${r.text}」已经在墙上`);
  }

  async function strike(c: Cliche, on: boolean) {
    await strikeCliche(c.id!, on);
    toast(on ? `划掉了「${c.text}」，以后不再禁用` : `「${c.text}」恢复上墙`);
  }

  return (
    <section className="taste-sec wide wall" data-count={active.length}>
      <div className="wall-head">
        <h2 className="wall-title">
          套路墙 <span className="n num">({active.length})</span>
        </h2>
        <p className="meta-text wall-sub">每次嫁接时模型列出的套路会自动上墙；以后的嫁接全部禁用，生成后再逐根检查，撞墙的那根重写或换掉。误伤的划掉就行。</p>
      </div>
      <form
        className="wall-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add();
        }}
      >
        <input className="line-input wall-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="加一个你讨厌的词或梗，比如：雨夜、宿命感" maxLength={40} aria-label="加一个讨厌的词或梗" />
        <button className="btn text strong wall-add-btn" type="submit" disabled={!text.trim()}>
          加上墙
        </button>
      </form>
      {active.length ? (
        <div className="table wall-table">
          <div className="thead">
            <span className="tc">套路</span>
            <span className="tc">来源</span>
            <span className="tc tc-date">拦下</span>
            <span className="tc tc-act" />
          </div>
          {shown.map((c) => (
            <div key={c.id} className="trow static wall-row" data-key={c.key} data-source={c.source}>
              <span className="tc tc-title wall-text">{c.text}</span>
              <span className="tc wall-src">{c.source === 'user' ? '我加的' : `模型列过 ${c.listed} 次`}</span>
              <span className="tc tc-date num">{c.blocked || 0}</span>
              <span className="tc tc-act">
                <button className="btn text faint wall-strike" onClick={() => strike(c, true)}>
                  划掉
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="meta-text wall-empty">墙上还是空的。嫁接一次，模型列出的套路就会上墙；也可以先加几个你讨厌的词。</p>
      )}
      {active.length > SHOW && (
        <button className="btn text wall-more" onClick={() => setAll(!all)}>
          {all ? '收起' : `全部 (${active.length})`}
        </button>
      )}
      {struck.length > 0 && (
        <div className="wall-struck">
          <button className="btn text faint wall-struck-toggle" onClick={() => setShowStruck(!showStruck)} aria-expanded={showStruck}>
            划掉的 ({struck.length})
          </button>
          {showStruck && (
            <div className="table wall-table">
              {struck.map((c) => (
                <div key={c.id} className="trow static wall-row struck" data-key={c.key}>
                  <span className="tc tc-title wall-text">
                    <s>{c.text}</s>
                  </span>
                  <span className="tc wall-src">{c.source === 'user' ? '我加的' : `模型列过 ${c.listed} 次`}</span>
                  <span className="tc tc-date num">{c.blocked || 0}</span>
                  <span className="tc tc-act">
                    <button className="btn text faint wall-restore" onClick={() => strike(c, false)}>
                      恢复
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="meta-text wall-builtin">另有 {BUILTIN_FORBIDDEN.length} 个一直禁用的词：{BUILTIN_FORBIDDEN.join('、')}。</p>
    </section>
  );
}
