// v0.45 ROADMAP v0.33 到点递一穗（懒加载；首屏画完、空闲后由 App 拉起）：
// - 安卓：交给原生（scripts/android/GleanDaily.kt，LinganDaily 桥）用 AlarmManager 到点发「今日一穗」通知，App 没开也会到；
//   这里只把时间和接下来 7 天每天的那一句算好交过去（App 每次打开刷新一次）。点通知 = glean://go/daily。
// - 电脑：拾穗常驻托盘，这里每分钟看一次，到点发系统通知（0550 全屏 / 专注助手时先憋着，最多等到点后 3 小时）；
//   窗口那时藏在托盘里的话，2 小时内点通知或从托盘把它叫出来，就直接到今日卡（glean://go/daily）。
// - 0839 打开了「同时推到微信」：到点那一刻 App 在跑（电脑托盘 / 手机后台没被杀）就经 Server酱 推一条，只带标题级文字。
import { dayKey } from './heatmap';
import { pickDaily, daysUntouched } from './daily';
import { db, ensureDaily } from './db';
import { lockReady } from './lock';
import { isTauriEnv } from './desktop';
import { dueLetters, fireAt, needWhy, pingDue, pingMessage, readPing, sctUrl, PUSH_HOSTS, type PingCfg, type PingMsg } from './rhythm';
import type { DailyPick, Item } from './types';

const LAST_KEY = 'glean.ping.last';
const WX_LAST_KEY = 'glean.ping.wx';
const GO_KEY = 'glean.ping.go';
const DAY = 86400000;

interface DailyBridge {
  set(json: string): boolean;
  guide(): boolean;
  brand(): string;
}
export function dailyBridge(w: unknown = typeof window === 'undefined' ? undefined : window): DailyBridge | null {
  const b = (w as { LinganDaily?: DailyBridge } | undefined)?.LinganDaily;
  return b && typeof b.set === 'function' ? b : null;
}

async function liveItems(): Promise<Item[]> {
  return (await db.items.toArray()).filter((i) => !i.deletedAt);
}

/** 某一天那条通知的文字（today = 今天：用存好的今日一穗；以后的日子按同样的抽法往后推） */
export async function messageFor(items: Item[], cfg: PingCfg, now = Date.now()): Promise<PingMsg> {
  const devs = (await db.developments.toArray()).filter((d) => !d.deletedAt);
  const pick = await ensureDaily(items).catch(() => null);
  const hero = pick ? items.find((i) => i.id === pick.oldIds[0]) : null;
  return pingMessage({
    hero,
    untouched: hero ? daysUntouched(hero, devs, now) : 0,
    letters: dueLetters(items, now).length,
    noWhy: needWhy(items, now, 99).length,
    hidden: lockReady(),
    withWhy: cfg.why,
  });
}

/** 接下来 n 天每天一条（安卓原生到点直接用；第一天 = 今天） */
export async function messagesAhead(items: Item[], cfg: PingCfg, now = Date.now(), n = 7): Promise<Record<string, PingMsg>> {
  const devs = (await db.developments.toArray()).filter((d) => !d.deletedAt);
  const out: Record<string, PingMsg> = { [dayKey(now)]: await messageFor(items, cfg, now) };
  let prev: Pick<DailyPick, 'oldIds' | 'comboIds'> | null = await ensureDaily(items).catch(() => null);
  const hidden = lockReady();
  for (let k = 1; k < n; k++) {
    const t = fireAt(cfg.at, now + k * DAY);
    const day = dayKey(t);
    const p = pickDaily({ items, devs, day, prev });
    const hero = p ? items.find((i) => i.id === p.oldIds[0]) : null;
    out[day] = pingMessage({ hero, untouched: hero ? daysUntouched(hero, devs, t) : 0, letters: dueLetters(items, t).length, noWhy: needWhy(items, t, 99).length, hidden, withWhy: cfg.why });
    if (p) prev = p;
  }
  return out;
}

