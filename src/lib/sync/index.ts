// v0.31 同步对界面的门面：配置（localStorage，不含任何密码 / 密钥）、钥匙串里的应用密码与数据钥、建立 / 加入 / 同步 / 回到同步前 / 断开。
// 整个 sync/ 目录只在设置页的同步面板和「已开同步」时的后台定时里懒加载，首屏不带。
import { db } from '../db';
import { detectBackend, type VaultBackend } from '../vault';
import { b64, makeHeader, newRecoveryCode, openHeader, rewrapPass, SyncKey, unb64, type SyncHeader } from './crypto';
import { emptyStats, freshState, readDevs, retire, syncOnce, undoLastSync, type DevInfo, type SyncCtx, type SyncState, type SyncStats } from './engine';
import { DAV_PRESETS, TransportError, WebDavTransport, type SyncTransport } from './transport';
import { getDeviceId } from '../device';
import type { SyncTable } from '../db';

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
  /** v0.32 0564 最近 20 次同步的结果 */
  log?: LogEntry[];
  createdAt: number;
}

/** v0.32 0564 / 0660 一次同步的结果（设置里的无线表格） */
export interface LogEntry {
  at: number;
  ok: boolean;
  via: string;
  msg: string;
  push: number;
  pull: number;
  conflicts: number;
  ms: number;
}
export const LOG_MAX = 20;
export function pushLog(list: LogEntry[] | undefined, e: LogEntry): LogEntry[] {
  return [e, ...(list || [])].slice(0, LOG_MAX);
}

/** 这台设备在别的设备的列表里叫什么 */
export function deviceInfo(app?: string): { name: string; plat: string; app?: string } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const plat = /Android/i.test(ua) ? '安卓' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '其它';
  const kind = /Android/i.test(ua) ? '手机' : tauri ? '电脑' : '浏览器';
  return { name: `${plat === '安卓' ? '安卓' : plat === '其它' ? '' : plat + ' '}${kind} ${getDeviceId().slice(-4)}`, plat: tauri || /Android/i.test(ua) ? plat : `${plat} 浏览器`, app };
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


export function describe(s: SyncStats): string {
  const parts: string[] = [];
  if (s.pushedRows) parts.push(`推 ${s.pushedRows} 行`);
  if (s.changed) parts.push(`收 ${s.changed} 行`);
  if (s.imagesUp) parts.push(`传图 ${s.imagesUp}`);
  if (s.imagesDown) parts.push(`下图 ${s.imagesDown}`);
  if (s.purged) parts.push(`删 ${s.purged}`);
  if (s.conflicts) parts.push(`冲突 ${s.conflicts}（各取较新的一边）`);
  if (s.compacted) parts.push(`清掉旧包 ${s.compacted}`);
  return parts.length ? parts.join('，') : '两边一样，没有要传的';
}

/** 同步一次（同时只跑一个） */
export function runSync(opts: RunOpts = {}): Promise<SyncStats> {
  return runIn('dav', opts);
}
type RunOpts = { appVersion?: string; onProgress?: (m: string) => void; compactNow?: boolean };
const running: Partial<Record<Space, Promise<SyncStats>>> = {};
export function isSyncing() {
  return !!(running.dav || running.lan);
}

