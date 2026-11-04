/**
 * v0.41 0134 繁简互搜：搜「花样年华」也能找到「花樣年華」，反过来也行。
 * 不改索引（索引仍按原文切词）：查询里有汉字时把它换成全简体、以及繁体的几种写法，各搜一遍再并起来。
 * 字表约 10KB（scripts/zhvar/gen.py，OpenCC STCharacters），只在搜索框里第一次出现汉字时懒加载。
 */
import { ZHVAR_Z } from './zhvar-table';
import { inflateBytes } from './inflate';

let src = '';
/** v0.42 字表是压缩包：import 之后先 await ready 再用 */
export const ready: Promise<void> = inflateBytes(ZHVAR_Z).then((b) => {
  src = new TextDecoder('gbk').decode(b);
});

// 必须和 scripts/zhvar/gen.py 的 DIGITS / NT 一致（与拼音字表同一种编码）
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./;<=>?@[]^_{}~';
const NT = 52;

let toT: Map<string, string[]> | null = null;
let toS: Map<string, string> | null = null;

function load(): void {
  if (toT || !src) return;
  const b: number[] = [];
  for (let h = 0xb0; h < 0xf8; h++) for (let l = 0xa1; l < 0xff; l++) if (h !== 0xd7 || l < 0xfa) b.push(h, l);
  const gb = [...new TextDecoder('gbk').decode(new Uint8Array(b))];
  toT = new Map();
  toS = new Map();
  let prev = -1;
  let i = 0;
  const s = src;
  while (i < s.length) {
    let v = 0;
    for (;;) {
      const d = DIGITS.indexOf(s[i++]);
      if (d >= NT) v = v * (DIGITS.length - NT) + d - NT;
      else {
        prev += v * NT + d + 1;
        break;
      }
    }
    const simp = gb[prev];
    const ts: string[] = [];
    while (i < s.length && s.charCodeAt(i) > 127) ts.push(s[i++]);
    toT.set(simp, ts);
    for (const t of ts) if (!toS.has(t)) toS.set(t, simp);
  }
}

/** 全部换成简体 */
export function toSimp(text: string): string {
  load();
  let out = '';
  for (const ch of text) out += toS?.get(ch) ?? ch;
  return out;
}

/** 简体 → 繁体的写法（一简多繁时组合，最多 max 种），按常用在前 */
export function toTrads(text: string, max = 6): string[] {
  load();
  let acc = [''];
  for (const ch of toSimp(text)) {
    const opts = toT?.get(ch);
    const alts = opts ? opts : [ch];
    const next: string[] = [];
    for (const a of acc) for (const o of alts) if (next.length < max) next.push(a + o);
    acc = next;
  }
  return acc;
}

/** 和原文不同的其它写法（简体一种 + 繁体几种），没有可换的字就是空数组 */
export function zhVariants(text: string, max = 6): string[] {
  const out = new Set<string>([toSimp(text), ...toTrads(text, max)]);
  out.delete(text);
  return [...out];
}

/** 表里的对数（单测核对） */
export function zhvarSize(): number {
  load();
  return toT?.size ?? 0;
}
