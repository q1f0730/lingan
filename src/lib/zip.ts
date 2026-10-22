// v0.15 极简 ZIP：只用「存储」（不压缩）——图片本来就是压缩过的，Markdown 很小，
// 不引第三方依赖。文件名按 UTF-8 写（通用位第 11 位），中文路径在 Windows / 安卓 / Obsidian 都能正确解开。
// readZip 只用来在单测里把生成的包解回来核对结构。

export interface ZipEntry {
  /** 包内路径，用 / 分隔，例如 音乐/晴天.md */
  path: string;
  data: Uint8Array | string;
  /** 修改时间（毫秒），默认现在 */
  mtime?: number;
}

const enc = new TextEncoder();

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 本地时间 → DOS 时间 / 日期 */
function dosTime(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** 打包。重复路径只保留第一份；目录项不写（解压工具会按路径自动建目录） */
export function makeZip(entries: ZipEntry[], now = Date.now()): Uint8Array {
  const seen = new Set<string>();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  for (const e of entries) {
    const path = e.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const name = enc.encode(path);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    const { time, date } = dosTime(e.mtime ?? now);
    if (offset > 0xfffffffe || data.length > 0xfffffffe) throw new Error('导出太大（超过 4GB）');
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true); // made by: Unix（否则 Info-ZIP 会把名字当 DOS 代码页再转一次）
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, (0o100644 << 16) >>> 0, true); // external attrs: 普通文件 rw-r--r--
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    parts.push(lh, data);
    central.push(ch);
    offset += lh.length + data.length;
    count++;
  }
  if (count > 0xffff) throw new Error('导出文件太多（超过 65535 个）');
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const x of parts) {
    out.set(x, p);
    p += x.length;
  }
  for (const x of central) {
    out.set(x, p);
    p += x.length;
  }
  out.set(end, p);
  return out;
}

export interface ReadEntry {
  path: string;
  data: Uint8Array;
  crcOk: boolean;
  utf8Flag: boolean;
}

/** 读回 ZIP（只支持「存储」方式，够核对 makeZip 的产物；也会校验 CRC） */
export function readZip(buf: Uint8Array): ReadEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是 ZIP：找不到目录结尾');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const path = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    if (method !== 0) throw new Error('只支持未压缩条目');
    if (v.getUint32(lho, true) !== 0x04034b50) throw new Error('ZIP 本地头损坏');
    const ln = v.getUint16(lho + 26, true);
    const lx = v.getUint16(lho + 28, true);
    const start = lho + 30 + ln + lx;
    const data = buf.slice(start, start + size);
    out.push({ path, data, crcOk: crc32(data) === crc, utf8Flag: (flags & 0x0800) !== 0 });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
