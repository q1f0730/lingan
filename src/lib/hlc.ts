// v0.31 0602 混合逻辑时钟（HLC）：每行、每个改过的字段都盖一个能跨设备比先后的时间戳。
// 格式：<13 位毫秒>-<4 位 36 进制计数>-<设备 id>，按字符串比较就是先后（同毫秒按计数，再按设备 id 定输赢）。
// 本机时钟往回拨也不会倒退：取「上次的 HLC」和「现在」里大的那个；收到别的设备更大的 HLC 时跟上它（recv）。
// 只存在 localStorage（同步读，Dexie 钩子里要用）；丢了也无妨：下一次从库里最大的 hlc 接着走（seedHlc）。
import { getDeviceId } from './device';

const KEY = 'glean.hlc.v1';
/** 比任何真实 HLC 都小：partial 行里没写的字段、旧行没 hc 时用它 */
export const HLC_ZERO = '0000000000000-0000-0';

let lastMs = 0;
let lastC = 0;
let loaded = false;

function pad(n: number, w: number) {
  return String(n).padStart(w, '0');
}
export function fmtHlc(ms: number, c: number, dev: string): string {
  return `${pad(Math.max(0, Math.floor(ms)), 13)}-${c.toString(36).padStart(4, '0')}-${dev}`;
}
export function parseHlc(h: string): { ms: number; c: number; dev: string } | null {
  const m = /^(\d{13})-([0-9a-z]{4})-(.+)$/.exec(h || '');
  return m ? { ms: Number(m[1]), c: parseInt(m[2], 36), dev: m[3] } : null;
}
export function isHlc(h: unknown): h is string {
  return typeof h === 'string' && parseHlc(h) != null;
}
/** 旧行（v0.30 及以前）按 updatedAt 换算一个 HLC：计数 0，设备用它自己记的 deviceId */
export function hlcFromWall(ms: number, dev: string): string {
  return fmtHlc(ms || 0, 0, dev || '0');
}
export function maxHlc(a: string | undefined, b: string | undefined): string {
  if (!a) return b || HLC_ZERO;
  if (!b) return a;
  return a > b ? a : b;
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const p = parseHlc(localStorage.getItem(KEY) || '');
    if (p) {
      lastMs = p.ms;
      lastC = p.c;
    }
  } catch {
    /* 没有存储：从 0 开始，靠墙钟 */
  }
}
function save(h: string) {
  try {
    localStorage.setItem(KEY, h);
  } catch {
    /* ignore */
  }
}

/** 本机发生了一次修改：给它一个比之前所有（本机见过的）HLC 都大的时间戳 */
export function tick(now = Date.now(), dev = getDeviceId()): string {
  load();
  if (now > lastMs) {
    lastMs = now;
    lastC = 0;
  } else lastC++;
  if (lastC > 1679615) {
    // 4 位 36 进制用完（同一毫秒 167 万次修改，不会发生）：借下一毫秒
    lastMs++;
    lastC = 0;
  }
  const h = fmtHlc(lastMs, lastC, dev);
  save(h);
  return h;
}
/** 收到别的设备的 HLC：本机时钟追上它，之后本机的修改一定排在它后面 */
export function recv(remote: string, now = Date.now()): void {
  load();
  const r = parseHlc(remote);
  if (!r) return;
  const ms = Math.max(lastMs, r.ms, now);
  if (ms === lastMs && ms === r.ms) lastC = Math.max(lastC, r.c);
  else if (ms === r.ms) lastC = r.c;
  else if (ms !== lastMs) lastC = 0;
  lastMs = ms;
  save(fmtHlc(lastMs, lastC, getDeviceId()));
}
/** 测试用：清掉内存里的时钟 */
export function resetHlcForTest() {
  lastMs = 0;
  lastC = 0;
  loaded = false;
}
