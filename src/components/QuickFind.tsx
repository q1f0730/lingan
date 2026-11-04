/**
 * v0.41 0138 速记小窗里也能搜：输入 ? 开头就在小窗里秒搜（标题 / 作者 / 句子 / 为什么 / 标签，繁简互通），回车打开第一条的详情。
 * 懒加载：只有打了 ? 才下载这一块。上锁的穗没解锁时搜不到。
 */
import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/db';
import { hidden } from '../lib/lock';
import { parseQuery, searchDocs, toDoc, type SearchDoc } from '../lib/search';
import { displayTitle, shortDate } from '../lib/studio';
import { TYPE_LABEL, type Item } from '../lib/types';
import '../styles/v041.css';

export const QF_MAX = 6;

export default function QuickFind({ q, sel, onHits, onPick }: { q: string; sel: number; onHits: (hits: Item[]) => void; onPick: (it: Item) => void }) {
  const [docs, setDocs] = useState<Array<SearchDoc<Item>> | null>(null);
  const [zh, setZh] = useState<typeof import('../lib/zhvar') | null>(null);
  useEffect(() => {
    let dead = false;
    void db.items.toArray().then((a) => !dead && setDocs(a.filter((i) => i.id != null && !i.deletedAt && !i.down && !hidden(i)).map((i) => toDoc('i', i))));
    return () => void (dead = true);
  }, []);
  const s = q.trim();
  useEffect(() => {
    if (/[\u3400-\u9fff]/.test(s) && !zh) void import('../lib/zhvar').then(setZh).catch(() => {});
  }, [s, zh]);
  const hits = useMemo(() => {
    if (!docs || !s) return [];
    const seen = new Set<string>();
    const out: Item[] = [];
    for (const qq of [s, ...(zh ? zh.zhVariants(s) : [])])
      for (const h of searchDocs(null, docs, parseQuery(qq)))
        if (!seen.has(h.doc.key) && out.length < QF_MAX) {
          seen.add(h.doc.key);
          out.push(h.doc.obj);
        }
    return out;
  }, [docs, s, zh]);
  useEffect(() => onHits(hits), [hits, onHits]);
  if (!s) return <p className="meta-text qf-hint">? 后面打字就在穗仓里找，回车打开</p>;
  if (!docs) return null;
  return hits.length ? (
    <ul className="qf-list" role="listbox" aria-label="小窗秒搜">
      {hits.map((it, i) => (
        <li key={it.id}>
          <button role="option" aria-selected={i === sel} className={`qf-row${i === sel ? ' on' : ''}`} onClick={() => onPick(it)}>
            <span className="qf-t">{displayTitle(it)}</span>
            <span className="meta-text">
              {TYPE_LABEL[it.type]} · <span className="num">{shortDate(it.createdAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p className="meta-text qf-none">没找到「{s}」</p>
  );
}
