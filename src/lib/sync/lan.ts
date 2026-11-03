// v0.32 局域网直连（ROADMAP「手机电脑同一片麦田」+ 0645 二维码配对）。
//
// 电脑（Windows App）在本机起一个只存密文的小文件柜（src-tauri/src/lancore.rs，0.0.0.0:47322，被占了换随机端口），
// 手机在同一个 Wi-Fi 下把它当成另一个 SyncTransport：v0.31 的改动包 / 全库快照 / 内容寻址原图 / HLC 字段级合并原样复用，
// 只传对方没看过的包（增量），不经过任何服务器。
//
// 安全：
// - 柜子里的文件全是数据钥加密过的（和网盘同步一样，AES-256-GCM，AAD=路径）；
// - 每个请求签名：X-Glean-Lan = 毫秒.随机串.HMAC-SHA256(局域网钥, 方法\n路径?查询\n毫秒\n随机串)，局域网钥 = HMAC(数据钥, "glean-lan-v1")，
//   同一个 Wi-Fi 里的别人截到请求也伪造 / 重放不了；时间用电脑的（先问 /lan/hello 拿电脑时间算差值），两台设备时钟不准也不影响；
// - 配对（0645）：电脑生成 32 字节一次性配对码放进二维码（只经过摄像头，不走网络），把「配对码派生的钥匙加密好的配对包（数据钥 + 电脑名字）」
//   交给 Rust；手机扫码后用配对码签名取一次，取过就作废，10 分钟过期。
import { getFetch } from '../ai';
import { b64, rand, SyncKey, unb64 } from './crypto';
import { TransportError, type RemoteEntry, type SyncTransport } from './transport';

const te = new TextEncoder();
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const ab = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', ab(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, ab(te.encode(msg))));
}
export const toHex = hex;

/** 数据钥 → 局域网请求签名钥 */
export const lanAuthKey = (dataKey: Uint8Array) => hmac(dataKey, 'glean-lan-v1');
/** 配对码 → 取配对包的签名钥 / 配对包的加密钥 */
export async function pairKeys(secret: Uint8Array): Promise<{ auth: Uint8Array; enc: Uint8Array }> {
  return { auth: await hmac(secret, 'glean-lan-pair-auth-v1'), enc: await hmac(secret, 'glean-lan-pair-enc-v1') };
}

const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

// ───────── 二维码内容 ─────────

