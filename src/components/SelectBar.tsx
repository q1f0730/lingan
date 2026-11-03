// v0.23 一次整理一把（ROADMAP v0.40 / 0159）：多选后批量 加标签 · 改类型 · 入仓 · 删除（可撤销）· 带进嫁接。
import { useState } from 'react';
import { db, keepItems, reInbox, trashItems, untrashItems } from '../lib/db';
import { addTagsTo, removeTagFrom, restoreTypes, setTypeOf } from '../lib/batch';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER } from '../lib/types';

export function SelectBar({ ids, total, onAll, onNone, onDone }: { ids: number[]; total: number; onAll: () => void; onNone: () => void; onDone: () => void }) {
  const { toast, developFrom } = useApp();
  const [tagOpen, setTagOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [tag, setTag] = useState('');
  const n = ids.length;

  async function addTag() {
    const t = tag.trim().replace(/^#/, '');
    if (!t || !n) return;
    const list = [...ids];
    const k = await addTagsTo(list, [t]);
    setTag('');
    setTagOpen(false);
    toast(`${k} 穗加上了 #${t}`, 'ok', { label: '撤销', run: () => void removeTagFrom(list, t) });
  }
  async function retype(t: (typeof TYPE_ORDER)[number]) {
    const prev = await setTypeOf(ids, t);
    setTypeOpen(false);
    toast(`${prev.length} 穗改成了${TYPE_LABEL[t]}`, 'ok', { label: '撤销', run: () => void restoreTypes(prev) });
  }
  async function del() {
    const list = [...ids];
    // v0.26 0621：一次删 2 穗以上先拍快照（撤销之外的第二道保险）
    if (list.length >= 2) {
      const { withSnapshot } = await import('../lib/snapshots');
      await withSnapshot(`批量删除 ${list.length} 穗前`, db, () => trashItems(list), { required: false });
    } else await trashItems(list);
    onNone();
    toast(`删掉了 ${list.length} 穗（在回收站）`, 'ok', { label: '撤销', run: () => void untrashItems(list).then(() => toast('已放回穗仓')) });
  }
  async function keep() {
    const list = [...ids];
    const k = await keepItems(list);
    toast(k ? `${k} 穗出了待理` : '选中的都已经在穗仓里了', 'ok', k ? { label: '撤销', run: () => void reInbox(list) } : undefined);
  }

  return (
    <div className="select-bar" role="toolbar" aria-label="批量整理">
      <div className="sb-row">
        <span className="sb-n">
          已选 <b className="num">{n}</b> / <span className="num">{total}</span>
        </span>
        <button className="btn text sb-all" onClick={n === total ? onNone : onAll}>
          {n === total ? '全不选' : '全选'}
        </button>
        <span className="sb-acts">
          <button className="btn text sb-tag" disabled={!n} onClick={() => (setTagOpen(!tagOpen), setTypeOpen(false))}>
            加标签
          </button>
          <button className="btn text sb-type" disabled={!n} onClick={() => (setTypeOpen(!typeOpen), setTagOpen(false))}>
            改类型
          </button>
          <button className="btn text sb-keep" disabled={!n} onClick={keep}>
            入仓
          </button>
          <button className="btn text sb-graft" disabled={n < 2} onClick={() => developFrom(ids.slice(0, 6))}>
            带进嫁接
          </button>
          <button className="btn text danger sb-del" disabled={!n} onClick={del}>
            删除
          </button>
          <button className="btn text strong sb-done" onClick={onDone}>
            完成
          </button>
        </span>
      </div>
      {tagOpen && (
        <div className="sb-row sb-more">
          <input
            className="sb-tag-input"
            value={tag}
            autoFocus
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void addTag();
              }
              if (e.key === 'Escape') setTagOpen(false);
            }}
            placeholder="标签，回车加上"
            aria-label="批量加标签"
            maxLength={24}
          />
          <button className="btn sb-tag-ok" onClick={addTag} disabled={!tag.trim()}>
            加上
          </button>
        </div>
      )}
      {typeOpen && (
        <div className="sb-row sb-more" role="radiogroup" aria-label="改成">
          {TYPE_ORDER.map((t) => (
            <button key={t} className="chip sb-type-opt" data-type={t} onClick={() => retype(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
