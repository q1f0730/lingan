// v0.23 这穗收过了（ROADMAP v0.31）：刚存下的穗如果和旧穗重复，轻轻提一句「这穗 10/19 收过了」，可以一键合并（可撤销），不理它就是仍然保存。
import { db, ensureImageDup, findDupes, inboxEnabled, mergeInto, restoreItem, snapshotItem, untrashItems } from './db';
import { dupReason } from './dupe';
import { shortDate } from './studio';
import type { Item } from './types';

type Toast = (msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }) => void;

/** 存下后的提示语：待理开着就说「先放在待理」 */
export function savedMsg(n = 1): string {
  return inboxEnabled() ? (n > 1 ? `已拾 ${n} 穗 · 先放在待理` : '已拾 · 先放在待理') : n > 1 ? `已拾进穗仓 ${n} 穗` : '已拾进穗仓';
}

/** 查重并提示。返回找到的旧穗（没有就 null） */
export async function notifyDupe(id: number, toast: Toast): Promise<Item | null> {
  const me = await db.items.get(id);
  // 收进一张图：先确保老原图都有哈希（升级后第一次会慢一点，以后直接查索引）
  if (me?.dup?.some((k) => k.startsWith('i:'))) await ensureImageDup();
  const [old] = await findDupes(id).catch(() => [] as Item[]);
  if (!old) return null;
  const why = dupReason(me?.dup, old.dup);
  toast(`这穗 ${shortDate(old.createdAt)} 收过了${why ? `（${why}）` : ''}`, 'ok', {
    label: '合并',
    run: () => void mergeDupe(old.id!, id, toast),
  });
  return old;
}

/** 合并进旧穗；撤销 = 旧穗回到合并前、新穗从回收站拿回来 */
export async function mergeDupe(keepId: number, dropId: number, toast: Toast) {
  const snap = await snapshotItem(keepId);
  await mergeInto(keepId, dropId);
  const keep = await db.items.get(keepId);
  toast(`已合并进「${(keep?.title || '').slice(0, 16)}」`, 'ok', {
    label: '撤销',
    run: () =>
      void (async () => {
        if (snap) await restoreItem(snap);
        await untrashItems([dropId]);
        toast('已撤销合并');
      })(),
  });
}
