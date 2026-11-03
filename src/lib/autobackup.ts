// v0.26 数据保险：自动本地备份（0606 0508 0609）+ 备份写完回读校验（0637）+ 更新前自动备份（0513 0750）。
//
// - 每天第一次打开后（启动 20 秒、空闲时）写一份完整 .glean（和手动导出同一种格式，含原图）；库和上次备份时一样就跳过。
// - 位置：Windows 默认「文档\Glean\backup」，可改成任意文件夹（坚果云 / OneDrive 同步目录）；
//   安卓写进「下载/Glean」（MediaStore，卸载 App 也还在；Android 9 退回 App 专属目录）。网页版没有本机文件夹，不做。
// - 轮转：GFS（最近 7 天每天一份、4 周每周一份、12 个月每月一份），或者只留最近 7 份。更新前的备份另算，留最近 3 份。
// - 写完立刻按 manifest 回读：每个文件的大小与 sha256、data.jsonl 行数，标「已验证 / 损坏」。
import { db as defaultDb, type LinganDB } from './db';
import { exportGlean, type ExportStats } from './backup';
import { sha256Hex } from './sha256';
import { readZipBlob, zipEntryBlob, type ByteSink } from './zipstream';
import { bytesToBase64 } from './files';
import { isTauriEnv } from './desktop';

export type BackupKind = 'auto' | 'pre-update' | 'manual';
export interface BackupFile {
  name: string;
  bytes: number;
  at: number;
  kind: BackupKind;
}
export type Retention = 'gfs' | 'last7';
export const RETENTION_LABEL: Record<Retention, string> = { gfs: '7 天 · 4 周 · 12 月', last7: '最近 7 份' };
export const PRE_UPDATE_KEEP = 3;

/** 能随机读的「文件」：readZipBlob / readGlean 只用到 size / slice / arrayBuffer / text */
export interface BlobLike {
  readonly size: number;
  readonly type: string;
  slice(start?: number, end?: number, type?: string): BlobLike;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}
export function blobLike(size: number, readAt: (off: number, len: number) => Promise<Uint8Array>, type = '', base = 0): BlobLike {
  const self: BlobLike = {
    size,
    type,
    slice(start = 0, end = size, t = '') {
      const s = Math.max(0, Math.min(size, start < 0 ? size + start : start));
      const e = Math.max(s, Math.min(size, end < 0 ? size + end : end));
      return blobLike(e - s, readAt, t, base + s);
    },
    async arrayBuffer() {
      if (!size) return new ArrayBuffer(0);
      const b = await readAt(base, size);
      if (b.length !== size) throw new Error(`读到 ${b.length} 字节，应为 ${size}`);
      return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? (b.buffer as ArrayBuffer) : (b.slice().buffer as ArrayBuffer);
    },
    async text() {
      return new TextDecoder().decode(await self.arrayBuffer());
    },
  };
  return self;
}

export interface BackupWriter extends ByteSink {
  close(): Promise<void>;
  abort(): Promise<void>;
}
export interface BackupTarget {
  id: 'desktop' | 'android' | 'memory';
  /** 给人看的位置 */
  where(): Promise<string>;
  list(): Promise<Array<{ name: string; bytes: number }>>;
  create(name: string): Promise<BackupWriter>;
  remove(name: string): Promise<void>;
  reader(name: string): Promise<BlobLike>;
}

// ───────── 名字、轮转（纯函数，单测覆盖）─────────

const p2 = (n: number) => String(n).padStart(2, '0');
export function stamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}
export function backupName(kind: BackupKind, now: number, toVersion = ''): string {
  if (kind === 'pre-update') return `glean-pre-update-${toVersion.replace(/[^0-9.]/g, '') || 'x'}-${stamp(now)}.glean`;
  return `glean-${kind}-${stamp(now)}.glean`;
}
const NAME_RE = /^glean-(auto|manual|pre-update)-(?:[0-9.x]+-)?(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)(\d\d)?\.glean$/;
export function parseBackupName(name: string, bytes = 0): BackupFile | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const at = new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], m[7] ? +m[7] : 0).getTime();
  return Number.isFinite(at) ? { name, bytes, at, kind: m[1] as BackupKind } : null;
}

