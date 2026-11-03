// v0.31 0616 同步数据端到端加密 + 0618 恢复码。
// - 数据钥 DEK：随机 256 位，只在本机（系统钥匙串）和云端「被包起来」的样子出现；云上所有文件都是 AES-256-GCM 密文，
//   附加数据（AAD）= 文件路径，挪动 / 换名的文件解不开。
// - 同步口令 → Argon2id（19 MiB、2 轮、1 线程，OWASP 推荐的下限；hash-wasm，懒加载）→ 包裹钥 KEK → 包住 DEK。
// - 恢复码：随机 160 位，Crockford Base32 八组四位（打印卡），HKDF 派生另一把包裹钥；忘了口令时用它解开 DEK。
// - 云上的原图文件名 = HMAC(DEK 派生的名字钥, 原图 sha256)：同一张图只传一次，但云端看不出两张图是否相同于某张已知图。
// 不打日志，错误信息里不带任何密钥材料。

const te = new TextEncoder();
const MAGIC = [0x47, 0x4c, 0x53, 0x31]; // GLS1

export function rand(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
export function b64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** TS 6 的 BufferSource 只认 ArrayBuffer 背的视图：复制一份 */
function ab(b: Uint8Array): ArrayBuffer {
  return b.slice().buffer as ArrayBuffer;
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ab(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export class SyncKey {
  readonly raw: Uint8Array;
  private k: Promise<CryptoKey>;
  private nameKey: Promise<CryptoKey>;
  constructor(raw: Uint8Array) {
    if (raw.length !== 32) throw new Error('数据钥长度不对');
    this.raw = raw;
    this.k = aesKey(raw);
    this.nameKey = (async () => {
      const base = await crypto.subtle.importKey('raw', ab(raw), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: ab(te.encode('glean-sync')), info: ab(te.encode('names')) }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    })();
  }
  static generate(): SyncKey {
    return new SyncKey(rand(32));
  }
  async seal(plain: Uint8Array, aad: string): Promise<Uint8Array> {
    const iv = rand(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv), additionalData: ab(te.encode(aad)) }, await this.k, ab(plain)));
    const out = new Uint8Array(4 + 12 + ct.length);
    out.set(MAGIC, 0);
    out.set(iv, 4);
    out.set(ct, 16);
    return out;
  }
  async open(box: Uint8Array, aad: string): Promise<Uint8Array> {
    if (box.length < 16 + 16 || MAGIC.some((m, i) => box[i] !== m)) throw new Error('不是拾穗的同步文件');
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(box.subarray(4, 16)), additionalData: ab(te.encode(aad)) }, await this.k, ab(box.subarray(16))));
    } catch {
      throw new Error('解不开：数据钥不对或文件被改过');
    }
  }
  async sealJson(v: unknown, aad: string) {
    return this.seal(te.encode(JSON.stringify(v)), aad);
  }
  async openJson<T>(box: Uint8Array, aad: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.open(box, aad))) as T;
  }
  /** 原图在云上的名字 */
  async blobName(sha: string): Promise<string> {
    return hex(await crypto.subtle.sign('HMAC', await this.nameKey, ab(te.encode(sha)))).slice(0, 40);
  }
}

// ───────── 口令（Argon2id）与恢复码 ─────────

export interface KdfParams {
  alg: 'argon2id';
  salt: string;
  m: number;
  t: number;
  p: number;
}
export const KDF_DEFAULT = { m: 19456, t: 2, p: 1 };

export async function passKek(pass: string, kdf: KdfParams): Promise<Uint8Array> {
  if (kdf.alg !== 'argon2id') throw new Error('不认识的口令算法');
  const { argon2id } = await import('hash-wasm');
  const out = await argon2id({ password: pass.normalize('NFC'), salt: unb64(kdf.salt), parallelism: kdf.p, iterations: kdf.t, memorySize: kdf.m, hashLength: 32, outputType: 'binary' });
  return out as Uint8Array;
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford：没有 I L O U
export function newRecoveryCode(): string {
  return encodeB32(rand(20));
}
export function encodeB32(b: Uint8Array): string {
  let bits = 0;
  let val = 0;
  let s = '';
  for (const x of b) {
    val = (val << 8) | x;
    bits += 8;
    while (bits >= 5) {
      s += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) s += B32[(val << (5 - bits)) & 31];
  return s.match(/.{1,4}/g)!.join('-');
}
/** 用户抄回来的恢复码：大小写、空格、横线随意，I/L 当 1，O 当 0 */
export function decodeB32(code: string): Uint8Array | null {
  const s = (code || '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (s.length !== 32) return null;
  const out: number[] = [];
  let bits = 0;
  let val = 0;
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
export async function recoveryKek(code: string, salt: Uint8Array): Promise<Uint8Array> {
  const b = decodeB32(code);
  if (!b || b.length !== 20) throw new Error('恢复码格式不对（应是 8 组 4 位）');
  const base = await crypto.subtle.importKey('raw', ab(b), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: ab(te.encode('glean-recovery')) }, base, 256));
}

/** 用包裹钥包 / 解 DEK（AES-GCM，AAD 标明用途） */
export async function wrapKey(kek: Uint8Array, dek: Uint8Array, use: string): Promise<string> {
  return b64(await new SyncKey(kek).seal(dek, 'wrap:' + use));
}
export async function unwrapKey(kek: Uint8Array, wrapped: string, use: string): Promise<Uint8Array> {
  return new SyncKey(kek).open(unb64(wrapped), 'wrap:' + use);
}

/** 云端根目录的 glean-sync.json：明文，只有算法参数和被包起来的 DEK */
export interface SyncHeader {
  format: 'glean-sync';
  v: 1;
  created: number;
  kdf: KdfParams;
  pass: string;
  rec: { salt: string; w: string };
}
export async function makeHeader(pass: string, dek: SyncKey, code: string, now = Date.now(), kdf = KDF_DEFAULT): Promise<SyncHeader> {
  const params: KdfParams = { alg: 'argon2id', salt: b64(rand(16)), ...kdf };
  const rsalt = rand(16);
  return {
    format: 'glean-sync',
    v: 1,
    created: now,
    kdf: params,
    pass: await wrapKey(await passKek(pass, params), dek.raw, 'pass'),
    rec: { salt: b64(rsalt), w: await wrapKey(await recoveryKek(code, rsalt), dek.raw, 'recovery') },
  };
}
/** 口令或恢复码 → DEK；都不对抛错 */
export async function openHeader(h: SyncHeader, secret: { pass?: string; code?: string }): Promise<SyncKey> {
  if (h?.format !== 'glean-sync') throw new Error('云端文件夹里不是拾穗的同步数据');
  if (secret.code) {
    try {
      return new SyncKey(await unwrapKey(await recoveryKek(secret.code, unb64(h.rec.salt)), h.rec.w, 'recovery'));
    } catch (e) {
      if (/格式/.test(String((e as Error).message))) throw e;
      throw new Error('恢复码不对');
    }
  }
  try {
    return new SyncKey(await unwrapKey(await passKek(secret.pass || '', h.kdf), h.pass, 'pass'));
  } catch {
    throw new Error('同步口令不对');
  }
}
/** 换口令：只重包 DEK，云上数据不用重传 */
export async function rewrapPass(h: SyncHeader, dek: SyncKey, pass: string): Promise<SyncHeader> {
  const params: KdfParams = { ...h.kdf, salt: b64(rand(16)) };
  return { ...h, kdf: params, pass: await wrapKey(await passKek(pass, params), dek.raw, 'pass') };
}
