// v0.24 0212 不要的理由：点「不要」时可选一个理由（太俗 / 太远 / 做不了 / 不像我 / 自定义），
// 最近 20 条写进下次嫁接提示词的 FEEDBACK 段；口味页能看到、能删。
import { db as defaultDb, type LinganDB } from './db';
import type { Development, Reject } from './types';

export interface ReasonDef {
  id: string;
  label: string;
  /** 写进提示词时的说法 */
  ask: string;
}
export const REASONS: ReasonDef[] = [
  { id: 'cliche', label: '太俗', ask: '太俗、太常见，像谁都能想到的' },
  { id: 'far', label: '太远', ask: '离素材太远，看不出是这几穗长出来的' },
  { id: 'hard', label: '做不了', ask: '我做不出来（太贵 / 太大 / 要别人帮忙）' },
  { id: 'notme', label: '不像我', ask: '不像我会做的东西' },
];
export const CUSTOM = 'custom';
const BY_ID = new Map(REASONS.map((r) => [r.id, r]));
/** 写进提示词的条数 */
export const FEEDBACK_N = 20;
/** 自定义理由最长 */
export const CUSTOM_MAX = 40;

export function reasonLabel(r: Pick<Reject, 'reason' | 'text'>): string {
  if (r.reason === CUSTOM) return (r.text || '').trim() || '自定义';
  return BY_ID.get(r.reason)?.label || r.reason;
}

/** 清理用户写的自定义理由：去空白、去换行、截断 */
export function cleanCustom(t: string | undefined | null): string {
  return String(t || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, CUSTOM_MAX);
}

/** 记一条理由。reason = 快捷理由 id 或 custom（text 为空就不记）。返回新行 id（没记返回 null） */
export async function addReject(dev: Pick<Development, 'idea' | 'uid'>, reason: string, text?: string, d: LinganDB = defaultDb, now = Date.now()): Promise<number | null> {
  const custom = reason === CUSTOM ? cleanCustom(text) : '';
  if (reason === CUSTOM ? !custom : !BY_ID.has(reason)) return null;
  const row: Reject = {
    reason,
    ...(custom ? { text: custom } : {}),
    title: (dev.idea?.title || '').replace(/^《|》$/g, '').slice(0, 30),
    gist: (dev.idea?.bridge || dev.idea?.idea || '').slice(0, 60) || undefined,
    ...(dev.uid ? { devUid: dev.uid } : {}),
    createdAt: now,
  };
  return d.rejects.add(row);
}

export async function deleteReject(id: number, d: LinganDB = defaultDb) {
  await d.rejects.delete(id);
}
export async function clearRejects(d: LinganDB = defaultDb) {
  await d.rejects.clear();
}
export async function recentRejects(n = FEEDBACK_N, d: LinganDB = defaultDb): Promise<Reject[]> {
  return d.rejects.orderBy('createdAt').reverse().limit(n).toArray();
}

/** 各理由的次数（多→少；自定义按原话合并） */
export function reasonCounts(rows: Reject[]): Array<{ label: string; n: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = reasonLabel(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}

/** 提示词里的 FEEDBACK 段：最近 n 条（新→旧），先汇总再逐条。没有就返回空串 */
export function feedbackBlock(rows: Reject[], n = FEEDBACK_N): string {
  const list = [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(0, n);
  if (!list.length) return '';
  const sum = reasonCounts(list)
    .map((c) => `${c.label}×${c.n}`)
    .join('、');
  const lines = list.map((r) => {
    const why = r.reason === CUSTOM ? `「${r.text}」` : BY_ID.get(r.reason)?.ask || r.reason;
    return `- 《${r.title || '无题'}》：${why}`;
  });
  return ['FEEDBACK — 我最近不要的新枝和理由（别再往这些方向长；只当反例，不要复述）：', `汇总：${sum}`, ...lines].join('\n');
}

type ConfirmFn = (o: import('./store').ConfirmOpts) => Promise<boolean>;
type ToastFn = (msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }) => void;

/** 「不要」：确认弹层里带可选理由；确认后新枝进回收站，选了理由就记一条（撤销时两样都撤回） */
export async function dropWithReason(dev: Development & { id: number }, confirm: ConfirmFn, toast: ToastFn, d: LinganDB = defaultDb): Promise<boolean> {
  let pick: { id: string | null; text?: string } = { id: null };
  const ok = await confirm({
    title: `不要「${(dev.idea?.title || '').replace(/^《|》$/g, '')}」？`,
    body: '这根新枝会放进回收站（30 天内可恢复），它的来源穗不受影响。选个理由，下次嫁接会避开。',
    ok: '不要了',
    cancel: '留着',
    danger: true,
    reasons: { options: REASONS.map((r) => ({ id: r.id, label: r.label })), custom: CUSTOM, onPick: (id, text) => (pick = { id, text }) },
  });
  if (!ok) return false;
  const { trashDevelopments, untrashDevelopments } = await import('./db');
  await trashDevelopments([dev.id], d);
  const rid = pick.id ? await addReject(dev, pick.id, pick.text, d).catch(() => null) : null;
  const said = rid != null ? (await d.rejects.get(rid)) : undefined;
  toast(said ? `已删掉这根新枝 · 记下了「${reasonLabel(said)}」` : '已删掉这根新枝（在回收站）', 'ok', {
    label: '撤销',
    run: () =>
      void untrashDevelopments([dev.id], d)
        .then(() => (rid != null ? d.rejects.delete(rid) : undefined))
        .then(() => toast('已放回新枝')),
  });
  return true;
}
