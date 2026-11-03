// v0.21 回收站：删掉的穗 / 新枝先在这里放 30 天（墓碑 deletedAt），可恢复、可彻底删除；到期启动时自动清掉。
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, listTrash, purgeTrash, TRASH_DAYS, untrashDevelopments, untrashItems } from '../lib/db';
import { useApp } from '../lib/store';
import { TYPE_LABEL } from '../lib/types';

const SHOW = 12;
const DAY = 86400000;

export function daysLeft(deletedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY - now) / DAY));
}

interface Row {
  kind: 'i' | 'b';
  id: number;
  title: string;
  what: string;
  deletedAt: number;
}

export function TrashPanel() {
  const { toast, confirm } = useApp();
  const trash = useLiveQuery(() => listTrash(db), []);
  const [all, setAll] = useState(false);
  const rows: Row[] = trash
    ? [
        ...trash.items.map((it) => ({ kind: 'i' as const, id: it.id!, title: it.title || '（无标题）', what: TYPE_LABEL[it.type] || '穗', deletedAt: it.deletedAt! })),
        ...trash.developments.map((d) => ({ kind: 'b' as const, id: d.id!, title: (d.idea?.title || '新枝').replace(/^《|》$/g, ''), what: '新枝', deletedAt: d.deletedAt! })),
      ].sort((a, b) => b.deletedAt - a.deletedAt)
    : [];
  const shown = all ? rows : rows.slice(0, SHOW);
  const now = Date.now();

  async function restore(r: Row) {
    if (r.kind === 'i') await untrashItems([r.id]);
    else await untrashDevelopments([r.id]);
    toast(`已恢复「${r.title}」`);
  }
  async function purge(r: Row) {
    if (!(await confirm({ title: `彻底删掉「${r.title}」？`, body: r.kind === 'i' ? '连同原图一起删，不能恢复。' : '不能恢复。', ok: '彻底删掉', cancel: '留着', danger: true }))) return;
    await purgeTrash(r.kind === 'i' ? { items: [r.id] } : { developments: [r.id] });
    toast('已彻底删掉');
  }
  async function restoreAll() {
    if (!trash) return;
    await untrashItems(trash.items.map((x) => x.id!));
    await untrashDevelopments(trash.developments.map((x) => x.id!));
    toast(`已恢复 ${rows.length} 件`);
  }
  async function emptyAll() {
    if (!(await confirm({ title: `清空回收站（${rows.length} 件）？`, body: '里面的穗连同原图、新枝都会彻底删掉，不能恢复。', ok: '清空回收站', cancel: '留着', danger: true }))) return;
    const r = await purgeTrash('all');
    toast(`已彻底删掉 ${r.items + r.developments} 件`);
  }

  return (
    <section className="set-sec trash-panel" id="set-trash">
      <h2 className="sec-title">
        回收站 <span className="num trash-count">({rows.length})</span>
      </h2>
      <p className="meta-text">删掉的穗和新枝先放在这里，{TRASH_DAYS} 天后自动彻底删除。恢复后原图、来源、嫁接次数都还在。</p>
      {rows.length ? (
        <>
          <div className="table trash-table">
            <div className="thead">
              <span className="tc">名字</span>
              <span className="tc">删于</span>
              <span className="tc tc-date">还剩</span>
              <span className="tc tc-act" />
            </div>
            {shown.map((r) => (
              <div key={`${r.kind}${r.id}`} className="trow static trash-row" data-kind={r.kind} data-id={r.id}>
                <span className="tc tc-title trash-title">
                  {r.title} <span className="faint">· {r.what}</span>
                </span>
                <span className="tc num">{new Date(r.deletedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
                <span className="tc tc-date num">{daysLeft(r.deletedAt, now)} 天</span>
                <span className="tc tc-act">
                  <button className="btn text strong trash-restore" onClick={() => restore(r)}>
                    恢复
                  </button>
                  <button className="btn text faint trash-purge" onClick={() => purge(r)}>
                    删
                  </button>
                </span>
              </div>
            ))}
          </div>
          {rows.length > SHOW && (
            <button className="btn text trash-more" onClick={() => setAll(!all)}>
              {all ? '收起' : `全部 (${rows.length})`}
            </button>
          )}
          <div className="actions">
            <button className="btn text strong trash-restore-all" onClick={restoreAll}>
              全部恢复
            </button>
            <button className="btn text faint trash-empty" onClick={emptyAll}>
              清空回收站
            </button>
          </div>
        </>
      ) : (
        <p className="meta-text trash-none">回收站是空的。</p>
      )}
    </section>
  );
}