function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function weekKey(t: number) {
  // ISO 周：周一开始
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function monthKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/**
 * 该留哪些自动备份。GFS：从新到旧，每天的第一份（最多 7 天）、每周的第一份（最多 4 周）、每月的第一份（最多 12 月）。
 * last7：最新 7 份。手动 / 更新前的备份不归这里管。
 */
export function keepSet(files: BackupFile[], policy: Retention = 'gfs', lim = { daily: 7, weekly: 4, monthly: 12 }): Set<string> {
  const auto = files.filter((f) => f.kind === 'auto').sort((a, b) => b.at - a.at);
  const keep = new Set<string>();
  if (policy === 'last7') {
    for (const f of auto.slice(0, 7)) keep.add(f.name);
    return keep;
  }
  const days = new Set<string>();
  const weeks = new Set<string>();
  const months = new Set<string>();
  for (const f of auto) {
    const dk = dayKey(f.at);
    const wk = weekKey(f.at);
    const mk = monthKey(f.at);
    let k = false;
    if (!days.has(dk) && days.size < lim.daily) {
      days.add(dk);
      k = true;
    }
    if (!weeks.has(wk) && weeks.size < lim.weekly) {
      weeks.add(wk);
      k = true;
    }
    if (!months.has(mk) && months.size < lim.monthly) {
      months.add(mk);
      k = true;
    }
    if (k) keep.add(f.name);
  }
  return keep;
}
/** 要删的：不在 keepSet 里的自动备份 + 第 4 份起的更新前备份 */
export function toDelete(files: BackupFile[], policy: Retention = 'gfs'): string[] {
  const keep = keepSet(files, policy);
  const pre = files.filter((f) => f.kind === 'pre-update').sort((a, b) => b.at - a.at);
  return [...files.filter((f) => f.kind === 'auto' && !keep.has(f.name)), ...pre.slice(PRE_UPDATE_KEEP)].map((f) => f.name);
}

// ───────── 回读校验（0637）─────────

export interface VerifyResult {
  ok: boolean;
  files: number;
  problems: string[];
  counts?: { items: number; developments: number; images: number };
}
export async function verifyGlean(file: BlobLike | Blob): Promise<VerifyResult> {
  const problems: string[] = [];
  let entries;
  try {
    entries = await readZipBlob(file as Blob);
  } catch (e) {
    return { ok: false, files: 0, problems: [`ZIP 目录读不出：${(e as Error).message}`] };
  }
  const me = entries.get('manifest.json');
  if (!me) return { ok: false, files: entries.size, problems: ['缺 manifest.json'] };
  let man: { files?: Record<string, { sha256: string; bytes: number; lines?: number }>; counts?: { items: number; developments: number; images: number } };
  try {
    man = JSON.parse(await (await zipEntryBlob(file as Blob, me)).text());
  } catch {
    return { ok: false, files: entries.size, problems: ['manifest.json 读不出'] };
  }
  const files = Object.entries(man.files || {});
  if (!files.length || !man.files?.['data.jsonl']) problems.push('manifest 里没有文件清单');
  for (const [path, info] of files) {
    const e = entries.get(path);
    if (!e) {
      problems.push(`缺 ${path}`);
      continue;
    }
    if (e.size !== info.bytes) {
      problems.push(`${path} 大小不对`);
      continue;
    }
    try {
      const bytes = new Uint8Array(await (await zipEntryBlob(file as Blob, e)).arrayBuffer());
      if ((await sha256Hex(bytes)) !== info.sha256) problems.push(`${path} 哈希不对`);
      if (path === 'data.jsonl' && typeof info.lines === 'number') {
        let n = 0;
        for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) n++;
        if (n !== info.lines) problems.push(`data.jsonl 行数 ${n} ≠ ${info.lines}`);
      }
    } catch (err) {
      problems.push(`${path} 读不出：${(err as Error).message}`);
    }
    if (problems.length > 5) break;
  }
  return { ok: !problems.length, files: files.length, problems, counts: man.counts };
}

// ───────── 设置与状态 ─────────

