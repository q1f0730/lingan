// v0.45 瘦身：懒加载块里的中文字符串在构建时被 scripts/zhpack.mjs 收成一个包（JSON → GBK → raw deflate → base64），
// 块里原来的字面量换成 __glzS(n)。块第一次取字时调这里的 __glz 同步解开（块代码不能顶层 await，所以不用 DecompressionStream）。
// 首屏 app 块不压（冷启动路径不变）；这个文件由 main.tsx 第一个 import，懒加载块到的时候 globalThis.__glz 一定已经挂好。

const LB: number[] = [];
const LX: number[] = [];
const DB: number[] = [];
const DX: number[] = [];
for (let i = 0, b = 3; i < 29; i++) {
  LX[i] = i < 8 || i > 27 ? 0 : (i - 4) >> 2;
  LB[i] = i > 27 ? 258 : b;
  b += 1 << LX[i];
}
for (let i = 0, b = 1; i < 30; i++) {
  DX[i] = i < 4 ? 0 : (i - 2) >> 1;
  DB[i] = b;
  b += 1 << DX[i];
}
const ORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

type Huff = [Uint16Array, Uint16Array];
function huff(lens: ArrayLike<number>, num: number): Huff {
  const cnt = new Uint16Array(16);
  const off = new Uint16Array(16);
  const sym = new Uint16Array(num);
  for (let i = 0; i < num; i++) cnt[lens[i]]++;
  cnt[0] = 0;
  for (let i = 1; i < 16; i++) off[i] = off[i - 1] + cnt[i - 1];
  for (let i = 0; i < num; i++) if (lens[i]) sym[off[lens[i]]++] = i;
  return [cnt, sym];
}

/** RFC 1951 raw deflate 解码（照 zlib 的 puff.c 写，逐位读；包都在几十 KB 以内，够快） */
export function inflateRawSync(src: Uint8Array): Uint8Array {
  let out = new Uint8Array(src.length * 4 + 64);
  let n = 0;
  let pos = 0;
  let bit = 0;
  const bits = (k: number): number => {
    let v = 0;
    for (let i = 0; i < k; i++) {
      if (pos >= src.length) throw new Error('inflate: 数据不完整');
      v |= ((src[pos] >> bit) & 1) << i;
      if (++bit === 8) {
        bit = 0;
        pos++;
      }
    }
    return v;
  };
  const put = (b: number) => {
    if (n === out.length) {
      const o = new Uint8Array(n * 2);
      o.set(out);
      out = o;
    }
    out[n++] = b;
  };
  const dec = (h: Huff): number => {
    let code = 0;
    let first = 0;
    let idx = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h[0][len];
      if (code - c < first) return h[1][idx + code - first];
      idx += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Error('inflate: 坏码');
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      if (bit) {
        bit = 0;
        pos++;
      }
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      for (let i = 0; i < len; i++) put(src[pos++]);
      continue;
    }
    let lit: Huff;
    let dist: Huff;
    if (type === 1) {
      const l: number[] = [];
      for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
      lit = huff(l, 288);
      dist = huff(new Array(30).fill(5), 30);
    } else if (type === 2) {
      const nl = bits(5) + 257;
      const nd = bits(5) + 1;
      const nc = bits(4) + 4;
      const cl = new Array(19).fill(0);
      for (let i = 0; i < nc; i++) cl[ORD[i]] = bits(3);
      const ch = huff(cl, 19);
      const lens: number[] = [];
      while (lens.length < nl + nd) {
        const s = dec(ch);
        if (s < 16) lens.push(s);
        else {
          const [v, r] = s === 16 ? [lens[lens.length - 1], 3 + bits(2)] : s === 17 ? [0, 3 + bits(3)] : [0, 11 + bits(7)];
          for (let i = 0; i < r; i++) lens.push(v);
        }
      }
      lit = huff(lens, nl);
      dist = huff(lens.slice(nl), nd);
    } else throw new Error('inflate: 坏块');
    for (;;) {
      const s = dec(lit);
      if (s < 256) put(s);
      else if (s === 256) break;
      else {
        const li = s - 257;
        const len = LB[li] + bits(LX[li]);
        const di = dec(dist);
        const d = DB[di] + bits(DX[di]);
        for (let i = 0; i < len; i++) put(out[n - d]);
      }
    }
  }
  return out.subarray(0, n);
}

/** 解开一个字符串包：base64 → raw inflate → GBK 解码 → JSON 数组 */
export function unpackStrings(b64: string): string[] {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder('gbk').decode(inflateRawSync(bin)));
}

(globalThis as unknown as { __glz: typeof unpackStrings }).__glz = unpackStrings;
