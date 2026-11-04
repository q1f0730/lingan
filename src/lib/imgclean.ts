// v0.43 照片元数据（懒加载：只有新收的图做缩略图、或图要发出去时才加载）
// - 0651 收图：抹掉 EXIF 里的 GPS 子目录（连同它指向的数值，原地填 0，不改文件结构）、去掉 XMP；读出拍摄时间留作「拾于」候选
// - 0636 收图：长边超过 4096 时重编码成 JPEG（质量 0.9；长截图按短边不小于 1080 留着），设置里可选「保留完全原图」
// - 0650 外发（发给 AI 看图、导出到 Obsidian）：去掉全部 EXIF / XMP / IPTC，只留方向（不然竖拍的图会躺着）
// 只认 JPEG / PNG / WebP；别的格式原样返回。备份 / 同步不经过这里（那是你自己的数据，原样留着）。

export const CAP_EDGE = 4096;
export const FULL_KEY = 'glean.img.full';
export const OUT_KEY = 'glean.img.keepmeta';

type U8 = Uint8Array;
const be16 = (b: U8, o: number) => (b[o] << 8) | b[o + 1];
const cat = (parts: U8[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
};
const ascii = (b: U8, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

interface Exif {
  orient: number;
  shot?: string;
  zone?: string;
  gps: boolean;
}

/** 读 TIFF（EXIF 正文）。wipe = 把 GPS 子目录和它的数值原地清零 */
export function readTiff(t: U8, wipe = false): Exif {
  const le = t[0] === 0x49;
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const SZ = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  const r: Exif = { orient: 1, gps: false };
  const ifd = (o: number, fn: (tag: number, e: number) => void) => {
    if (o < 8 || o + 2 > t.length) return;
    const n = u16(o);
    for (let i = 0; i < n && o + 2 + i * 12 + 12 <= t.length; i++) fn(u16(o + 2 + i * 12), o + 2 + i * 12);
  };
  const str = (e: number) => {
    const n = u32(e + 4);
    const at = n > 4 ? u32(e + 8) : e + 8;
    return at + n <= t.length ? ascii(t, at, n).replace(/\0.*$/s, '') : '';
  };
  let exifAt = 0;
  let gpsAt = 0;
  ifd(u32(4), (tag, e) => {
    if (tag === 0x112) r.orient = u16(e + 8) || 1;
    else if (tag === 0x132) r.shot = r.shot || str(e);
    else if (tag === 0x8769) exifAt = u32(e + 8);
    else if (tag === 0x8825) gpsAt = u32(e + 8);
  });
  ifd(exifAt, (tag, e) => {
    if (tag === 0x9003) r.shot = str(e) || r.shot;
    else if (tag === 0x9011) r.zone = str(e);
  });
  if (gpsAt) {
    r.gps = true;
    if (wipe && gpsAt + 2 <= t.length) {
      const n = u16(gpsAt);
      const end = Math.min(t.length, gpsAt + 2 + n * 12 + 4);
      ifd(gpsAt, (_tag, e) => {
        const bytes = (SZ[u16(e + 2)] || 1) * u32(e + 4);
        const at = u32(e + 8);
        if (bytes > 4 && at + bytes <= t.length) t.fill(0, at, at + bytes);
      });
      t.fill(0, gpsAt, end);
    }
  }
  return r;
}

/** "2024:03:02 14:05:09" (+ "+08:00") → 毫秒；不像拍摄时间的（1990 年前、比现在还晚一天）丢掉 */
export function shotTime(s: string | undefined, zone?: string, now = Date.now()): number | undefined {
  const m = s?.match(/^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)/);
  if (!m) return undefined;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const z = zone?.match(/^([+-])(\d\d):?(\d\d)$/);
  const t = z ? Date.UTC(y, mo - 1, d, h, mi, se) - (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]) * 60000 : new Date(y, mo - 1, d, h, mi, se).getTime();
  return Number.isFinite(t) && y >= 1990 && t <= now + 86400000 ? t : undefined;
}

const isExif = (b: U8, o: number) => ascii(b, o, 6) === 'Exif\0\0';
const isXmp = (b: U8, o: number) => ascii(b, o, 28) === 'http://ns.adobe.com/xap/1.0/';

/** 只留方向的最小 EXIF（APP1） */
function orientApp1(orient: number): U8 {
  const b = new Uint8Array(4 + 6 + 26);
  b.set([0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, orient, 0]);
  return b;
}

/** JPEG：mode 'in' = 抹 GPS、去 XMP；'out' = 去掉 EXIF / XMP / IPTC，只留方向。返回 null = 不是 JPEG */
export function cleanJpeg(src: U8, mode: 'in' | 'out'): { bytes: U8; exif?: Exif } | null {
  if (src[0] !== 0xff || src[1] !== 0xd8) return null;
  const b = src.slice();
  const keep: U8[] = [b.subarray(0, 2)];
  let exif: Exif | undefined;
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const mk = b[o + 1];
    if (mk === 0xda || mk === 0xd9) break; // 图像数据开始：后面原样
    const len = be16(b, o + 2);
    const seg = b.subarray(o, o + 2 + len);
    let drop = false;
    if (mk === 0xe1 && isExif(b, o + 4)) {
      exif = readTiff(b.subarray(o + 10, o + 2 + len), mode === 'in');
      drop = mode === 'out';
    } else if (mk === 0xe1 && isXmp(b, o + 4)) drop = true;
    else if (mk === 0xed && mode === 'out') drop = true; // Photoshop / IPTC
    if (!drop) keep.push(seg);
    o += 2 + len;
  }
  if (mode === 'out' && exif && exif.orient > 1 && exif.orient <= 8) keep.splice(1, 0, orientApp1(exif.orient));
  keep.push(b.subarray(o));
  return { bytes: cat(keep), exif };
}