export const AUTOBAK_KEY = 'glean.autobak.v1';
export interface AutoBakState {
  on: boolean;
  policy: Retention;
  /** Windows：自己选的文件夹（空 = 默认 文档\Glean\backup） */
  dir: string;
  lastAt: number;
  lastSig: string;
  lastName: string;
  lastError: string;
  /** 文件名 → 校验结果 */
  verified: Record<string, 'ok' | 'bad'>;
}
export function readAutoBak(s: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): AutoBakState {
  let o: Partial<AutoBakState> = {};
  try {
    o = JSON.parse(s?.getItem(AUTOBAK_KEY) || '{}') || {};
  } catch {
    o = {};
  }
  return {
    on: o.on !== false,
    policy: o.policy === 'last7' ? 'last7' : 'gfs',
    dir: typeof o.dir === 'string' ? o.dir : '',
    lastAt: Number(o.lastAt) || 0,
    lastSig: String(o.lastSig || ''),
    lastName: String(o.lastName || ''),
    lastError: String(o.lastError || ''),
    verified: o.verified && typeof o.verified === 'object' ? o.verified : {},
  };
}
export function writeAutoBak(patch: Partial<AutoBakState>): AutoBakState {
  const next = { ...readAutoBak(), ...patch };
  // 只留最近 40 个文件的校验结果
  const keys = Object.keys(next.verified);
  if (keys.length > 40) for (const k of keys.sort().slice(0, keys.length - 40)) delete next.verified[k];
  try {
    localStorage.setItem(AUTOBAK_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** 库有没有变：条数 + 最近修改时间（穗、新枝、回收站、套路墙、不要的理由） */
export async function librarySig(d: LinganDB = defaultDb): Promise<string> {
  const [n, last, dn, devs, tn, cn, rn] = await Promise.all([
    d.items.count(),
    d.items.orderBy('updatedAt').last(),
    d.developments.count(),
    d.developments.toArray(),
    d.items.where('deletedAt').above(0).count(),
    d.cliches.count(),
    d.rejects.count(),
  ]);
  const dl = devs.reduce((m, x) => Math.max(m, x.updatedAt || x.createdAt || 0, x.deletedAt || 0), 0);
  return [n, last?.updatedAt || 0, dn, dl, tn, cn, rn].join('|');
}

// ───────── 目标：Windows（plugin-fs）/ 安卓（LinganBackup 桥）─────────

interface AndroidBackupBridge {
  where(): string;
  begin(name: string): boolean;
  append(b64: string): boolean;
  commit(): string;
  abort(): void;
  list(): string;
  remove(name: string): boolean;
  readAt(name: string, off: number, len: number): string;
}
export function androidBackupBridge(): AndroidBackupBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { LinganBackup?: AndroidBackupBridge }).LinganBackup;
  return b && typeof b.begin === 'function' ? b : null;
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const CHUNK = 384 * 1024;

/** 小块（ZIP 头）攒到 384KB 再写，大块（原图 Blob）按 384KB 切片读 */
function coalescing(out: (b: Uint8Array) => Promise<void>) {
  let parts: Uint8Array[] = [];
  let size = 0;
  const flush = async () => {
    if (!size) return;
    const all = new Uint8Array(size);
    let p = 0;
    for (const x of parts) {
      all.set(x, p);
      p += x.length;
    }
    parts = [];
    size = 0;
    for (let i = 0; i < all.length; i += CHUNK) await out(all.subarray(i, i + CHUNK));
  };
  const pushBytes = async (b: Uint8Array) => {
    if (!b.length) return;
    parts.push(b);
    size += b.length;
    if (size >= CHUNK) await flush();
  };
  return {
    write: async (c: Uint8Array | Blob) => {
      if (c instanceof Blob) {
        for (let i = 0; i < c.size; i += CHUNK) await pushBytes(new Uint8Array(await c.slice(i, i + CHUNK).arrayBuffer()));
      } else await pushBytes(c);
    },
    flush,
  };
}

export function androidTarget(b: AndroidBackupBridge): BackupTarget {
  return {
    id: 'android',
    where: async () => b.where() || '下载/Glean',
    list: async () => {
      try {
        const a = JSON.parse(b.list() || '[]');
        return Array.isArray(a) ? a.filter((x) => x && typeof x.name === 'string').map((x) => ({ name: String(x.name), bytes: Number(x.bytes) || 0 })) : [];
      } catch {
        return [];
      }
    },
    create: async (name) => {
      if (!b.begin(name)) throw new Error('建不了备份文件（存储权限或空间？）');
      let n = 0;
      const co = coalescing(async (x) => {
        if (!b.append(bytesToBase64(x))) throw new Error('写备份文件失败（空间不够？）');
        if (++n % 8 === 0) await new Promise((r) => setTimeout(r, 0));
      });
      return {
        write: co.write,
        close: async () => {
          await co.flush();
          if (!b.commit()) throw new Error('备份文件没能存好');
        },
        abort: async () => b.abort(),
      };
    },
    remove: async (name) => void b.remove(name),
    reader: async (name) => {
      const list = JSON.parse(b.list() || '[]') as Array<{ name: string; bytes: number }>;
      const f = list.find((x) => x.name === name);
      if (!f) throw new Error('备份文件不在了');
      return blobLike(Number(f.bytes) || 0, async (off, len) => {
        const out = new Uint8Array(len);
        let p = 0;
        while (p < len) {
          const s = b.readAt(name, off + p, Math.min(CHUNK, len - p));
          if (!s) break;
          const got = b64ToBytes(s);
          out.set(got, p);
          p += got.length;
          if (!got.length) break;
        }
        return p === len ? out : out.subarray(0, p);
      });
    },
  };
}

export async function defaultDesktopDir(): Promise<string> {
  const { documentDir, join } = await import('@tauri-apps/api/path');
  return join(await documentDir(), 'Glean', 'backup');
}
export function desktopTarget(dir: string): BackupTarget {
  const fsm = () => import('@tauri-apps/plugin-fs');
  const pj = async (name: string) => (await import('@tauri-apps/api/path')).join(dir, name);
  return {
    id: 'desktop',
    where: async () => dir,
    list: async () => {
      const fs = await fsm();
      if (!(await fs.exists(dir))) return [];
      const out: Array<{ name: string; bytes: number }> = [];
      for (const e of await fs.readDir(dir)) {
        if (!e.isFile || !e.name.startsWith('glean-') || !e.name.endsWith('.glean')) continue;
        const st = await fs.stat(await pj(e.name)).catch(() => null);
        out.push({ name: e.name, bytes: st ? Number(st.size) : 0 });
      }
      return out;
    },
    create: async (name) => {
      const fs = await fsm();
      await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
      const path = await pj(name);
      const fh = await fs.open(path, { write: true, create: true, truncate: true });
      const co = coalescing(async (b) => {
        await fh.write(b);
      });
      return {
        write: co.write,
        close: async () => {
          await co.flush();
          await fh.close();
        },
        abort: async () => {
          await fh.close().catch(() => undefined);
          await fs.remove(path).catch(() => undefined);
        },
      };
    },
    remove: async (name) => {
      const fs = await fsm();
      await fs.remove(await pj(name));
    },
    reader: async (name) => {
      const fs = await fsm();
      const path = await pj(name);
      const st = await fs.stat(path);
      return blobLike(Number(st.size), async (off, len) => {
        const fh = await fs.open(path, { read: true });
        try {
          await fh.seek(off, fs.SeekMode.Start);
          const out = new Uint8Array(len);
          let p = 0;
          while (p < len) {
            const buf = new Uint8Array(Math.min(CHUNK * 4, len - p));
            const n = await fh.read(buf);
            if (!n) break;
            out.set(buf.subarray(0, n), p);
            p += n;
          }
          return p === len ? out : out.subarray(0, p);
        } finally {
          await fh.close().catch(() => undefined);
        }
      });
    },
  };
}

/** 这台设备的备份位置；网页版返回 null */
export async function currentTarget(st = readAutoBak()): Promise<BackupTarget | null> {
  const b = androidBackupBridge();
  if (b) return androidTarget(b);
  if (isTauriEnv()) return desktopTarget(st.dir || (await defaultDesktopDir()));
  return null;
}

// ───────── 备份一次 ─────────

export interface BackupRun {
  name: string;
  where: string;
  stats: ExportStats;
  verify: VerifyResult;
  removed: string[];
  ms: number;
}

let running: Promise<BackupRun> | null = null;
export function backupRunning(): boolean {
  return !!running;
}

export async function listBackups(t: BackupTarget): Promise<BackupFile[]> {
  return (await t.list())
    .map((x) => parseBackupName(x.name, x.bytes))
    .filter((x): x is BackupFile => !!x)
    .sort((a, b) => b.at - a.at);
}

/** 写一份备份 → 回读校验 → 轮转。同一时间只跑一份 */
export function runBackup(kind: BackupKind, appVersion: string, opts: { target?: BackupTarget; d?: LinganDB; now?: number; toVersion?: string; onProgress?: (done: number, total: number) => void } = {}): Promise<BackupRun> {
  if (running) return running;
  running = (async () => {
    const t0 = Date.now();
    const d = opts.d || defaultDb;
    const st = readAutoBak();
    const t = opts.target || (await currentTarget(st));
    if (!t) throw new Error('网页版没有本机文件夹可写，请用「导出备份」');
    const now = opts.now ?? Date.now();
    const name = backupName(kind, now, opts.toVersion);
    const sig = await librarySig(d);
    const w = await t.create(name);
    let stats: ExportStats;
    try {
      stats = await exportGlean(w, d, { now, appVersion, onProgress: opts.onProgress });
      await w.close();
    } catch (e) {
      await w.abort().catch(() => undefined);
      writeAutoBak({ lastError: `${new Date(now).toLocaleString('zh-CN', { hour12: false })} 备份失败：${(e as Error)?.message || e}` });
      throw e;
    }
    const verify = await verifyGlean(await t.reader(name)).catch((e) => ({ ok: false, files: 0, problems: [String((e as Error)?.message || e)] }) as VerifyResult);
    const cur = readAutoBak();
    writeAutoBak({
      ...(kind === 'auto' ? { lastAt: now, lastSig: sig } : {}),
      ...(kind === 'manual' ? { lastAt: now, lastSig: sig } : {}),
      lastName: name,
      lastError: verify.ok ? '' : `${name} 回读校验没过：${verify.problems.slice(0, 2).join('；')}`,
      verified: { ...cur.verified, [name]: verify.ok ? 'ok' : 'bad' },
    });
    const removed: string[] = [];
    // 校验没过的这份不算数，不拿它去顶掉旧的好备份
    if (verify.ok) {
      const files = await listBackups(t);
      for (const n of toDelete(files, cur.policy)) {
        if (n === name) continue;
        await t.remove(n).then(
          () => removed.push(n),
          () => undefined,
        );
      }
    }
    return { name, where: await t.where(), stats, verify, removed, ms: Date.now() - t0 };
  })().finally(() => {
    running = null;
  });
  return running;
}

/** 启动后的自动备份：开着、离上次超过 20 小时、库变了才写 */
export async function autoBackupTick(appVersion: string, now = Date.now(), d: LinganDB = defaultDb): Promise<BackupRun | null> {
  const st = readAutoBak();
  if (!st.on) return null;
  if (now - st.lastAt < 20 * 3600000 && st.lastAt <= now) return null;
  const t = await currentTarget(st);
  if (!t) return null;
  const sig = await librarySig(d);
  if ((await d.items.count()) === 0) return null;
  if (sig === st.lastSig) {
    writeAutoBak({ lastAt: now });
    return null;
  }
  return runBackup('auto', appVersion, { target: t, d, now });
}

/** 0513 0750 更新前：写一份完整备份（不参与 GFS 轮转，留最近 3 份）。网页版不需要 */
export async function backupBeforeUpdate(toVersion: string, appVersion: string): Promise<{ ok: boolean; where?: string; name?: string; error?: string }> {
  try {
    const t = await currentTarget();
    if (!t) return { ok: true };
    if ((await defaultDb.items.count()) === 0) return { ok: true };
    const r = await runBackup('pre-update', appVersion, { target: t, toVersion });
    if (!r.verify.ok) return { ok: false, error: `备份回读校验没过：${r.verify.problems[0] || ''}` };
    return { ok: true, where: r.where, name: r.name };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}
