// v0.35 设置 · 备份与导入 →「从别处搬进来」（ROADMAP v0.28 + 0014 0802 0049 0065）：选文件 → 本机解析 → 预览（新 / 已有 / 读不出）→ 先拍快照再导入。
import { useRef, useState } from 'react';
import { db } from '../lib/db';
import type { Draft } from '../lib/importers';
import { withSnapshot } from '../lib/snapshots';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER } from '../lib/types';

interface Plan {
  name: string;
  kind: string;
  fresh: Draft[];
  dup: number;
  bad: number;
}

export function MoveIn() {
  const { toast } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      const im = await import('../lib/importers');
      const p = await im.parseFile(f.name, new Uint8Array(await f.arrayBuffer()));
      const { fresh, dup } = await im.planMoveIn(p);
      setPlan({ name: f.name, kind: p.kind, fresh, dup, bad: p.bad });
    } catch (e) {
      toast('读不出这个文件：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  }

  async function go() {
    if (!plan || busy) return;
    setBusy(true);
    const d = new Date();
    const bundle = `导入 · ${plan.kind} ${d.getMonth() + 1}/${d.getDate()}`;
    try {
      const { runMoveIn } = await import('../lib/importers');
      const { result: n } = await withSnapshot(`搬进来（${plan.kind}）前`, db, () => runMoveIn(plan.fresh, bundle), { required: false });
      toast(`搬进来 ${n} 穗 · 放在穗束「${bundle}」${plan.dup ? ` · 已有的 ${plan.dup} 穗跳过` : ''}${plan.bad ? ` · ${plan.bad} 行读不出` : ''}`);
      setPlan(null);
    } catch (e) {
      toast('没导完：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }

  const by = plan ? TYPE_ORDER.map((t) => [t, plan.fresh.filter((x) => x.type === t).length] as const).filter(([, n]) => n) : [];
  return (
    <>
      <div className="table action-table">
        <button className="trow movein-pick" onClick={() => ref.current?.click()}>
          <span className="tc tc-title">从别处搬进来</span>
          <span className="tc tc-src">豆瓣（豆伴导出）、flomo、浏览器书签、Kindle 标注、微信读书笔记、纯文本；先看条数，重复的不再收</span>
          <span className="tc tc-date">.csv 等</span>
        </button>
      </div>
      <input ref={ref} className="movein-file" type="file" accept=".csv,.tsv,.xlsx,.html,.htm,.txt,.md,text/*" hidden onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }} />
      {plan && (
        <div className="import-preview movein-preview" data-new={plan.fresh.length} data-dup={plan.dup} data-bad={plan.bad}>
          <p className="meta-text">
            {plan.name} · 认作「{plan.kind}」 · 新的 {plan.fresh.length} 穗 · 已经有的 {plan.dup} 穗（跳过）{plan.bad ? ` · ${plan.bad} 行读不出` : ''}
          </p>
          {by.length > 0 && <p className="meta-text">{by.map(([t, n]) => `${TYPE_LABEL[t]} ${n}`).join(' · ')}</p>}
          <ol className="movein-list meta-text">
            {plan.fresh.slice(0, 5).map((x, i) => (
              <li key={i}>{x.title}</li>
            ))}
          </ol>
          <div className="actions">
            <button className="btn primary movein-go" onClick={go} disabled={busy || !plan.fresh.length}>
              {busy ? '导入中…' : `导入 ${plan.fresh.length} 穗`}
            </button>
            <button className="btn text" onClick={() => setPlan(null)} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      )}
    </>
  );
}