/** v0.32 两种同步共用一条路：开传输 → 推 / 拉 / 快照 / 清旧包 / 回执 → 记日志、转发给另一边 */
function runIn(space: Space, opts: RunOpts): Promise<SyncStats> {
  if (running[space]) return running[space]!;
  const load = () => (space === 'dav' ? loadConfig() : loadLan()) as (SyncConfig | LanConfig) | null;
  const save = (c: SyncConfig | LanConfig) => (space === 'dav' ? saveConfig(c as SyncConfig) : saveLan(c as LanConfig));
  const c = load();
  if (!c) throw new Error(space === 'dav' ? '还没开同步' : '还没开局域网直连');
  if ((c as SyncConfig).confirm) throw new Error('先抄好恢复码并确认');
  const via = space === 'dav' ? viaDav(c as SyncConfig) : (c as LanConfig).role === 'host' ? '局域网（本机）' : `局域网 · ${(c as LanConfig).name}`;
  const p = (async () => {
    const at = Date.now();
    try {
      const { tr, key } = space === 'dav' ? await open(c as SyncConfig) : await openLan(c as LanConfig);
      const { takeSnapshot } = await import('../snapshots');
      const state: SyncState = JSON.parse(JSON.stringify(c.state));
      const q = readRelay(space);
      state.relay = q;
      const stats = await syncOnce({ tr, key, state, d: db, info: deviceInfo(opts.appVersion), snapshot: (label) => takeSnapshot(label, db, { appVersion: opts.appVersion }).catch(() => null), onProgress: opts.onProgress }, { compactNow: opts.compactNow });
      takeRelay(space, q.length);
      if (stats.changed) queueRelay(space === 'dav' ? 'lan' : 'dav', state.touched || []);
      const cur = load();
      if (cur) {
        const extra: Partial<LanConfig> = {};
        // 局域网：连上的那个地址排到最前，下次先试它
        const host = (tr as { host?: string }).host;
        if (space === 'lan' && (cur as LanConfig).role === 'peer' && host) extra.hosts = [host, ...(cur as LanConfig).hosts.filter((h) => h !== host)];
        save({ ...cur, ...extra, state, lastAt: at, last: { ok: true, msg: describe(stats), stats, at }, log: pushLog(cur.log, logOf(via, true, describe(stats), stats, at)) });
      }
      if (space === 'dav')
        try {
          // 推出去的墓碑留着没意义了：只留 pushed 之后的
          const list = JSON.parse(localStorage.getItem(PURGED_KEY) || '[]');
          if (Array.isArray(list)) localStorage.setItem(PURGED_KEY, JSON.stringify(list.filter((x: { h: string }) => x.h > state.pushed)));
        } catch {
          /* ignore */
        }
      return stats;
    } catch (e) {
      const cur = load();
      const msg = (e as Error)?.message || String(e);
      if (cur) save({ ...cur, last: { ok: false, msg, at }, log: pushLog(cur.log, logOf(via, false, msg, null, at)) });
      throw e;
    } finally {
      delete running[space];
    }
  })();
  running[space] = p;
  return p;
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

// ───────── v0.32 共用：日志、转发队列、设备与旧包 ─────────

const viaDav = (c: SyncConfig) => (c.provider === 'jianguoyun' ? '坚果云' : 'WebDAV');
function logOf(via: string, ok: boolean, msg: string, s: SyncStats | null, at: number): LogEntry {
  return { at, ok, via, msg, push: s?.pushedRows || 0, pull: s?.changed || 0, conflicts: s?.conflicts || 0, ms: Date.now() - at };
}

/** 网盘那边拉进来的行要转给局域网那边（反过来也是）：各自一个只追加的队列，推出去之后从头上切掉 */
type Space = 'dav' | 'lan';
const RELAY = (s: Space) => `glean.sync.relay.${s}`;
export function readRelay(s: Space): Array<{ t: SyncTable; u: string }> {
  try {
    const v = JSON.parse(localStorage.getItem(RELAY(s)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function takeRelay(s: Space, n: number) {
  if (!n) return;
  try {
    localStorage.setItem(RELAY(s), JSON.stringify(readRelay(s).slice(n)));
  } catch {
    /* ignore */
  }
}
export function queueRelay(s: Space, rows: Array<{ t: SyncTable; u: string }>) {
  const on = s === 'dav' ? !!loadConfig() : !!loadLan();
  if (!on || !rows.length) return;
  try {
    localStorage.setItem(RELAY(s), JSON.stringify([...readRelay(s), ...rows].slice(-20000)));
  } catch {
    /* ignore */
  }
}

export interface SpaceStatus {
  devices: Array<DevInfo & { me: boolean }>;
  /** 云上 / 电脑柜子里一共几个改动包、其中我的几个 */
  packs: number;
  mine: number;
}

async function ctxFor(space: Space): Promise<{ ctx: SyncCtx; save: (st: SyncState) => void }> {
  if (space === 'dav') {
    const c = loadConfig();
    if (!c) throw new Error('还没开网盘同步');
    const { tr, key } = await open(c);
    const state: SyncState = JSON.parse(JSON.stringify(c.state));
    return { ctx: { tr, key, state, d: db }, save: (st) => (loadConfig() ? saveConfig({ ...loadConfig()!, state: st }) : undefined) };
  }
  const c = loadLan();
  if (!c) throw new Error('还没开局域网直连');
  const { tr, key } = await openLan(c);
  const state: SyncState = JSON.parse(JSON.stringify(c.state));
  return { ctx: { tr, key, state, d: db }, save: (st) => (loadLan() ? saveLan({ ...loadLan()!, state: st }) : undefined) };
}

/** 0670 各设备 + 云上包数（设置里点开时查一次） */
export async function spaceStatus(space: Space): Promise<SpaceStatus> {
  const { ctx, save } = await ctxFor(space);
  const me = getDeviceId();
  const { devs, gone } = await readDevs(ctx);
  let packs = 0;
  let mine = 0;
  for (const e of await ctx.tr.list('ops')) {
    if (!e.dir) continue;
    const id = e.path.split('/').pop()!;
    const n = (await ctx.tr.list(`ops/${id}`)).filter((f) => f.path.endsWith('.op')).length;
    packs += n;
    if (id === me) mine = n;
  }
  save(ctx.state);
  const list = [...devs.values()].filter((x) => !gone.has(x.dev)).map((x) => ({ ...x, me: x.dev === me }));
  list.sort((a, b) => (a.me ? -1 : b.me ? 1 : b.at - a.at));
  return { devices: list, packs, mine };
}

/** 旧包压缩清理（手动）：先写一份全库快照，再删所有设备都确认过的自己的包 */
export async function compactNow(space: Space, appVersion?: string): Promise<number> {
  const st = space === 'dav' ? await runSync({ appVersion, compactNow: true }) : await runLanSync({ appVersion, compactNow: true });
  return st.compacted;
}

export async function retireDevice(space: Space, dev: string): Promise<void> {
  const { ctx, save } = await ctxFor(space);
  await retire(ctx, dev);
  save(ctx.state);
}


// ───────── v0.32 局域网直连 ─────────

export const LAN_KEY = 'glean.lan.v1';
export interface LanConfig {
  /** host = 这台是电脑（开柜子、显示二维码）；peer = 这台扫码连电脑 */
  role: 'host' | 'peer';
  /** host：自己的名字；peer：电脑的名字 */
  name: string;
  hosts: string[];
  port: number;
  peerDev?: string;
  auto: boolean;
  state: SyncState;
  lastAt?: number;
  last?: { ok: boolean; msg: string; stats?: SyncStats; at: number };
  log?: LogEntry[];
  createdAt: number;
}
export function loadLan(): LanConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAN_KEY) || 'null');
    return v && v.role && v.state ? v : null;
  } catch {
    return null;
  }
}
export function saveLan(c: LanConfig | null) {
  try {
    if (c) localStorage.setItem(LAN_KEY, JSON.stringify(c));
    else localStorage.removeItem(LAN_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('glean:sync'));
}

async function lanKey(): Promise<Uint8Array> {
  const k = await (await v()).get('sync.lanKey');
  if (!k) throw new Error('局域网数据钥不在了：断开后重新配对');
  return unb64(k);
}

async function openLan(c: LanConfig): Promise<{ tr: SyncTransport; key: SyncKey }> {
  const { LanTransport, lanAuthKey } = await import('./lan');
  const raw = await lanKey();
  const hosts = c.role === 'host' ? ['127.0.0.1'] : c.hosts;
  return { tr: await LanTransport.connect(hosts, c.port, await lanAuthKey(raw)), key: new SyncKey(raw) };
}

export function runLanSync(opts: RunOpts = {}): Promise<SyncStats> {
  return runIn('lan', opts);
}

let hostOff: (() => void) | null = null;
let hostTimer: ReturnType<typeof setInterval> | null = null;
let hostDebounce: ReturnType<typeof setTimeout> | null = null;

/** 电脑：开柜子（没开过就先生成局域网数据钥） */
export async function lanHostStart(appVersion?: string): Promise<{ port: number; addrs: string[] }> {
  const { getHost, lanAuthKey, toHex } = await import('./lan');
  const host = await getHost();
  if (!host) throw new Error('局域网直连的电脑端要用 Windows 版拾穗：手机这边点「扫码连接电脑」');
  let c = loadLan();
  const vb = await v();
  if (!c || c.role !== 'host') {
    const k = SyncKey.generate();
    await vb.set('sync.lanKey', b64(k.raw));
    c = { role: 'host', name: deviceInfo().name, hosts: [], port: 47322, auto: true, state: freshState(), createdAt: Date.now() };
    saveLan(c);
  }
  const info = await host.start(toHex(await lanAuthKey(await lanKey())), c.port);
  saveLan({ ...loadLan()!, port: info.port, hosts: info.addrs });
  if (!hostOff) {
    const me = getDeviceId();
    hostOff = await host.onChanged((path) => {
      if (path === 'pair') window.dispatchEvent(new Event('glean:lan-paired'));
      // 自己写的（本机同步经柜子）和原图不触发；手机推包 / 写回执 → 合并一次
      if (path.includes(me) || path.startsWith('img/')) return;
      if (hostDebounce) clearTimeout(hostDebounce);
      hostDebounce = setTimeout(() => void runLanSync({ appVersion }).catch(() => undefined), 700);
    });
    // 本机的修改定时放进柜子，手机来的时候就能直接拿到
    hostTimer = setInterval(() => void runLanSync({ appVersion }).catch(() => undefined), 60_000);
  }
  void runLanSync({ appVersion }).catch(() => undefined);
  return info;
}

/** 电脑：生成一次性配对二维码的内容（10 分钟有效，用一次就作废） */
export async function lanOffer(): Promise<{ text: string; expires: number; hosts: string[]; port: number }> {
  const { encodePair, getHost, newPairSecret, pairKeys, sealBundle, toHex } = await import('./lan');
  const host = await getHost();
  const c = loadLan();
  if (!host || !c || c.role !== 'host') throw new Error('先在这台电脑上打开局域网直连');
  if (!c.hosts.length) throw new Error('这台电脑没连上局域网：连上 Wi-Fi 或网线再试');
  const secret = newPairSecret();
  const bundle = await sealBundle(secret, { v: 1, key: b64(await lanKey()), name: c.name, dev: getDeviceId() });
  await host.offer(toHex((await pairKeys(secret)).auth), bundle, 600);
  return { text: encodePair({ hosts: c.hosts, port: c.port, secret, name: c.name }), expires: Date.now() + 600_000, hosts: c.hosts, port: c.port };
}

/** 手机：扫到二维码后配对并马上同步一次 */
export async function lanPair(text: string, appVersion?: string): Promise<SyncStats> {
  const { parsePair, redeem } = await import('./lan');
  const p = parsePair(text);
  const { bundle, host } = await redeem(p);
  const old = loadLan();
  const sameSpace = old && old.role === 'peer' && old.peerDev === bundle.dev && (await v().then((x) => x.get('sync.lanKey'))) === bundle.key;
  await (await v()).set('sync.lanKey', bundle.key);
  saveLan({
    role: 'peer',
    name: bundle.name,
    hosts: [host, ...p.hosts.filter((h) => h !== host)],
    port: p.port,
    peerDev: bundle.dev,
    auto: true,
    state: sameSpace && old ? old.state : freshState(),
    log: old?.log,
    createdAt: Date.now(),
  });
  return runLanSync({ appVersion });
}

export function setLanAuto(on: boolean) {
  const c = loadLan();
  if (c) saveLan({ ...c, auto: on });
}

/** 断开局域网直连：电脑关柜子；两边都忘掉局域网数据钥 */
export async function lanDisconnect(): Promise<void> {
  const c = loadLan();
  if (c?.role === 'host') {
    const { getHost } = await import('./lan');
    await (await getHost())?.stop().catch(() => undefined);
  }
  hostOff?.();
  hostOff = null;
  if (hostTimer) clearInterval(hostTimer);
  hostTimer = null;
  await (await v()).del('sync.lanKey').catch(() => undefined);
  try {
    localStorage.removeItem(RELAY('lan'));
  } catch {
    /* ignore */
  }
  saveLan(null);
}

let lanTimer: ReturnType<typeof setInterval> | null = null;
/** 自动：电脑开着就开柜子；手机打开时、回到前台时、开着的时候每 10 分钟和电脑同步一次（连不上就安静地记一条失败） */
export function startLanAuto(appVersion?: string) {
  const c = loadLan();
  if (!c) return;
  if (c.role === 'host') {
    void lanHostStart(appVersion).catch(() => undefined);
    return;
  }
  if (lanTimer) return;
  const go = () => {
    const cur = loadLan();
    if (!cur?.auto || cur.role !== 'peer' || document.visibilityState === 'hidden') return;
    if (cur.lastAt && Date.now() - cur.lastAt < 60_000) return;
    void runLanSync({ appVersion }).catch(() => undefined);
  };
  go();
  lanTimer = setInterval(go, 10 * 60_000);
  document.addEventListener('visibilitychange', go);
}

export { TransportError };