/** 0839 经 Server酱 推一条（只带标题级文字 + 打开今日卡的 glean:// 链接） */
export async function pushWx(msg: PingMsg): Promise<void> {
  const { detectBackend } = await import('./vault');
  const key = await (await detectBackend()).get('push.key');
  const url = key && sctUrl(key);
  if (!url) throw new Error('还没填 Server酱 SendKey');
  const { assertPlug } = await import('./plugs');
  assertPlug('push', url, PUSH_HOSTS);
  const { getFetch } = await import('./ai');
  const f = await getFetch();
  const body = new URLSearchParams({ title: `拾穗 · ${msg.title}`, desp: `${msg.body}\n\n[打开今日一穗](glean://go/daily)` });
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!r.ok) throw new Error(`Server酱 回了 ${r.status}`);
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string };
  if (j.code != null && j.code !== 0) throw new Error(`Server酱：${String(j.message || j.code).slice(0, 60)}`);
}

/** 0550 电脑上全屏 / 演示 / 专注助手（Windows SHQueryUserNotificationState）：这时不弹 */
async function quietNow(): Promise<boolean> {
  if (!isTauriEnv()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return !!(await invoke<boolean>('quiet_now'));
  } catch {
    return false;
  }
}

/** 现在递一次（设置里的「试一条」也走这里）。返回发出去的文字 */
export async function pingNow(cfg = readPing(), test = false): Promise<PingMsg> {
  const items = await liveItems();
  const msg = await messageFor(items, cfg);
  const ab = dailyBridge();
  if (!ab || test) {
    const { notify } = await import('./sysnotify');
    const sent = await notify('daily', msg.title, msg.body, test);
    if (sent && typeof document !== 'undefined' && document.visibilityState === 'hidden') localStorage.setItem(GO_KEY, String(Date.now()));
  }
  if (cfg.wx && !test) await pushWx(msg).catch(() => undefined);
  return msg;
}

/** 安卓：把时间和 7 天的文字交给原生（关掉 = 取消闹钟） */
export async function scheduleNative(cfg = readPing()): Promise<boolean> {
  const b = dailyBridge();
  if (!b) return false;
  const msgs = cfg.on ? await messagesAhead(await liveItems(), cfg) : {};
  try {
    return b.set(JSON.stringify({ on: cfg.on, at: cfg.at, msgs }));
  } catch {
    return false;
  }
}

let timer = 0;
/** App 空闲后调一次：安卓排原生闹钟；电脑 / 网页每分钟看一次到点没有 */
export function startPing(): () => void {
  const tick = async () => {
    const cfg = readPing();
    const now = Date.now();
    const last = localStorage.getItem(LAST_KEY);
    if (dailyBridge()) {
      // 安卓的系统通知由原生发；这里只补微信那一条（App 正好活着的时候）
      if (cfg.wx && pingDue(cfg, localStorage.getItem(WX_LAST_KEY), now)) {
        localStorage.setItem(WX_LAST_KEY, dayKey(now));
        const msg = await messageFor(await liveItems(), cfg);
        await pushWx(msg).catch(() => undefined);
      }
      return;
    }
    if (!pingDue(cfg, last, now)) return;
    if (await quietNow()) return; // 0550 憋着，下一分钟再看（pingDue 的 3 小时窗口兜底）
    localStorage.setItem(LAST_KEY, dayKey(now));
    await pingNow(cfg).catch(() => undefined);
  };
  const onShow = () => {
    if (document.visibilityState !== 'visible') return;
    const t = Number(localStorage.getItem(GO_KEY) || 0);
    if (!t) return;
    localStorage.removeItem(GO_KEY);
    if (Date.now() - t < 2 * 3600000) window.dispatchEvent(new CustomEvent('glean:link', { detail: 'glean://go/daily' }));
  };
  const onCfg = () => void scheduleNative();
  void scheduleNative();
  void tick();
  clearInterval(timer);
  timer = window.setInterval(() => void tick(), 60000);
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('glean:ping', onCfg);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onShow);
    window.removeEventListener('glean:ping', onCfg);
  };
}
