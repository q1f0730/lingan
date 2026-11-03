// v0.21 流式 ZIP：边读边写，不在内存里拼整个包。
// - 写：ZipWriter 把每个条目的本地头 + 数据 + （流式条目的）数据描述符依次交给 sink，最后写中央目录。
//   已知内容的条目（原图：读一张算一张 CRC）直接写；内容边生成边写的条目（data.jsonl）用数据描述符（通用位第 3 位）。
//   只用「存储」方式（图片本来就压缩过），UTF-8 文件名，和 v0.15 的 zip.ts 一样能被 Windows / 安卓 / unzip 解开。
// - 读：readZipBlob 只读文件尾部和中央目录，条目内容按需 slice（导入 300 张图的备份也不把整个文件读进内存）。
import { crc32Update, dosTime } from './zip';

export type Chunk = Uint8Array | Blob;
export interface ByteSink {
  write(chunk: Chunk): Promise<void>;
}

const enc = new TextEncoder();
const LIMIT = 0xfffffffe;

interface CentralRec {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
  flags: number;
}

function localHeader(name: Uint8Array, flags: number, time: number, date: number, crc: number, size: number): Uint8Array {
  const lh = new Uint8Array(30 + name.length);
  const v = new DataView(lh.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, flags, true);
  v.setUint16(8, 0, true);
  v.setUint16(10, time, true);
  v.setUint16(12, date, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, size, true);
  v.setUint32(22, size, true);
  v.setUint16(26, name.length, true);
  v.setUint16(28, 0, true);
  lh.set(name, 30);
  return lh;
}

export class ZipWriter {
  private offset = 0;
  private central: CentralRec[] = [];
  private seen = new Set<string>();
  private open = false;
  private sink: ByteSink;
  private now: number;
  constructor(sink: ByteSink, now = Date.now()) {
    this.sink = sink;
    this.now = now;
  }

  get bytesWritten() {
    return this.offset;
  }

  private async emit(c: Chunk) {
    const n = c instanceof Blob ? c.size : c.length;
    if (this.offset + n > LIMIT) throw new Error('备份太大（超过 4GB）');
    this.offset += n;
    await this.sink.write(c);
  }

  private claim(path: string): Uint8Array {
    const p = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!p) throw new Error('空路径');
    if (this.seen.has(p)) throw new Error('重复路径 ' + p);
    if (this.open) throw new Error('上一个流式条目还没结束');
    this.seen.add(p);
    return enc.encode(p);
  }

  has(path: string) {
    return this.seen.has(path);
  }

  /** 已知内容的条目。data 可以是 Blob（例如库里的原图）：此时必须给出它的字节（算 CRC 用），写出时交给 sink 的仍是 Blob 本身 */
  async addFile(path: string, data: Uint8Array | string, mtime?: number): Promise<void>;
  async addFile(path: string, data: Blob, mtime: number | undefined, bytes: Uint8Array): Promise<void>;
  async addFile(path: string, data: Uint8Array | string | Blob, mtime?: number, bytes?: Uint8Array): Promise<void> {
    const name = this.claim(path);
    const raw = typeof data === 'string' ? enc.encode(data) : data instanceof Blob ? bytes! : data;
    if (!raw) throw new Error('缺少字节');
    const crc = crc32Update(0, raw);
    const { time, date } = dosTime(mtime ?? this.now);
    const flags = 0x0800;
    const rec: CentralRec = { name, crc, size: raw.length, offset: this.offset, time, date, flags };
    await this.emit(localHeader(name, flags, time, date, crc, raw.length));
    await this.emit(data instanceof Blob ? data : raw);
    this.central.push(rec);
  }

  /** 边生成边写的条目：先写头（CRC / 大小写 0），write() 若干次，end() 写数据描述符 */
  async begin(path: string, mtime?: number) {
    const name = this.claim(path);
    this.open = true;
    const { time, date } = dosTime(mtime ?? this.now);
    const flags = 0x0808; // UTF-8 + 数据描述符
    const rec: CentralRec = { name, crc: 0, size: 0, offset: this.offset, time, date, flags };
    await this.emit(localHeader(name, flags, time, date, 0, 0));
    let crc = 0;
    let size = 0;
    return {
      write: async (chunk: Uint8Array) => {
        if (!chunk.length) return;
        crc = crc32Update(crc, chunk);
        size += chunk.length;
        await this.emit(chunk);
      },
      end: async () => {
        const dd = new Uint8Array(16);
        const v = new DataView(dd.buffer);
        v.setUint32(0, 0x08074b50, true);
        v.setUint32(4, crc, true);
        v.setUint32(8, size, true);
        v.setUint32(12, size, true);
        await this.emit(dd);
        rec.crc = crc;
        rec.size = size;
        this.central.push(rec);
        this.open = false;
        return { crc, size };
      },
    };
  }

  /** 写中央目录与结尾 */
  async finish(): Promise<number> {
    if (this.open) throw new Error('还有没结束的条目');
    if (this.central.length > 0xffff) throw new Error('备份里文件太多（超过 65535 个）');
    const start = this.offset;
    let cdSize = 0;
    for (const r of this.central) {
      const ch = new Uint8Array(46 + r.name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, (3 << 8) | 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, r.flags, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, r.time, true);
      cv.setUint16(14, r.date, true);
      cv.setUint32(16, r.crc, true);
      cv.setUint32(20, r.size, true);
      cv.setUint32(24, r.size, true);
      cv.setUint16(28, r.name.length, true);
      cv.setUint32(38, (0o100644 << 16) >>> 0, true);
      cv.setUint32(42, r.offset, true);
      ch.set(r.name, 46);
      cdSize += ch.length;
      await this.emit(ch);
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, this.central.length, true);
    ev.setUint16(10, this.central.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, start, true);
    await this.emit(end);
    return this.offset;
  }
}

export interface BlobZipEntry {
  path: string;
  size: number;
  crc: number;
  method: number;
  /** 本地头位置 */
  offset: number;
}

async function bytesOf(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

/** 读 ZIP 的目录（只读尾部和中央目录） */
export async function readZipBlob(file: Blob): Promise<Map<string, BlobZipEntry>> {
  const tailLen = Math.min(file.size, 65557);
  const tail = await bytesOf(file.slice(file.size - tailLen));
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是 ZIP：找不到目录结尾');
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOff = tv.getUint32(eocd + 16, true);
  if (cdOff + cdSize > file.size) throw new Error('ZIP 目录越界（文件不完整？）');
  const cd = await bytesOf(file.slice(cdOff, cdOff + cdSize));
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder();
  const out = new Map<string, BlobZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const path = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
    out.set(path, { path, size, crc, method, offset });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** 条目内容（Blob 切片，不读进内存）。只支持「存储」方式 */
export async function zipEntryBlob(file: Blob, e: BlobZipEntry, type = ''): Promise<Blob> {
  if (e.method !== 0) throw new Error(`${e.path}：只支持未压缩条目`);
  const lh = await bytesOf(file.slice(e.offset, e.offset + 30));
  const v = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
  if (lh.length < 30 || v.getUint32(0, true) !== 0x04034b50) throw new Error(`${e.path}：本地头损坏`);
  const start = e.offset + 30 + v.getUint16(26, true) + v.getUint16(28, true);
  if (start + e.size > file.size) throw new Error(`${e.path}：数据不完整`);
  return file.slice(start, start + e.size, type);
}
