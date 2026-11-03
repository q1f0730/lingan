// v0.31 0612 同步层只认一个接口 SyncTransport（列目录 / 取 / 放 / 删，带 etag），换后端不动同步逻辑：
// 这一版有 WebDAV（0614，预设坚果云）和内存（测试 / e2e）；之后的局域网直连、文件夹同步也只是再实现一次这个接口。
import { getFetch } from '../ai';

export interface RemoteEntry {
  /** 相对同步根目录的路径，如 ops/<设备>/00000001.op */
  path: string;
  size: number;
  etag?: string;
  dir?: boolean;
}
export interface SyncTransport {
  readonly label: string;
  /** 列出一个目录（不递归）；目录不存在返回 [] */
  list(dir: string): Promise<RemoteEntry[]>;
  /** 不存在返回 null */
  get(path: string): Promise<Uint8Array | null>;
  /** ifNone：已存在就不写（返回 false）——只追加的文件不会被覆盖 */
  put(path: string, data: Uint8Array, opts?: { ifNone?: boolean }): Promise<boolean>;
  delete(path: string): Promise<void>;
}

export class TransportError extends Error {
  status: number;
  constructor(msg: string, status = 0) {
    super(msg);
    this.status = status;
  }
}

// ───────── 内存（测试） ─────────

