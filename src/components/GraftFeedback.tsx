import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/db';
import { clearRejects, deleteReject, FEEDBACK_N, reasonCounts, reasonLabel } from '../lib/feedback';
import { STYLE_LEN, STYLE_MAX } from '../lib/settings';
import { useApp } from '../lib/store';
import { displayTitle, shortDate } from '../lib/studio';
import { TYPE_LABEL, type Item } from '../lib/types';

const SHOW = 10;

/** v0.24 0212 口味页：「不要」的理由。最近 20 条会写进下次嫁接；每条能删，也能全清 */
export function RejectsPanel() {
  const { toast, confirm } = useApp();
  const rows = useLiveQuery(() => db.rejects.orderBy('createdAt').reverse().toArray(), []);
  const [all, setAll] = useState(false);
  const counts = useMemo(() => reasonCounts(rows || []), [rows]);
  if (!rows) return null;
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <section className="taste-sec wide rejects" data-count={rows.length}>
      <div className="fb-head">
        <h2 className="fb-title">
          不要的理由 <span className="n num">({rows.length})</span>
        </h2>
        <p className="meta-text fb-sub">点「不要」时选的理由。最近 {FEEDBACK_N} 条会写进下次嫁接的提示词，让它别再犯同样的毛病。不想让它参考的，删掉就行。</p>
      </div>
      {rows.length ? (
        <>
          <p className="reason-sum">
            {counts.map((c) => (
              <span key={c.label} className="tag reason-tag">
                {c.label} <span className="n">{c.n}</span>
              </span>
            ))}
          </p>
          <div className="table reject-table">
            <div className="thead">
              <span className="tc">新枝</span>
              <span className="tc">理由</span>
              <span className="tc tc-date">日期</span>
              <span className="tc tc-act" />
            </div>
            {shown.map((r, i) => (
              <div key={r.id} className={`trow static reject-row${i < FEEDBACK_N ? ' in-prompt' : ''}`} data-reason={r.reason}>
                <span className="tc tc-title">{r.title || '无题'}</span>
                <span className="tc reject-why">{reasonLabel(r)}</span>
                <span className="tc tc-date num">{shortDate(r.createdAt)}</span>
                <span className="tc tc-act">
                  <button
                    className="btn text faint reject-del"
                    onClick={async () => {
                      await deleteReject(r.id!);
                      toast('删掉了这条理由，以后的嫁接不再参考它');
                    }}
                  >
                    删掉
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="actions text-actions">
            {rows.length > SHOW && (
              <button className="btn text" onClick={() => setAll(!all)}>
                {all ? '收起' : `全部 (${rows.length})`}
              </button>
            )}
            <button
              className="btn text faint reject-clear"
              onClick={async () => {
                if (!(await confirm({ title: `清空 ${rows.length} 条理由？`, body: '新枝不受影响；以后的嫁接不再参考这些理由。', ok: '清空', cancel: '留着', danger: true }))) return;
                await clearRejects();
                toast('理由清空了');
              }}
            >
              全部清空
            </button>
          </div>
        </>
      ) : (
        <p className="meta-text reject-empty">还没有。新枝不合心意时点「不要」，顺手选个理由（太俗 / 太远 / 做不了 / 不像我 / 自己写一句）。</p>
      )}
    </section>
  );
}

/** v0.24 0206 口味页：我讨厌的（反口味）。不当素材抽，嫁接时列进 AVOID；点「不讨厌了」放回普通穗 */
export function DislikePanel({ items }: { items: Item[] }) {
  const { toast, openItem } = useApp();
  const list = useMemo(() => items.filter((i) => i.polarity === -1).sort((a, b) => b.createdAt - a.createdAt), [items]);
  return (
    <section className="taste-sec dislikes" data-count={list.length}>
      <div className="label">
        我讨厌的 <span className="n num">({list.length})</span>
      </div>
      {list.length ? (
        <div className="table two-col">
          {list.slice(0, 12).map((it) => (
            <div key={it.id} className="trow static dislike-row" data-item-id={it.id}>
              <button className="tc tc-title linklike" onClick={() => openItem(it)}>
                {displayTitle(it)} <span className="dim">· {TYPE_LABEL[it.type]}</span>
              </button>
              <span className="tc tc-date">
                <button
                  className="btn text faint undislike"
                  onClick={async () => {
                    await db.items.update(it.id!, { polarity: undefined });
                    toast('放回普通穗了');
                  }}
                >
                  不讨厌了
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="meta-text">拾穗时点「讨厌」就记在这里：嫁接不会拿它当素材，只告诉模型别往那边长。</p>
      )}
    </section>
  );
}

/** v0.24 0210 口味页：我的文风（最多 3 段、每段 300 字），开着时嫁接照这个语气写 */
export function StylePanel() {
  const { settings, setSettings, toast } = useApp();
  const st = settings.style || { on: false, samples: [] };
  const [draft, setDraft] = useState<string[]>(() => Array.from({ length: STYLE_MAX }, (_, i) => st.samples[i] || ''));
  useEffect(() => setDraft(Array.from({ length: STYLE_MAX }, (_, i) => (settings.style?.samples || [])[i] || '')), [settings.style]);
  const filled = draft.filter((x) => x.trim()).length;
  const dirty = draft.some((x, i) => x !== (st.samples[i] || ''));
  const save = (on = st.on) => {
    setSettings({ ...settings, style: { on, samples: draft.map((x) => x.slice(0, STYLE_LEN)).filter((x) => x.trim()) } });
  };
  return (
    <section className="taste-sec wide style-panel" data-on={st.on ? '1' : '0'}>
      <div className="fb-head">
        <h2 className="fb-title">
          我的文风 <span className="n num">({filled})</span>
        </h2>
        <p className="meta-text fb-sub">贴最多 {STYLE_MAX} 段你自己写的文字（每段 {STYLE_LEN} 字内）。开着时嫁接会照这个语气写新枝：只学语气和句子长短，不抄内容。</p>
      </div>
      <label className="check style-on">
        <input
          type="checkbox"
          checked={st.on}
          onChange={(e) => {
            save(e.target.checked);
            toast(e.target.checked ? (filled ? '嫁接会照你的文风写' : '先贴一段你写的文字') : '文风样本先不用了');
          }}
        />{' '}
        嫁接时用我的文风
      </label>
      <div className="style-list">
        {draft.map((x, i) => (
          <label key={i} className="field style-field">
            <span className="label">
              样本 {i + 1} <span className="dim num">{x.length}/{STYLE_LEN}</span>
            </span>
            <textarea
              className="style-input"
              rows={3}
              maxLength={STYLE_LEN}
              value={x}
              placeholder={i === 0 ? '比如：你发过的一条朋友圈、一段日记、一首歌词' : '可空'}
              onChange={(e) => setDraft(draft.map((y, j) => (j === i ? e.target.value : y)))}
            />
          </label>
        ))}
      </div>
      <div className="actions text-actions">
        <button
          className="btn text strong style-save"
          disabled={!dirty}
          onClick={() => {
            save();
            toast('文风样本存好了');
          }}
        >
          保存样本
        </button>
      </div>
    </section>
  );
}
