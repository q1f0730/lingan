// v0.39 0054 链接解析失败的穗打「待补」，联网后自动重试解析并补封面 / 快照；顺带每天拉一次订阅（0804）。
// 只在本机有待补计数（glean.metatodo）或有订阅（glean.feeds.n）时，main.tsx 才在空闲时加载这个模块。
import { db } from './db';
import { fetchLinkMeta, snapOn } from './linkmeta';
import { fillItem, updateItem } from './repo';
import { itemHasImage } from './imagestore';
import { plugOn } from './plugs';
import { outboundOff } from './gate';
import type { Item } from './types';

const TRY_KEY = 'glean.metatodo.try';
// 待补：标记 + 本机计数（main.tsx 空闲时看计数，没有待补的就一行都不读）
export const TODO_KEY = 'glean.metatodo';
export async function markMetaTodo(id: number): Promise<void> {
  await fillItem(id, { metaTodo: 1 });
  try {
    localStorage.setItem(TODO_KEY, String(+(localStorage.getItem(TODO_KEY) || 0) + 1));
  } catch {
    /* ignore */
  }
  // App 一直开着、网回来了：马上补
  if (typeof window !== 'undefined') window.addEventListener('online', () => void backgroundTick(), { once: true });
}
const MAX_TRIES = 5;
const PER_TICK = 8;

/** 用链接补一穗：标题（标题还是链接本身时）、作者 / 站名、摘要、封面、正文快照；成功就去掉待补 */
export async function fillFromLink(id: number, url: string, snap = snapOn()): Promise<boolean> {
  const m = await fetchLinkMeta(url, { snap });
  const cur = await db.items.get(id);
  if (!cur) return false;
  const titleIsUrl = !cur.title || cur.title === url || cur.title === cur.url;
  const patch: Partial<Item> = {
    type: cur.type === 'link' ? m.type : cur.type,
    title: titleIsUrl ? m.title || cur.title : cur.title,
    creator: cur.creator || m.creator || m.siteName || '',
    content: cur.content || m.description || '',
    metaTodo: undefined,
  };
  if (m.snap && !cur.snap) Object.assign(patch, { snap: m.snap, snapAt: Date.now() });
  await fillItem(id, patch);
  if (m.imageData && !itemHasImage(cur)) await updateItem(id, { image: m.imageData });
  return true;
}

function tries(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TRY_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/** 重试一批待补；返回补上几条、还剩几条 */
export async function retryTodo(limit = PER_TICK): Promise<{ done: number; left: number }> {
  const rows = await db.items.filter((x) => x.metaTodo === 1 && !x.deletedAt && !!x.url).toArray();
  const t = tries();
  let done = 0;
  for (const it of rows.slice(0, limit)) {
    try {
      if (await fillFromLink(it.id!, it.url!)) {
        done++;
        delete t[it.id!];
      }
    } catch {
      t[it.id!] = (t[it.id!] || 0) + 1;
      // 试了 5 次还不行：不再自动试（详情里还能手动「现在再试」）
      if (t[it.id!] >= MAX_TRIES) {
        await fillItem(it.id!, { metaTodo: undefined });
        delete t[it.id!];
      }
    }
  }
  const left = await db.items.filter((x) => x.metaTodo === 1 && !x.deletedAt).count();
  try {
    localStorage.setItem(TRY_KEY, JSON.stringify(t));
    if (left) localStorage.setItem(TODO_KEY, String(left));
    else localStorage.removeItem(TODO_KEY);
  } catch {
    /* ignore */
  }
  return { done, left };
}

let armed = false;
/** 启动后空闲时：在线就补一批待补、拉一次订阅；不在线就等 online 事件再来一次 */
export async function backgroundTick(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!armed) {
      armed = true;
      window.addEventListener('online', () => void backgroundTick(), { once: true });
    }
    return;
  }
  armed = false;
  if (outboundOff()) return;
  if (+(localStorage.getItem(TODO_KEY) || 0) > 0 && plugOn('link')) await retryTodo().catch(() => undefined);
  if (localStorage.getItem('glean.feeds.n') && plugOn('feeds')) await import('./feeds').then((f) => f.dailyPull()).catch(() => undefined);
}
