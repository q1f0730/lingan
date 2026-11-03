// v0.31 同步对界面的门面：配置（localStorage，不含任何密码 / 密钥）、钥匙串里的应用密码与数据钥、建立 / 加入 / 同步 / 回到同步前 / 断开。
// 整个 sync/ 目录只在设置页的同步面板和「已开同步」时的后台定时里懒加载，首屏不带。
import { db } from '../db';
import { detectBackend, type VaultBackend } from '../vault';
import { b64, makeHeader, newRecoveryCode, openHeader, rewrapPass, SyncKey, unb64, type SyncHeader } from './crypto';
import { emptyStats, freshState, syncOnce, undoLastSync, type SyncState, type SyncStats } from './engine';
import { DAV_PRESETS, WebDavTransport, type SyncTransport } from './transport';

export const SYNC_KEY = 'glean.sync.v1';
const PURGED_KEY = 'glean.sync.purged';
const HEADER = 'glean-sync.json';

export interface SyncConfig {
  provider: (typeof DAV_PRESETS)[number]['id'];
  url: string;
  user: string;
  folder: string;
  /** 恢复码还没抄好确认：不让同步 */
  confirm?: string;
  auto: boolean;
  state: SyncState;
  lastAt?: number;
  last?: { ok: boolean; msg: string; stats?: SyncStats; at: number };
  createdAt: number;
}

export function loadConfig(): SyncConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
    return v && v.url && v.state ? v : null;
  } catch {
    return null;
  }
}
export function saveConfig(c: SyncConfig | null) {
  try {
    if (c) localStorage.setItem(SYNC_KEY, JSON.stringify(c));
    else localStorage.removeItem(SYNC_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('glean:sync'));
}

let vault: VaultBackend | null = null;
async function v(): Promise<VaultBackend> {
  return (vault ||= await detectBackend());
}
/** 测试 / e2e 可换 */
export function setSyncVault(b: VaultBackend | null) {
  vault = b;
}

/** 测试可注入（e2e 走真的 WebDAV 请求，被页面路由拦下） */
let makeTransport = (c: Pick<SyncConfig, 'url' | 'user' | 'folder'>, pass: string): SyncTransport => new WebDavTransport({ url: c.url, user: c.user, pass, folder: c.folder });
export function setTransportFactory(f: typeof makeTransport) {
  makeTransport = f;
}

async function readHeader(tr: SyncTransport): Promise<SyncHeader | null> {
  const b = await tr.get(HEADER);
  if (!b) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b)) as SyncHeader;
  } catch {
    throw new Error('云端的 glean-sync.json 读不出');
  }
}

export interface Account {
  provider: SyncConfig['provider'];
  url: string;
  user: string;
  pass: string;
  folder?: string;
}

/** 云端这个文件夹里有没有拾穗的同步数据（决定是「新建」还是「加入」） */
export async function probe(a: Account): Promise<'new' | 'join'> {
  const tr = makeTransport({ url: a.url, user: a.user, folder: a.folder ?? 'Glean' }, a.pass);
  return (await readHeader(tr)) ? 'join' : 'new';
}

function baseConfig(a: Account): SyncConfig {
  return { provider: a.provider, url: a.url, user: a.user, folder: a.folder ?? 'Glean', auto: true, state: freshState(), createdAt: Date.now() };
}

/** 第一台设备：生成数据钥与恢复码，写 glean-sync.json。返回恢复码（只显示这一次） */
export async function createRemote(a: Account, syncPass: string): Promise<string> {
  if (syncPass.length < 8) throw new Error('同步口令至少 8 位');
  const tr = makeTransport({ url: a.url, user: a.user, folder: a.folder ?? 'Glean' }, a.pass);
  if (await readHeader(tr)) throw new Error('这个文件夹里已经有同步数据了：用口令或恢复码「加入」');
  const key = SyncKey.generate();
  const code = newRecoveryCode();
  const h = await makeHeader(syncPass, key, code);
  if (!(await tr.put(HEADER, new TextEncoder().encode(JSON.stringify(h, null, 1)), { ifNone: true }))) throw new Error('别的设备刚刚建好了同步：请改用「加入」');
  const vb = await v();
  await vb.set('sync.davPass', a.pass);
  await vb.set('sync.key', b64(key.raw));
  saveConfig({ ...baseConfig(a), confirm: code.slice(-4) });
  try {
    localStorage.removeItem(PURGED_KEY);
  } catch {
    /* ignore */
  }
  return code;
}

