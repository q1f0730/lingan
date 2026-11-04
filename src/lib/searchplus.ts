/**
 * v0.41 秒搜加厚：智能穗束（0128）、命令面板（0137）、你忘了你收过（0133）、没结果时的下一步（0428）。纯函数，单测覆盖。
 */
import { TYPE_LABEL, type Item, type ItemType } from './types';

// ——— 0128 智能穗束：存的是查询（语法 + 字），打开时按当下的穗仓重新算 ———
export const SMART_KEY = 'glean.smart';
export const SMART_MAX = 12;
export interface Smart {
  q: string;
  at: number;
}
export function loadSmart(): Smart[] {
  try {
    const v = JSON.parse(localStorage.getItem(SMART_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.q === 'string' && x.q.trim()).slice(0, SMART_MAX) : [];
  } catch {
    return [];
  }
}
export function saveSmart(list: Smart[]): void {
  try {
    localStorage.setItem(SMART_KEY, JSON.stringify(list.slice(0, SMART_MAX)));
  } catch {
    /* 隐私模式 */
  }
}
/** 新的放最前、同一条只留一份 */
export function addSmart(list: Smart[], q: string, now = Date.now()): Smart[] {
  const k = q.trim().replace(/\s+/g, ' ');
  if (!k) return list;
  return [{ q: k, at: now }, ...list.filter((x) => x.q !== k)].slice(0, SMART_MAX);
}
export function dropSmart(list: Smart[], q: string): Smart[] {
  return list.filter((x) => x.q !== q);
}
/** 当前的类型 / 标签筛选（chip）也写进查询，存下来才是同一个集合；带空格的标签加引号 */
export function smartQuery(q: string, type: ItemType | 'all' | 'branch', tag: string | null): string {
  const parts = [q.trim()];
  if (type !== 'all' && type !== 'branch' && !/(^|\s)(type|类型|t)[:：]/i.test(q)) parts.push(`type:${TYPE_LABEL[type]}`);
  if (tag && !q.includes(`tag:${tag}`)) parts.push(/\s/.test(tag) ? `tag:"${tag}"` : `tag:${tag}`);
  return parts.filter(Boolean).join(' ');
}

// ——— 0137 命令面板：查询以 > 开头 ———
export function isCommand(q: string): boolean {
  return /^\s*[>＞》]/.test(q);
}
export function commandText(q: string): string {
  return q.replace(/^\s*[>＞》]\s*/, '').trim().toLowerCase();
}
export interface Cmd {
  id: string;
  label: string;
  /** 额外的匹配词（英文、别称） */
  keys: string;
}
/** 按标签 / 关键词过滤，前缀命中排前面 */
export function filterCmds<T extends Cmd>(cmds: T[], s: string): T[] {
  if (!s) return cmds;
  const hit = (c: T) => {
    const hay = (c.label + ' ' + c.keys).toLowerCase();
    if (c.label.toLowerCase().startsWith(s) || c.keys.toLowerCase().split(' ').some((k) => k.startsWith(s))) return 2;
    return hay.includes(s) ? 1 : 0;
  };
  return cmds
    .map((c, i) => ({ c, i, h: hit(c) }))
    .filter((x) => x.h)
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map((x) => x.c);
}

// ——— 0133 你忘了你收过：命中里最老的一穗，至少 minDays 天前收的 ———
export const FORGOT_DAYS = 300;
export function forgotten(hits: Item[], now = Date.now(), minDays = FORGOT_DAYS): { it: Item; years: number; months: number } | null {
  let best: Item | null = null;
  for (const it of hits) if (now - it.createdAt >= minDays * 864e5 && (!best || it.createdAt < best.createdAt)) best = it;
  if (!best) return null;
  const months = Math.floor((now - best.createdAt) / (30.44 * 864e5));
  return { it: best, years: Math.floor(months / 12), months };
}
export function agoText(f: { years: number; months: number }): string {
  return f.years >= 1 ? `${f.years} 年前` : `${f.months} 个月前`;
}

// ——— 0428 没结果：能去掉的筛选，一条一个按钮 ———
export interface Loosen {
  id: 'type' | 'tag' | 'range' | 'syntax';
  label: string;
}
export function loosenOptions(o: { type: string; typeLabel?: string; tag: string | null; range: string; rangeLabel?: string; filters: number }): Loosen[] {
  const out: Loosen[] = [];
  if (o.filters) out.push({ id: 'syntax', label: '去掉语法筛选' });
  if (o.type !== 'all') out.push({ id: 'type', label: `不限类型（现在：${o.typeLabel || o.type}）` });
  if (o.tag) out.push({ id: 'tag', label: `不限标签（现在：#${o.tag}）` });
  if (o.range !== 'all') out.push({ id: 'range', label: `不限日期（现在：${o.rangeLabel || o.range}）` });
  return out;
}
