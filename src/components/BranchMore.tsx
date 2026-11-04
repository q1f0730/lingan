// v0.30 一根新枝下面的「之后」：0904 落地追踪（种子 / 试过 / 做成 / 放弃 + 附结果图成新穗）、
// ROADMAP v0.24 再嫁接（更野 / 更能落地 / 换一种形式，子枝挂在原枝下）、0204 追问（回答只用这批穗）。
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { addItem, db } from '../lib/db';
import { addDevelopment, attachResult, setDevStatus, setFollowups, setSurprise } from '../lib/repo';
import { askFollowup, childDevelopment, regraft, REGRAFT_LABEL, resultItem, STATUS_LABEL, STATUS_ORDER, statusOf, withFollowup } from '../lib/branchplus';
import { compressImage } from '../lib/image';
import { aiVisible } from '../lib/privacy';
import { aiReady } from '../lib/settings';
import { useApp } from '../lib/store';
import type { BranchStatus, Development, Idea, Item, RegraftKind } from '../lib/types';
import { WILD_TEMP } from '../lib/constraints';
import { IdeaCard } from './IdeaCard';
import '../styles/v030.css';
import '../styles/v042.css';

/** 「用了什么约束」：斜策略 / 硬约束 / 野一点 / 亲手挑的张力 */
export function ConstraintsUsed({ idea }: { idea: Idea }) {
  if (!idea.oblique && !idea.constraint && !idea.wild && !idea.focus?.length) return null;
  return (
    <div className="idea-cons">
      <span className="label">用了什么约束</span>
      <ul className="idea-cons-list">
        {idea.oblique && <li className="idea-oblique meta-text">斜策略：{idea.oblique}</li>}
        {idea.constraint && <li className="idea-constraint meta-text">硬约束：{idea.constraint}</li>}
        {idea.wild && <li className="idea-wild meta-text">野一点（温度 {WILD_TEMP}，先破一个前提）</li>}
        {idea.focus?.length ? <li className="idea-focus meta-text">沿着我挑的张力：{idea.focus.join(' / ')}</li> : null}
      </ul>
    </div>
  );
}

