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