export interface PairPayload {
  hosts: string[];
  port: number;
  secret: Uint8Array;
  name: string;
}
export function encodePair(p: PairPayload): string {
  return `glean://lan?v=1&h=${p.hosts.join(',')}&p=${p.port}&k=${b64url(p.secret)}&n=${encodeURIComponent(p.name)}`;
}
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
/** 只认局域网 / 本机地址：二维码被换成公网地址也不会把东西往外发 */
export function isLanHost(h: string): boolean {
  if (h === 'localhost') return true;
  if (!IPV4.test(h)) return false;
  const [a, b] = h.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
export function parsePair(text: string): PairPayload {
  const t = text.trim();
  const m = /^glean:\/\/lan\?(.*)$/i.exec(t);
  if (!m) throw new Error('这不是拾穗电脑上显示的配对二维码');
  const q = new Map<string, string>();
  for (const kv of m[1].split('&')) {
    const i = kv.indexOf('=');
    if (i > 0) q.set(kv.slice(0, i), kv.slice(i + 1));
  }
  if (q.get('v') !== '1') throw new Error('配对二维码的版本不认识：两边都更新到最新版');
  const hosts = (q.get('h') || '').split(',').map((s) => s.trim()).filter(isLanHost);
  const port = Number(q.get('p'));
  let secret: Uint8Array;
  try {
    secret = unb64url(q.get('k') || '');
  } catch {
    secret = new Uint8Array();
  }
  if (!hosts.length) throw new Error('二维码里没有局域网地址：电脑连上 Wi-Fi 再显示');
  if (!(port > 0 && port < 65536) || secret.length !== 32) throw new Error('二维码不完整：重新显示一次再扫');
  let name = '电脑';
  try {
    name = decodeURIComponent(q.get('n') || '电脑').slice(0, 40) || '电脑';
  } catch {
    /* 名字坏了不影响 */
  }
  return { hosts, port, secret, name };
}

// ───────── 传输 ─────────

export class LanTransport implements SyncTransport {
  readonly label: string;
  readonly host: string;
  readonly port: number;
  private key: Uint8Array;
  private skew: number;
  private fetchFn: FetchFn;
  requests = 0;
  constructor(host: string, port: number, key: Uint8Array, fetchFn: FetchFn, skew = 0) {
    this.host = host;
    this.port = port;
    this.key = key;
    this.fetchFn = fetchFn;
    this.skew = skew;
    this.label = `${host}:${port}`;
  }

  /** 依次试二维码 / 上次记下的地址，谁先回 /lan/hello 用谁（顺便拿电脑时间） */
  static async connect(hosts: string[], port: number, key: Uint8Array, fetchFn?: FetchFn, timeoutMs = 2500): Promise<LanTransport> {
    const fn = fetchFn || (await getFetch());
    let lastErr = '';
    for (const h of hosts) {
      if (!isLanHost(h)) continue;
      try {
        const t0 = Date.now();
        const r = await withTimeout(fn(`http://${h}:${port}/lan/hello`, { method: 'GET' }), timeoutMs);
        if (!r.ok) {
          lastErr = `${r.status}`;
          continue;
        }
        const j = (await r.json()) as { app?: string; now?: number };
        if (j.app !== 'glean') continue;
        const t1 = Date.now();
        const skew = typeof j.now === 'number' ? j.now - Math.round((t0 + t1) / 2) : 0;
        return new LanTransport(h, port, key, fn, skew);
      } catch (e) {
        lastErr = (e as Error)?.message || '';
      }
    }
    throw new TransportError(`连不上电脑（${hosts.join(' / ')}:${port}${lastErr ? '，' + lastErr : ''}）：在同一个 Wi-Fi 吗？电脑上的拾穗和局域网直连开着吗？`, 0);
  }

  async sign(method: string, url: string): Promise<string> {
    const ts = Date.now() + this.skew;
    const nonce = hex(rand(12));
    return `${ts}.${nonce}.${hex(await hmac(this.key, `${method}\n${url}\n${ts}\n${nonce}`))}`;
  }

  private async req(method: string, url: string, init: { body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Response> {
    this.requests++;
    let r: Response;
    try {
      r = await this.fetchFn(`http://${this.host}:${this.port}${url}`, {
        method,
        headers: { 'X-Glean-Lan': await this.sign(method, url), ...(init.headers || {}) },
        body: init.body ? ab(init.body) : undefined,
      });
    } catch (e) {
      throw new TransportError(`连不上电脑 ${this.label}（${(e as Error)?.message || '网络错误'}）`, 0);
    }
    if (r.status === 401) {
      const why = await r.text().catch(() => '');
      throw new TransportError(/skew/.test(why) ? '两台设备时间差太多：都设成自动对时' : '电脑不认这台设备：重新显示二维码再扫一次', 401);
    }
    if (r.status === 503) throw new TransportError('电脑上的局域网直连没开', 503);
    if (r.status === 413) throw new TransportError('文件太大，电脑拒收（单个上限 96MB）', 413);
    return r;
  }

  async list(dir: string): Promise<RemoteEntry[]> {
    const d = dir.replace(/^\/|\/$/g, '');
    const r = await this.req('GET', `/lan/v1/list?dir=${d}`);
    if (r.status === 404) return [];
    if (!r.ok) throw new TransportError(`列目录失败（${r.status}）`, r.status);
    return ((await r.json()) as RemoteEntry[]).map((e) => ({ path: e.path, size: e.size, etag: e.etag, dir: !!e.dir }));
  }
  async get(path: string): Promise<Uint8Array | null> {
    const r = await this.req('GET', `/lan/v1/f/${path}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new TransportError(`下载失败（${r.status}）`, r.status);
    return new Uint8Array(await r.arrayBuffer());
  }
  async put(path: string, data: Uint8Array, opts: { ifNone?: boolean } = {}): Promise<boolean> {
    const r = await this.req('PUT', `/lan/v1/f/${path}`, { body: data, headers: { 'Content-Type': 'application/octet-stream', ...(opts.ifNone ? { 'If-None-Match': '*' } : {}) } });
    if (r.status === 412) return false;
    if (!r.ok) throw new TransportError(`上传失败（${r.status}）`, r.status);
    return true;
  }
  async delete(path: string): Promise<void> {
    const r = await this.req('DELETE', `/lan/v1/f/${path}`);
    if (!r.ok && r.status !== 404) throw new TransportError(`删除失败（${r.status}）`, r.status);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error('超时')), ms);
    p.then(
      (v) => (clearTimeout(t), res(v)),
      (e) => (clearTimeout(t), rej(e)),
    );
  });
}

// ───────── 配对包 ─────────

export interface PairBundle {
  v: 1;
  /** 数据钥（base64） */
  key: string;
  /** 电脑的名字 / 设备 id / 地址（手机下次连不上时还能试） */
  name: string;
  dev: string;
}
export async function sealBundle(secret: Uint8Array, b: PairBundle): Promise<Uint8Array> {
  const { enc } = await pairKeys(secret);
  return new SyncKey(enc).sealJson(b, 'glean-lan-pair');
}
export async function openBundle(secret: Uint8Array, box: Uint8Array): Promise<PairBundle> {
  const { enc } = await pairKeys(secret);
  try {
    return await new SyncKey(enc).openJson<PairBundle>(box, 'glean-lan-pair');
  } catch {
    throw new Error('配对包解不开：重新显示二维码再扫');
  }
}

/** 手机：扫到二维码后取配对包（一次性） */
export async function redeem(p: PairPayload, fetchFn?: FetchFn): Promise<{ bundle: PairBundle; host: string; skew: number }> {
  const { auth } = await pairKeys(p.secret);
  const tr = await LanTransport.connect(p.hosts, p.port, auth, fetchFn);
  const fn = fetchFn || (await getFetch());
  const url = '/lan/v1/pair';
  let r: Response;
  try {
    r = await fn(`http://${tr.host}:${p.port}${url}`, { method: 'GET', headers: { 'X-Glean-Lan': await tr.sign('GET', url) } });
  } catch (e) {
    throw new TransportError(`连不上电脑（${(e as Error)?.message || '网络错误'}）`, 0);
  }
  if (r.status === 404 || r.status === 410) throw new Error('这个二维码用过或过期了：在电脑上重新显示');
  if (!r.ok) throw new Error(`配对失败（${r.status}）：在电脑上重新显示二维码`);
  const bundle = await openBundle(p.secret, new Uint8Array(await r.arrayBuffer()));
  return { bundle, host: tr.host, skew: 0 };
}

export function newPairSecret(): Uint8Array {
  return rand(32);
}

// ───────── 电脑这边的柜子（Tauri 命令；e2e 用 window.__gleanLanHost 模拟） ─────────

export interface LanHost {
  start(keyHex: string, port?: number): Promise<{ port: number; addrs: string[] }>;
  stop(): Promise<void>;
  offer(authHex: string, bundle: Uint8Array, ttlSecs: number): Promise<void>;
  onChanged(cb: (path: string) => void): Promise<() => void>;
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

export async function getHost(): Promise<LanHost | null> {
  const w = typeof window !== 'undefined' ? (window as unknown as { __gleanLanHost?: LanHost; __TAURI_INTERNALS__?: unknown }) : null;
  if (!w) return null;
  if (w.__gleanLanHost) return w.__gleanLanHost;
  if (!('__TAURI_INTERNALS__' in w) || isAndroid()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  return {
    start: (keyHex, port) => invoke('lan_start', { keyHex, port: port ?? null }),
    stop: () => invoke('lan_stop'),
    offer: (authHex, bundle, ttlSecs) => invoke('lan_offer', { authHex, bundle: [...bundle], ttlSecs }),
    onChanged: async (cb) => listen<string>('glean:lan-changed', (e) => cb(String(e.payload || ''))),
  };
}

export { b64url, unb64url };
