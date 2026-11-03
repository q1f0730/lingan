// v0.21 数据地基：全局唯一 id（ULID，26 位 Crockford Base32：48 位毫秒时间 + 80 位随机）。
// 按字典序 = 按时间序；同一毫秒内单调递增（随机部分 +1），不会撞。只用 crypto.getRandomValues，不引依赖。

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;
const TIME_MAX = 2 ** 48 - 1;

function randomDigits(): number[] {
  const bytes = new Uint8Array(RAND_LEN);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < RAND_LEN; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b & 31);
}

function encodeTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  t = Math.min(TIME_MAX, Math.floor(t));
  let s = '';
  for (let i = 0; i < TIME_LEN; i++) {
    s = ALPHABET[t % 32] + s;
    t = Math.floor(t / 32);
  }
  return s;
}

let lastTime = -1;
let lastRand: number[] = [];

/** 生成一个 ULID。time 默认现在；迁移旧数据时传它的 createdAt，这样 uid 也按记录时间排 */
export function ulid(time: number = Date.now()): string {
  const t = Math.min(TIME_MAX, Math.max(0, Math.floor(Number.isFinite(time) ? time : Date.now())));
  let rand: number[];
  if (t === lastTime) {
    // 同一毫秒：随机部分 +1（单调），极少数溢出时换一组新随机
    rand = [...lastRand];
    let i = RAND_LEN - 1;
    while (i >= 0 && rand[i] === 31) rand[i--] = 0;
    if (i < 0) rand = randomDigits();
    else rand[i]++;
  } else rand = randomDigits();
  lastTime = t;
  lastRand = rand;
  return encodeTime(t) + rand.map((d) => ALPHABET[d]).join('');
}

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export function isUlid(s: unknown): s is string {
  return typeof s === 'string' && ULID_RE.test(s);
}

/** ULID 里的毫秒时间 */
export function ulidTime(id: string): number {
  if (!isUlid(id)) return NaN;
  let t = 0;
  for (let i = 0; i < TIME_LEN; i++) t = t * 32 + ALPHABET.indexOf(id[i]);
  return t;
}
