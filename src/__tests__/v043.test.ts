// v0.43 存得干净 · 存得稳：照片元数据（0651 / 0636 / 0650）、备份提醒与存储（0639 / 0631）、配方 / 智能穗束进备份、
// identifier 不可改（0653）、隐私条款可测（0935）、hash-wasm 的 wasm 压缩（瘦身）
import { describe, expect, it } from 'vitest';
import { capSize, cleanJpeg, cleanPng, cleanWebp, imageDims, readTiff, shotTime } from '../lib/imgclean';
import { backupDue, backupText } from '../lib/nudge';
import { cleanPrefs, mergePrefs, type LocalPrefs } from '../lib/localprefs';
import { inflateBytes } from '../lib/inflate';
import { packHashWasm } from '../../scripts/wasmpack.mjs';
import hashWasmSrc from 'hash-wasm/dist/index.esm.js?raw';

const DAY = 864e5;
const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** 小端 TIFF：IFD0（方向 6、ExifIFD、GPS）+ ExifIFD（拍摄时间 + 时区）+ GPS（纬度 3 个有理数） */
function tiff(): Uint8Array {
  const b = new Uint8Array(200);
  const v = new DataView(b.buffer);
  b.set([0x49, 0x49, 42, 0]);
  v.setUint32(4, 8, true);
  const entry = (at: number, tag: number, type: number, count: number, val: number) => {
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) v.setUint16(at + 8, val, true);
    else v.setUint32(at + 8, val, true);
  };
  // IFD0 @8：3 项 → 8 + 2 + 36 + 4 = 50
  v.setUint16(8, 3, true);
  entry(10, 0x112, 3, 1, 6);
  entry(22, 0x8769, 4, 1, 50);
  entry(34, 0x8825, 4, 1, 120);
  // ExifIFD @50：2 项 → 50 + 2 + 24 + 4 = 80；DateTimeOriginal @80（20 字节），OffsetTimeOriginal @100（7 字节）
  v.setUint16(50, 2, true);
  entry(52, 0x9003, 2, 20, 80);
  entry(64, 0x9011, 2, 7, 100);
  b.set([...enc('2024:03:02 14:05:09'), 0], 80);
  b.set([...enc('+08:00'), 0], 100);
  // GPS @120：1 项 → 120 + 2 + 12 + 4 = 138；纬度 @138（24 字节）
  v.setUint16(120, 1, true);
  entry(122, 2, 5, 3, 138);
  [31, 1, 47, 1, 1234, 100].forEach((n, i) => v.setUint32(138 + i * 4, n, true));
  return b.subarray(0, 162);
}
function jpeg(): Uint8Array {
  const t = tiff();
  const app1 = [0xff, 0xe1, ...[(t.length + 8) >> 8, (t.length + 8) & 255], ...enc('Exif\0\0'), ...t];
  const xmpBody = enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta exif:GPSLatitude="31,47"/>');
  const xmp = [0xff, 0xe1, (xmpBody.length + 2) >> 8, (xmpBody.length + 2) & 255, ...xmpBody];
  const sos = [0xff, 0xda, 0, 4, 1, 2, 0x11, 0x22, 0x33, 0xff, 0xd9];
  return new Uint8Array([0xff, 0xd8, ...app1, ...xmp, ...sos]);
}
const hasSeq = (b: Uint8Array, seq: number[]) => {
  outer: for (let i = 0; i + seq.length <= b.length; i++) {
    for (let j = 0; j < seq.length; j++) if (b[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
};

describe('0651 收图抹 GPS、留拍摄时间', () => {
  it('读出方向 / 拍摄时间 / 时区 / 有 GPS', () => {
    const e = readTiff(tiff().slice());
    expect(e).toMatchObject({ orient: 6, shot: '2024:03:02 14:05:09', zone: '+08:00', gps: true });
    expect(shotTime(e.shot, e.zone)).toBe(Date.UTC(2024, 2, 2, 6, 5, 9));
  });
  it("cleanJpeg('in')：GPS 数值清零、XMP 去掉、EXIF 其余和图像数据原样", () => {
    const src = jpeg();
    const r = cleanJpeg(src, 'in')!;
    expect(r.exif?.gps).toBe(true);
    expect(hasSeq(src, [1234 & 255, 1234 >> 8, 0, 0, 100, 0, 0, 0])).toBe(true);
    expect(hasSeq(r.bytes, [1234 & 255, 1234 >> 8, 0, 0, 100, 0, 0, 0])).toBe(false);
    expect(hasSeq(r.bytes, enc('xmpmeta'))).toBe(false);
    expect(hasSeq(r.bytes, enc('2024:03:02 14:05:09'))).toBe(true);
    expect(Array.from(r.bytes.slice(-11))).toEqual([0xff, 0xda, 0, 4, 1, 2, 0x11, 0x22, 0x33, 0xff, 0xd9]);
    // 原数组不被改
    expect(hasSeq(src, enc('xmpmeta'))).toBe(true);
    // 再读一遍：GPS 目录已空
    const again = cleanJpeg(r.bytes, 'in')!;
    expect(hasSeq(again.bytes, [31, 0, 0, 0, 1, 0, 0, 0, 47])).toBe(false);
  });
  it("cleanJpeg('out')：只留方向的最小 EXIF", () => {
    const r = cleanJpeg(jpeg(), 'out')!;
    expect(hasSeq(r.bytes, enc('2024:03'))).toBe(false);
    expect(hasSeq(r.bytes, enc('xmpmeta'))).toBe(false);
    const e = cleanJpeg(r.bytes, 'in')!.exif!;
    expect(e).toMatchObject({ orient: 6, gps: false });
    expect(e.shot).toBeUndefined();
  });
  it('不是 JPEG 返回 null；拍摄时间不像样的丢掉', () => {
    expect(cleanJpeg(new Uint8Array([1, 2, 3, 4]), 'in')).toBeNull();
    expect(shotTime('1980:01:01 00:00:00')).toBeUndefined();
    expect(shotTime('2099:01:01 00:00:00', undefined, Date.UTC(2026, 10, 4))).toBeUndefined();
    expect(shotTime('garbage')).toBeUndefined();
    expect(shotTime('2025:12:31 23:00:00', '-05:00')).toBe(Date.UTC(2026, 0, 1, 4, 0, 0));
  });
  it('PNG 去 eXIf，WebP 去 EXIF / XMP 并改长度和标志', () => {
    const chunk = (type: string, data: number[]) => [0, 0, data.length >> 8, data.length & 255, ...enc(type), ...data, 0, 0, 0, 0];
    const png = new Uint8Array([0x89, ...enc('PNG\r\n\x1a\n'), ...chunk('IHDR', [1, 2, 3]), ...chunk('eXIf', [9, 9, 9, 9]), ...chunk('IEND', [])]);
    const p = cleanPng(png)!;
    expect(hasSeq(p, enc('eXIf'))).toBe(false);
    expect(hasSeq(p, enc('IHDR'))).toBe(true);
    const ch = (type: string, data: number[]) => [...enc(type), data.length, 0, 0, 0, ...data, ...(data.length & 1 ? [0] : [])];
    const body = [...enc('WEBP'), ...ch('VP8X', [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...ch('VP8 ', [1, 2, 3, 4]), ...ch('EXIF', [7, 7, 7]), ...ch('XMP ', [8, 8])];
    const webp = new Uint8Array([...enc('RIFF'), body.length & 255, body.length >> 8, 0, 0, ...body]);
    const w = cleanWebp(webp)!;
    expect(hasSeq(w, enc('EXIF'))).toBe(false);
    expect(hasSeq(w, enc('XMP '))).toBe(false);
    expect(new DataView(w.buffer).getUint32(4, true)).toBe(w.length - 8);
    expect(w[20] & 0x0c).toBe(0);
  });
});

describe('0636 长边 4096', () => {
  it('不解码读尺寸：JPEG SOF0 / PNG IHDR；认不出给 null', () => {
    const sof = [0xff, 0xc0, 0, 17, 8, 0x09, 0xc4, 0x13, 0x88, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    expect(imageDims(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, ...sof, 0xff, 0xda]))).toEqual({ w: 5000, h: 2500 });
    const ihdr = [0x89, ...enc('PNG\r\n\x1a\n'), 0, 0, 0, 13, ...enc('IHDR'), 0, 0, 0x10, 0x01, 0, 0, 3, 0, 8, 6, 0, 0, 0];
    expect(imageDims(new Uint8Array(ihdr))).toEqual({ w: 4097, h: 768 });
    expect(imageDims(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('普通大图缩到 4096，长截图 / 全景短边不小于 1080，小图不动', () => {
    expect(capSize(8000, 6000)).toEqual({ w: 4096, h: 3072 });
    expect(capSize(1080, 8000)).toBeNull();
    expect(capSize(3000, 12000)).toEqual({ w: 1080, h: 4320 });
    expect(capSize(4000, 3000)).toBeNull();
  });
});

describe('0639 备份提醒', () => {
  const now = Date.UTC(2026, 10, 4);
  it('穗少 / 库太新 / 刚备份过 / 7 天内提过 / 关了 → 不提', () => {
    expect(backupDue(now, 0, 10, now - 100 * DAY)).toBeNull();
    expect(backupDue(now, 0, 50, now - 3 * DAY)).toBeNull();
    expect(backupDue(now, now - 5 * DAY, 50, now - 100 * DAY)).toBeNull();
    expect(backupDue(now, 0, 50, now - 100 * DAY, { bk: now - 2 * DAY })).toBeNull();
    expect(backupDue(now, 0, 50, now - 100 * DAY, { off: 1 })).toBeNull();
  });
  it('该提就给天数（-1 = 从没备份过）', () => {
    expect(backupDue(now, now - 20 * DAY, 50, now - 100 * DAY)).toBe(20);
    expect(backupDue(now, 0, 50, now - 100 * DAY, { bk: now - 8 * DAY })).toBe(-1);
    expect(backupText(-1)).toBe('还没备份过');
    expect(backupText(20)).toBe('上次备份是 20 天前');
  });
});

describe('配方 / 智能穗束进备份', () => {
  const base: LocalPrefs = { atoms: null, cards: [], outbound: [] };
  const mine: LocalPrefs = { ...base, recipes: [{ name: 'A', mode: 'far' }], smart: [{ q: '雨', at: 1 }] };
  it('合并：本机为准 + 补上备份里没有的；有上限', () => {
    const inc = cleanPrefs({ recipes: [{ name: 'A', mode: 'near' }, { name: 'B', mode: 'far' }, { bad: 1 }], smart: [{ q: '雨', at: 2 }, { q: '海', at: 3 }, { q: ' ' }] });
    const m = mergePrefs(mine, inc, 'merge');
    expect(m.recipes!.map((r) => [r.name, r.mode])).toEqual([['A', 'far'], ['B', 'far']]);
    expect(m.smart!.map((s) => s.q)).toEqual(['雨', '海']);
    const many = cleanPrefs({ recipes: Array.from({ length: 20 }, (_, i) => ({ name: `r${i}`, mode: 'far' })) });
    expect(mergePrefs(base, many, 'merge').recipes).toHaveLength(8);
  });
  it('旧备份没有这两样：合并 / 替换都不动本机的', () => {
    const old = cleanPrefs({ atoms: null, cards: ['x'], outbound: [] });
    expect(old.recipes).toBeUndefined();
    expect(mergePrefs(mine, old, 'replace').recipes).toEqual(mine.recipes);
    expect(mergePrefs(mine, old, 'merge').smart).toEqual(mine.smart);
  });
  it('替换：备份为准', () => {
    const inc = cleanPrefs({ recipes: [], smart: [{ q: '海', at: 3 }] });
    const r = mergePrefs(mine, inc, 'replace');
    expect(r.recipes).toEqual([]);
    expect(r.smart).toEqual([{ q: '海', at: 3 }]);
  });
});

const raw = import.meta.glob(['../../src-tauri/tauri.conf.json'], { query: '?raw', eager: true, import: 'default' }) as Record<string, string>;
const file = (end: string) => Object.entries(raw).find(([k]) => k.endsWith(end))![1];

describe('0653 identifier 不可改', () => {
  it('tauri.conf.json 的 identifier 还是 com.q1f730.lingan（改了 = 装成另一个 App、老数据和自动更新全断）', () => {
    expect(JSON.parse(file('tauri.conf.json')).identifier).toBe('com.q1f730.lingan');
  });
});

describe('瘦身：hash-wasm 的 wasm 压缩后逐字节不变', () => {
  it('解压 = 原 wasm', async () => {
    const src = hashWasmSrc;
    const { code, packed } = packHashWasm(src);
    expect(packed).toBeGreaterThan(5);
    const re = /var (data\$\w+) = "([A-Za-z0-9+/=]+)";/g;
    const before = new Map([...src.matchAll(re)].filter((m) => m[2].startsWith('AGFzbQ')).map((m) => [m[1], m[2]]));
    const after = new Map([...code.matchAll(re)].map((m) => [m[1], m[2]]));
    for (const k of ['data$k', 'data$j']) {
      const z = await inflateBytes(after.get(k)!);
      expect(btoa(String.fromCharCode(...z))).toBe(before.get(k));
    }
    expect(code).toContain("DecompressionStream('deflate')");
    expect(code.length).toBeLessThan(src.length * 0.7);
  });
});