export class MemoryTransport implements SyncTransport {
  readonly label = '内存';
  files = new Map<string, Uint8Array>();
  puts = 0;
  gets = 0;
  async list(dir: string): Promise<RemoteEntry[]> {
    const pre = dir.replace(/\/?$/, '/').replace(/^\//, '');
    const out = new Map<string, RemoteEntry>();
    for (const [p, b] of this.files) {
      if (!p.startsWith(pre)) continue;
      const rest = p.slice(pre.length);
      const i = rest.indexOf('/');
      if (i < 0) out.set(p, { path: p, size: b.length, etag: String(b.length) });
      else out.set(pre + rest.slice(0, i), { path: pre + rest.slice(0, i), size: 0, dir: true });
    }
    return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  }
  async get(path: string) {
    this.gets++;
    const b = this.files.get(path);
    return b ? b.slice() : null;
  }
  async put(path: string, data: Uint8Array, opts: { ifNone?: boolean } = {}) {
    if (opts.ifNone && this.files.has(path)) return false;
    this.puts++;
    this.files.set(path, data.slice());
    return true;
  }
  async delete(path: string) {
    this.files.delete(path);
  }
}

// ───────── WebDAV ─────────

export interface DavConfig {
  /** 服务地址，如 https://dav.jianguoyun.com/dav/ */
  url: string;
  user: string;
  pass: string;
  /** 服务里的文件夹（默认 Glean） */
  folder?: string;
}
export const DAV_PRESETS = [
  { id: 'jianguoyun', label: '坚果云', url: 'https://dav.jianguoyun.com/dav/', hint: '账号是坚果云登录邮箱；密码在 坚果云网页 → 账户信息 → 安全选项 → 第三方应用管理 里「添加应用」生成（不是登录密码）' },
  { id: 'custom', label: '自定义 WebDAV', url: '', hint: 'Nextcloud / 群晖 / Alist 等，填完整的 WebDAV 地址' },
] as const;

/** PROPFIND 的 multistatus：不依赖 DOMParser（测试环境没有），按标签名取，命名空间前缀随意 */
export function parseMultistatus(xml: string): Array<{ href: string; size: number; etag?: string; dir: boolean }> {
  const out: Array<{ href: string; size: number; etag?: string; dir: boolean }> = [];
  const tag = (name: string, s: string) => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i').exec(s)?.[1];
  const re = /<(?:[\w-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const href = tag('href', block)?.trim();
    if (!href) continue;
    const rt = tag('resourcetype', block) || '';
    const dir = /<(?:[\w-]+:)?collection\b/i.test(rt);
    out.push({ href: decodeEntities(href), size: Number(tag('getcontentlength', block) || 0) || 0, etag: tag('getetag', block)?.trim().replace(/&quot;/g, '"'), dir });
  }
  return out;
}
function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class WebDavTransport implements SyncTransport {
  readonly label: string;
  private base: string;
  private auth: string;
  private made = new Set<string>();
  private fetchFn: FetchFn | null;
  constructor(cfg: DavConfig, fetchFn?: FetchFn) {
    const root = cfg.url.replace(/\/+$/, '') + '/';
    const folder = (cfg.folder ?? 'Glean').replace(/^\/+|\/+$/g, '');
    this.base = folder ? root + folder.split('/').map(encodeURIComponent).join('/') + '/' : root;
    this.auth = 'Basic ' + btoa(unescape(encodeURIComponent(`${cfg.user}:${cfg.pass}`)));
    this.label = new URL(root).host;
    this.fetchFn = fetchFn || null;
  }
  private async f(path: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Response> {
    const fn = this.fetchFn || (this.fetchFn = await getFetch());
    let r: Response;
    try {
      r = await fn(this.base + path.split('/').map(encodeURIComponent).join('/'), { ...init, headers: { Authorization: this.auth, ...(init.headers || {}) } });
    } catch (e) {
      throw new TransportError(`连不上同步服务（${(e as Error)?.message || '网络错误'}）`, 0);
    }
    if (r.status === 401 || r.status === 403) throw new TransportError('同步服务拒绝了账号或应用密码', r.status);
    if (r.status === 507) throw new TransportError('同步空间满了', r.status);
    return r;
  }
  private async mkcol(dir: string) {
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const p of ['', ...parts]) {
      cur = p ? (cur ? cur + '/' + p : p) : '';
      const key = cur || '/';
      if (this.made.has(key)) continue;
      const r = await this.f(cur ? cur + '/' : '', { method: 'MKCOL' });
      // 201 建好；405 / 301 已经有了
      if (!(r.ok || r.status === 405 || r.status === 301 || r.status === 302)) throw new TransportError(`建文件夹失败（${r.status}）`, r.status);
      this.made.add(key);
    }
  }
  async list(dir: string): Promise<RemoteEntry[]> {
    const d = dir.replace(/^\/|\/$/g, '');
    const r = await this.f(d ? d + '/' : '', { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/></d:prop></d:propfind>' });
    if (r.status === 404) return [];
    if (r.status !== 207 && !r.ok) throw new TransportError(`列目录失败（${r.status}）`, r.status);
    const basePath = decodeURIComponent(new URL(this.base).pathname);
    const self = (basePath + (d ? d + '/' : '')).replace(/\/+$/, '');
    const out: RemoteEntry[] = [];
    for (const e of parseMultistatus(await r.text())) {
      let p = e.href;
      try {
        p = decodeURIComponent(/^https?:/i.test(p) ? new URL(p).pathname : p);
      } catch {
        /* 保留原样 */
      }
      const clean = p.replace(/\/+$/, '');
      if (clean === self || !clean.startsWith(basePath.replace(/\/+$/, '') + '/')) continue;
      out.push({ path: clean.slice(basePath.replace(/\/+$/, '').length + 1), size: e.size, etag: e.etag, dir: e.dir || /\/$/.test(e.href) });
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }
  async get(path: string): Promise<Uint8Array | null> {
    const r = await this.f(path, { method: 'GET' });
    if (r.status === 404) return null;
    if (!r.ok) throw new TransportError(`下载失败（${r.status}）`, r.status);
    return new Uint8Array(await r.arrayBuffer());
  }
  async put(path: string, data: Uint8Array, opts: { ifNone?: boolean } = {}): Promise<boolean> {
    const dir = path.split('/').slice(0, -1).join('/');
    await this.mkcol(dir);
    const r = await this.f(path, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(opts.ifNone ? { 'If-None-Match': '*' } : {}) }, body: data.slice().buffer as ArrayBuffer });
    if (r.status === 412) return false;
    if (!r.ok) throw new TransportError(`上传失败（${r.status}）`, r.status);
    return true;
  }
  async delete(path: string): Promise<void> {
    const r = await this.f(path, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new TransportError(`删除失败（${r.status}）`, r.status);
  }
}