export function BranchMore({ dev, depth }: { dev: Development & { id: number }; depth: number }) {
  const { settings, toast } = useApp();
  // 这批的全部穗（按 itemIds 的顺序；新枝 refs 是这里的位置），删掉的不算
  const items = useLiveQuery(async () => (await db.items.bulkGet(dev.itemIds.filter((x) => x > 0))).filter((x): x is Item => !!x && !x.deletedAt), [dev.itemIds.join(',')]) || [];
  const [busy, setBusy] = useState<RegraftKind | 'ask' | 'result' | null>(null);
  const [q, setQ] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const st = statusOf(dev);
  const [now] = useState(() => Date.now());
  // 私密穗 + 云端模型：不发出去，走离线
  const cloudOk = aiReady(settings) && items.every((x) => aiVisible(x, settings));
  const setStatus = async (s: BranchStatus) => {
    await setDevStatus(dev.id, s);
    toast(`标成「${STATUS_LABEL[s]}」`);
  };
  async function grow(kind: RegraftKind) {
    if (busy) return;
    setBusy(kind);
    try {
      const fresh = (await db.developments.get(dev.id)) || dev;
      const r = await regraft(cloudOk ? settings : null, fresh, items, kind);
      if (!fresh.uid) throw new Error('这根新枝还没有 uid，稍后再试');
      await addDevelopment(childDevelopment(fresh, r.idea, kind, r.source, Date.now(), items.map((x) => x.id!)));
      toast(`「${REGRAFT_LABEL[kind]}」长出一根子枝${r.source === 'offline' ? '（离线）' : ''}${r.error ? `：模型没接上（${r.error.slice(0, 30)}），用离线` : ''}`, r.error ? 'err' : undefined);
    } catch (e) {
      toast('没长出来：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(null);
    }
  }
  async function ask() {
    const text = q.trim();
    if (!text || busy) return;
    setBusy('ask');
    try {
      const f = await askFollowup(cloudOk ? settings : null, dev, items, text);
      const fresh = (await db.developments.get(dev.id)) || dev;
      await setFollowups(dev.id, withFollowup(fresh.followups, f));
      setQ('');
    } catch (e) {
      toast('没问成：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(null);
    }
  }
  async function attach(f: File | undefined) {
    if (!f) return;
    setBusy('result');
    try {
      const data = f.type.startsWith('image/') ? await compressImage(f, 1600, 0.85) : undefined;
      const id = await addItem(resultItem(dev, data, ''));
      const it = await db.items.get(id);
      await attachResult(dev.id, it?.uid);
      toast('结果收成了一穗，挂在这根新枝下');
    } catch (e) {
      toast('没收成：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(null);
      if (file.current) file.current.value = '';
    }
  }
  return (
    <div className="branch-more" data-status={st}>
      {/* v0.42 ROADMAP v0.32 这根新枝怎么样：意外程度 1–5（再点一次取消） */}
      <div className="idea-rate" role="radiogroup" aria-label="意外程度">
        <span className="label">有多意外</span>
        <div className="seg rate-seg">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={dev.surprise === n} className={dev.surprise === n ? 'on' : ''} data-n={n} onClick={() => void setSurprise(dev.id, dev.surprise === n ? undefined : n)} title={n === 1 ? '早就想到了' : n === 5 ? '完全没想到' : undefined}>
              {n}
            </button>
          ))}
        </div>
        <span className="rate-hint meta-text">{dev.surprise ? (dev.surprise >= 4 ? '没想到' : dev.surprise <= 2 ? '意料之中' : '有点意外') : '1 早想到了 · 5 完全没想到'}</span>
      </div>
      <div className="idea-status" role="radiogroup" aria-label="做了吗">
        <span className="label">做了吗</span>
        <div className="seg status-seg">
          {STATUS_ORDER.map((s) => (
            <button key={s} role="radio" aria-checked={st === s} data-status={s} className={st === s ? 'on' : ''} onClick={() => void setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {(st === 'tried' || st === 'done') && (
          <>
            <button className="btn text result-add" onClick={() => file.current?.click()} disabled={busy === 'result'}>
              {busy === 'result' ? '在收…' : '附一张结果图'}
            </button>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void attach(e.target.files?.[0])} aria-label="结果图" />
          </>
        )}
        {dev.resultUids?.length ? <span className="result-n meta-text">结果 {dev.resultUids.length} 穗</span> : null}
        {/* v0.42 0221 停在这一档几天了 */}
        {st !== 'dropped' && <span className="stay-n meta-text">「{STATUS_LABEL[st]}」第 {Math.max(0, Math.floor((now - (dev.statusAt || dev.createdAt)) / 86400000)) + 1} 天</span>}
      </div>
      {depth < 3 && (
        <div className="idea-regraft">
          <span className="label">再嫁接</span>
          {(['wilder', 'grounded', 'reform'] as RegraftKind[]).map((k) => (
            <button key={k} className="btn text regraft-btn" data-kind={k} onClick={() => void grow(k)} disabled={!!busy}>
              {busy === k ? '在长…' : REGRAFT_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {/* v0.42 可复现：模型 / 提示词版本 */}
      <p className="idea-made meta-text">
        {dev.source === 'ai' ? `模型 ${dev.batch?.model || '没记下'}` : '离线嫁接'} · 提示词 {dev.batch?.prompt || '早先的'}
        {dev.batch?.draw ? ` · ${dev.batch.draw}` : ''}
      </p>
      <div className="idea-ask">
        {(dev.followups || []).map((f, i) => (
          <div key={i} className="followup" data-source={f.source}>
            <p className="followup-q">
              <span className="label">问</span> {f.q}
            </p>
            <p className="followup-a">
              {f.a}
              {f.source === 'offline' && <span className="dim"> · 离线</span>}
            </p>
          </div>
        ))}
        <div className="ask-row">
          <input
            className="line-input followup-input"
            value={q}
            maxLength={120}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void ask()}
            placeholder="追问：这个怎么拍 / 开头怎么写"
            aria-label="追问这根新枝"
          />
          <button className="btn text strong followup-go" onClick={() => void ask()} disabled={!q.trim() || !!busy}>
            {busy === 'ask' ? '在想…' : '问'}
          </button>
        </div>
        <p className="meta-text followup-note">回答只用这根新枝的那几穗{cloudOk ? '' : aiReady(settings) ? '（有私密穗，这次离线答）' : '（没连模型，离线答）'}。</p>
      </div>
    </div>
  );
}

/** 子枝：挂在父枝下面，缩进一层（最多三代） */
export function ChildBranches({ parentUid, depth }: { parentUid: string; depth: number }) {
  const kids = useLiveQuery(() => db.developments.filter((d) => d.parentUid === parentUid && !d.deletedAt).toArray(), [parentUid]);
  if (!kids?.length) return null;
  return (
    <div className="idea-children" data-depth={depth}>
      <div className="label idea-children-k">子枝 ({kids.length})</div>
      {kids
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((k) => (
          <div key={k.id} className="idea-child" data-regraft={k.regraft}>
            <span className="idea-child-how label">{k.regraft ? REGRAFT_LABEL[k.regraft] : ''}</span>
            <IdeaCard idea={k.idea} source={k.source} devId={k.id} hideCliches depth={depth} />
          </div>
        ))}
    </div>
  );
}
