// v0.39 0907 上锁的 PIN：4–12 位数字，PBKDF2-SHA256（12 万次）加盐哈希存本机 localStorage（不同步、不进备份）。
// 输错 5 次后要等 30 秒才能再试。生物识别（指纹 / Windows Hello）要真机接系统接口，这版没做。
import { LOCK_KEY, openFor, relock } from './lock';

const ITER = 120000;
const FAIL_KEY = 'glean.lock.fail';
export const PIN_RE = /^\d{4,12}$/;

interface Stored {
  v: 1;
  salt: string;
  hash: string;
  iter: number;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return b64(new Uint8Array(bits));
}
function read(): Stored | null {
  try {
    const o = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    return o && o.v === 1 && o.salt && o.hash ? o : null;
  } catch {
    return null;
  }
}

export async function setPin(pin: string): Promise<void> {
  if (!PIN_RE.test(pin)) throw new Error('PIN 要 4–12 位数字');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const s: Stored = { v: 1, salt: b64(salt), hash: await derive(pin, salt, ITER), iter: ITER };
  localStorage.setItem(LOCK_KEY, JSON.stringify(s));
  localStorage.removeItem(FAIL_KEY);
}

/** 还要等几秒才能再试（输错 5 次后锁 30 秒） */
export function waitLeft(now = Date.now()): number {
  try {
    const f = JSON.parse(localStorage.getItem(FAIL_KEY) || '{}');
    return f.n >= 5 && now - f.at < 30000 ? Math.ceil((30000 - (now - f.at)) / 1000) : 0;
  } catch {
    return 0;
  }
}

/** 核对 PIN；对了就解锁 5 分钟 */
export async function checkPin(pin: string, open = true): Promise<boolean> {
  const s = read();
  if (!s || waitLeft()) return false;
  const ok = (await derive(pin, unb64(s.salt), s.iter || ITER)) === s.hash;
  if (ok) {
    localStorage.removeItem(FAIL_KEY);
    if (open) openFor();
  } else {
    let n = 0;
    try {
      n = JSON.parse(localStorage.getItem(FAIL_KEY) || '{}').n || 0;
    } catch {
      /* ignore */
    }
    localStorage.setItem(FAIL_KEY, JSON.stringify({ n: n >= 5 ? 1 : n + 1, at: Date.now() }));
  }
  return ok;
}

/** 关掉上锁功能要先输对 PIN；还有上锁的穗时不让关（调用方先检查） */
export async function clearPin(pin: string): Promise<boolean> {
  if (!(await checkPin(pin, false))) return false;
  localStorage.removeItem(LOCK_KEY);
  relock();
  return true;
}

// ——— v0.40 忘了 PIN：两条路 ———
// ① 申请重设：24 小时冷静期。期间上锁的穗照样挡着（PIN 也照样能开）、随时可取消；满 24 小时后要再点一次「现在重设」才清掉旧 PIN。
//    计时不直接信系统时间：App 开着时每次只记「墙钟走了多少」和「单调钟走了多少」里小的那个（把时间往后拨不算数）；
//    App 关着的那段按墙钟补，但下次启动发现墙钟比见过的最晚时间还早（往回拨过）就判作动过时间，冷静期从头算。
//    这只防「拿着已解锁设备的人当场绕过」；关机改时间再开机这种，本机没有可信时钟，挡不住（上锁本来也不是加密）。
// ② 立即重设：上锁穗的内容当场清空（标题 / 正文 / 为什么 / 图 …），只剩空壳进回收站；要二次确认。
export const RESET_KEY = 'glean.lock.reset';
export const RESET_MS = 24 * 3600 * 1000;
const SLACK = 5000;
interface Reset {
  /** 申请时间（只给人看） */
  at: number;
  /** 已经认下的冷静期毫秒 */
  acc: number;
  /** 上次记账时的墙钟 */
  wall: number;
  /** 见过的最晚墙钟（往回拨的判断依据） */
  max: number;
}
let seen: { wall: number; mono: number } | null = null;
const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function readReset(): Reset | null {
  try {
    const o = JSON.parse(localStorage.getItem(RESET_KEY) || 'null');
    return o && typeof o.acc === 'number' && typeof o.wall === 'number' ? o : null;
  } catch {
    return null;
  }
}
export function startReset(now = Date.now(), m = mono()): void {
  localStorage.setItem(RESET_KEY, JSON.stringify({ at: now, acc: 0, wall: now, max: now } satisfies Reset));
  seen = { wall: now, mono: m };
}
export function cancelReset(): void {
  localStorage.removeItem(RESET_KEY);
  seen = null;
}
/** 记一次账，返回冷静期还剩多少毫秒；null = 没在申请。now / m 只给单测注入 */
export function resetLeft(now = Date.now(), m = mono()): number | null {
  const r = readReset();
  if (!r) return null;
  if (now < (r.max || r.wall) - 60000) {
    // 墙钟比见过的还早一分钟以上：动过时间，从头算
    r.acc = 0;
    r.at = now;
  } else if (seen) {
    // 同一次运行：墙钟和单调钟取小的（往后拨不算数）
    r.acc += Math.max(0, Math.min(now - r.wall, m - seen.mono + SLACK));
  } else {
    // 上次记账之后 App 关过：按墙钟补
    r.acc += Math.max(0, now - r.wall);
  }
  r.wall = now;
  r.max = Math.max(r.max || 0, now);
  seen = { wall: now, mono: m };
  localStorage.setItem(RESET_KEY, JSON.stringify(r));
  return Math.max(0, RESET_MS - r.acc);
}
/** 冷静期满了才真的清掉旧 PIN（之后设新的） */
export function finishReset(now = Date.now(), m = mono()): boolean {
  if (resetLeft(now, m) !== 0) return false;
  localStorage.removeItem(LOCK_KEY);
  localStorage.removeItem(FAIL_KEY);
  cancelReset();
  relock();
  return true;
}
/** 立即重设：清空所有上锁穗的内容（进回收站，只剩空壳）并删掉旧 PIN。返回清了几穗 */
export async function wipeLocked(): Promise<number> {
  const { db, trashItems } = await import('./db');
  const ids = (await db.items.filter((x) => !!x.locked).toArray()).map((x) => x.id!).filter(Boolean);
  const blank = { title: '已清空的上锁穗', content: '', why: '', url: '', creator: '', year: '', tags: [], caption: undefined, ocr: undefined, snap: undefined, links: undefined, work: undefined, bundles: undefined, revisits: undefined, embedding: undefined, hasImage: undefined, thumb: undefined, image: undefined, source: undefined, meets: undefined, locked: undefined };
  await db.transaction('rw', db.items, db.images, async () => {
    for (const id of ids) {
      await db.items.update(id, blank);
      await db.images.delete(id);
    }
  });
  await trashItems(ids);
  localStorage.removeItem(LOCK_KEY);
  localStorage.removeItem(FAIL_KEY);
  cancelReset();
  relock();
  return ids.length;
}