/** 0618 恢复码强制确认：抄好后输入最后一组 */
export function confirmRecovery(last4: string): boolean {
  const c = loadConfig();
  if (!c?.confirm) return true;
  if (last4.trim().toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1') !== c.confirm) return false;
  delete c.confirm;
  saveConfig(c);
  return true;
}

/** 另一台设备：口令或恢复码解开数据钥 */
export async function joinRemote(a: Account, secret: { pass?: string; code?: string }): Promise<void> {
  const tr = makeTransport({ url: a.url, user: a.user, folder: a.folder ?? 'Glean' }, a.pass);
  const h = await readHeader(tr);
  if (!h) throw new Error('这个文件夹里还没有同步数据：先在一台设备上「新建」');
  const key = await openHeader(h, secret);
  const vb = await v();
  await vb.set('sync.davPass', a.pass);
  await vb.set('sync.key', b64(key.raw));
  saveConfig(baseConfig(a));
}

async function open(c: SyncConfig): Promise<{ tr: SyncTransport; key: SyncKey }> {
  const vb = await v();
  const pass = await vb.get('sync.davPass');
  const k = await vb.get('sync.key');
  if (!k) throw new Error('这台设备的数据钥不在了（钥匙串被清过）：断开后用口令或恢复码重新加入');
  return { tr: makeTransport(c, pass), key: new SyncKey(unb64(k)) };
}

let running: Promise<SyncStats> | null = null;
export function isSyncing() {
  return !!running;
}

export function describe(s: SyncStats): string {
  const parts: string[] = [];
  if (s.pushedRows) parts.push(`推 ${s.pushedRows} 行`);
  if (s.changed) parts.push(`收 ${s.changed} 行`);
  if (s.imagesUp) parts.push(`传图 ${s.imagesUp}`);
  if (s.imagesDown) parts.push(`下图 ${s.imagesDown}`);
  if (s.purged) parts.push(`删 ${s.purged}`);
  return parts.length ? parts.join('，') : '两边一样，没有要传的';
}

/** 同步一次（同时只跑一个） */
export async function runSync(opts: { appVersion?: string; onProgress?: (m: string) => void } = {}): Promise<SyncStats> {
  if (running) return running;
  const c = loadConfig();
  if (!c) throw new Error('还没开同步');
  if (c.confirm) throw new Error('先抄好恢复码并确认');
  running = (async () => {
    const at = Date.now();
    try {
      const { tr, key } = await open(c);
      const { takeSnapshot } = await import('../snapshots');
      const state: SyncState = JSON.parse(JSON.stringify(c.state));
      const stats = await syncOnce({ tr, key, state, d: db, snapshot: (label) => takeSnapshot(label, db, { appVersion: opts.appVersion }).catch(() => null), onProgress: opts.onProgress });
      const cur = loadConfig();
      if (cur) saveConfig({ ...cur, state, lastAt: at, last: { ok: true, msg: describe(stats), stats, at } });
      try {
        // 推出去的墓碑留着没意义了：只留 pushed 之后的
        const list = JSON.parse(localStorage.getItem(PURGED_KEY) || '[]');
        if (Array.isArray(list)) localStorage.setItem(PURGED_KEY, JSON.stringify(list.filter((p: { h: string }) => p.h > state.pushed)));
      } catch {
        /* ignore */
      }
      return stats;
    } catch (e) {
      const cur = loadConfig();
      if (cur) saveConfig({ ...cur, last: { ok: false, msg: (e as Error)?.message || String(e), at } });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** 0615 回到同步前 */
export async function undoSync(appVersion?: string): Promise<{ restamped: number; trashed: number }> {
  const c = loadConfig();
  if (!c) throw new Error('还没开同步');
  const { restoreSnapshot } = await import('../snapshots');
  const { tr, key } = await open(c);
  const state: SyncState = JSON.parse(JSON.stringify(c.state));
  const r = await undoLastSync({ tr, key, state, d: db }, async (id) => void (await restoreSnapshot(id, db, { appVersion })));
  const cur = loadConfig();
  if (cur) saveConfig({ ...cur, state, last: { ok: true, msg: `已回到同步前（${r.restamped} 行改回，${r.trashed} 行进回收站），下次同步会让别的设备也跟着回去`, at: Date.now(), stats: emptyStats() } });
  return r;
}

/** 换同步口令：只重包数据钥 */
export async function changeSyncPass(newPass: string): Promise<void> {
  if (newPass.length < 8) throw new Error('同步口令至少 8 位');
  const c = loadConfig();
  if (!c) throw new Error('还没开同步');
  const { tr, key } = await open(c);
  const h = await readHeader(tr);
  if (!h) throw new Error('云端的同步数据不在了');
  await tr.put(HEADER, new TextEncoder().encode(JSON.stringify(await rewrapPass(h, key, newPass), null, 1)));
}

/** 断开：本机忘掉账号与数据钥（云端数据不动） */
export async function disconnect(): Promise<void> {
  const vb = await v();
  await vb.del('sync.davPass').catch(() => undefined);
  await vb.del('sync.key').catch(() => undefined);
  saveConfig(null);
  try {
    localStorage.removeItem(PURGED_KEY);
  } catch {
    /* ignore */
  }
}

export function setAuto(on: boolean) {
  const c = loadConfig();
  if (c) saveConfig({ ...c, auto: on });
}

// ───────── 自动同步：开着同步时，启动后、回到前台时、开着的时候每 10 分钟 ─────────
let timer: ReturnType<typeof setInterval> | null = null;
export function startAutoSync(appVersion?: string) {
  if (timer) return;
  const go = () => {
    const c = loadConfig();
    if (!c?.auto || c.confirm || document.visibilityState === 'hidden') return;
    if (c.lastAt && Date.now() - c.lastAt < 2 * 60_000) return;
    void runSync({ appVersion }).catch(() => undefined);
  };
  go();
  timer = setInterval(go, 10 * 60_000);
  document.addEventListener('visibilitychange', go);
}
