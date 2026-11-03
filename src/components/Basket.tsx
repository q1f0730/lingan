import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { BASKET_MAX, BASKET_MIN, basketHint, clearBasket, pruneBasket, removeFromBasket, useBasket } from '../lib/basket';
import { splitBundles, withBundles } from '../lib/bundles';
import { db, updateItem } from '../lib/db';
import { useApp } from '../lib/store';
import { displayTitle } from '../lib/studio';
import type { Item } from '../lib/types';
import { InlineText } from './InlineText';

/**
 * v0.28 0408 常驻「待嫁接篮」：浏览时从长按 / 右键菜单或详情里随手丢进来，满 3 穗一键嫁接。
 * 手机在底栏速记条上面，电脑在侧栏底部。篮子空着就不出现；首屏之后才挂（懒加载）。
 */
export default function Basket({ where }: { where: 'dock' | 'side' }) {
  const { developFrom, toast, openItem } = useApp();
  const ids = useBasket();
  const [open, setOpen] = useState(false);
  const key = ids.join();
  // 带上这次查的是哪几个 id：useLiveQuery 换依赖时会先给上一次的结果，不能拿它去清篮子
  const res = useLiveQuery(async () => ({ key, rows: ids.length ? await db.items.bulkGet(ids) : [] }), [key]);
  const rows = res && res.key === key ? res.rows : undefined;
  useEffect(() => {
    if (!rows || !ids.length || rows.length !== ids.length) return;
    const ok = new Set<number>();
    rows.forEach((r, i) => r && !r.deletedAt && ok.add(ids[i]));
    if (ok.size !== ids.length) pruneBasket(ok);
  }, [rows, ids]);
  useEffect(() => {
    if (!ids.length) setOpen(false);
  }, [ids.length]);
  if (!ids.length) return null;
  const items = (rows || []).filter((r): r is Item => !!r && !r.deletedAt);
  const n = ids.length;
  const graft = () => {
    developFrom(ids.slice(0, BASKET_MAX));
    clearBasket();
  };
  const saveBundle = async (v: string) => {
    const names = splitBundles(v);
    if (!names.length) return;
    for (const it of items) await updateItem(it.id!, { bundles: withBundles(it.bundles, names) });
    toast(`${items.length} 穗加进了穗束「${names.join('、')}」`);
  };
  return (
    <section className={`basket basket-${where}${open ? ' is-open' : ''}`} aria-label="待嫁接篮">
      <div className="basket-row">
        <button className="basket-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="basket-name">嫁接篮</span>
          <span className="basket-n num">
            {n}/{BASKET_MAX}
          </span>
          <span className="basket-dots" aria-hidden>
            {Array.from({ length: BASKET_MAX }, (_, i) => (
              <i key={i} className={i < n ? 'on' : i < BASKET_MIN ? 'need' : ''} />
            ))}
          </span>
        </button>
        <button className="btn primary basket-graft" disabled={n < BASKET_MIN} onClick={graft} title={basketHint(n)}>
          {n < BASKET_MIN ? `差 ${BASKET_MIN - n} 穗` : `嫁接这 ${n} 穗`}
        </button>
      </div>
      {open && (
        <div className="basket-body">
          <p className="meta-text basket-hint">{basketHint(n)}</p>
          <ul className="plain basket-list">
            {items.map((it) => (
              <li key={it.id}>
                <button className="linklike basket-item" onClick={() => openItem(it, ids)}>
                  {displayTitle(it).slice(0, 28)}
                </button>
                <button className="basket-x" onClick={() => removeFromBasket(it.id!)} aria-label={`把「${displayTitle(it).slice(0, 12)}」拿出来`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="basket-acts">
            <InlineText value="" label="存成穗束" placeholder="存成穗束…" allowEmpty={false} maxLength={80} className="basket-bundle" onSave={saveBundle} />
            <button className="btn text faint basket-clear" onClick={clearBasket}>
              清空篮子
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