/** PNG：去掉 eXIf 块（收图 / 外发都去；PNG 里的 EXIF 方向浏览器多半不认） */
export function cleanPng(b: U8): U8 | null {
  if (ascii(b, 1, 3) !== 'PNG') return null;
  const keep: U8[] = [b.subarray(0, 8)];
  for (let o = 8; o + 12 <= b.length; ) {
    const n = new DataView(b.buffer, b.byteOffset).getUint32(o) + 12;
    const type = ascii(b, o + 4, 4);
    if (type !== 'eXIf' && !(type === 'iTXt' && ascii(b, o + 8, 17) === 'XML:com.adobe.xmp')) keep.push(b.subarray(o, o + n));
    o += n;
  }
  return cat(keep);
}

/** WebP：去掉 EXIF / XMP 块，改 RIFF 长度和 VP8X 标志 */
export function cleanWebp(b: U8): U8 | null {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const keep: U8[] = [b.slice(0, 12)];
  for (let o = 12; o + 8 <= b.length; ) {
    const type = ascii(b, o, 4);
    const n = 8 + new DataView(b.buffer, b.byteOffset).getUint32(o + 4, true);
    const seg = b.slice(o, o + n + (n & 1));
    if (type === 'VP8X') seg[8] &= ~0x0c;
    if (type !== 'EXIF' && type !== 'XMP ') keep.push(seg);
    o += n + (n & 1);
  }
  const out = cat(keep);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/** 不解码读尺寸（PNG IHDR / JPEG SOFn / WebP VP8X）；认不出 = null（再去解码） */
export function imageDims(b: U8): { w: number; h: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && ascii(b, 1, 3) === 'PNG') return { w: v.getUint32(16), h: v.getUint32(20) };
  if (b.length > 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 12, 4) === 'VP8X') return { w: 1 + (v.getUint32(24, true) & 0xffffff), h: 1 + (v.getUint32(27, true) & 0xffffff) };
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let o = 2; o + 9 < b.length && b[o] === 0xff; o += 2 + be16(b, o + 2)) {
    const mk = b[o + 1];
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: be16(b, o + 7), h: be16(b, o + 5) };
    if (mk === 0xda) break;
  }
  return null;
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** 0650 外发前：去掉元数据（设置里关了就原样） */
export async function stripForOut(blob: Blob): Promise<Blob> {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(OUT_KEY) === '1') return blob;
  const b = await bytesOf(blob);
  const out = cleanJpeg(b, 'out')?.bytes || cleanPng(b) || cleanWebp(b);
  return out ? new Blob([out as BlobPart], { type: blob.type }) : blob;
}
/** data URL 版（AI 看图用的是 data URL） */
export async function stripDataUrl(url: string): Promise<string> {
  const m = url.match(/^data:([^;,]+);base64,/);
  if (!m) return url;
  const bin = Uint8Array.from(atob(url.slice(m[0].length)), (c) => c.charCodeAt(0));
  const b = new Uint8Array(await (await stripForOut(new Blob([bin], { type: m[1] }))).arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return m[0] + btoa(s);
}

/** 0636 缩到多大：长边 ≤4096，但短边不压到 1080 以下（长截图 / 全景留着） */
export function capSize(w: number, h: number, edge = CAP_EDGE): { w: number; h: number } | null {
  let k = Math.min(1, edge / Math.max(w, h));
  if (Math.min(w, h) * k < 1080) k = Math.min(1, 1080 / Math.min(w, h));
  return k < 1 ? { w: Math.round(w * k), h: Math.round(h * k) } : null;
}

export interface Intake {
  blob: Blob;
  shotAt?: number;
  changed: boolean;
}

/** 0651 / 0636 新收的图：抹 GPS、去 XMP、读拍摄时间；太大就缩（重编码顺带把元数据全去掉，方向已经转正） */
export async function cleanIntake(blob: Blob, now = Date.now()): Promise<Intake> {
  const b = await bytesOf(blob);
  const j = cleanJpeg(b, 'in');
  const shotAt = j?.exif ? shotTime(j.exif.shot, j.exif.zone, now) : undefined;
  const out = j?.bytes || cleanPng(b) || cleanWebp(b);
  let res: Blob = out && (out.length !== b.length || j?.exif?.gps) ? new Blob([out as BlobPart], { type: blob.type }) : blob;
  // 尺寸读得出且不超 4096 就不解码（新图本来就要解一次做缩略图，别再多解一次）
  const dims = imageDims(b);
  if (typeof createImageBitmap === 'function' && localStorage.getItem(FULL_KEY) !== '1' && (!dims || Math.max(dims.w, dims.h) > CAP_EDGE)) {
    try {
      const bmp = await createImageBitmap(res);
      const to = capSize(bmp.width, bmp.height);
      if (to) {
        const c = document.createElement('canvas');
        c.width = to.w;
        c.height = to.h;
        const g = c.getContext('2d')!;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, to.w, to.h);
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, 0, 0, to.w, to.h);
        const small = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
        if (small && small.size < res.size) res = small;
      }
      bmp.close();
    } catch {
      /* 解不开就原样留着 */
    }
  }
  return { blob: res, shotAt, changed: res !== blob };
}
