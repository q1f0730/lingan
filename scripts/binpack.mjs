// v0.45 瘦身：拼音字表 / 繁简字表 / 示例池这几个 deflate 包在源码里是 base64（多 1/3）。
// 构建时把 base64 解回原始字节，作为单独的 .bin 资源输出，源码里的字面量换成 "@" + 资源地址；
// src/lib/inflate.ts 看到 "@" 开头就 fetch 那个文件（同源，CSP connect-src 'self' 放行）再解压。
// 开发 / 单测不经过这个插件，仍走 base64，所以两条路的字节一样（单测 v045 核对）。
const TARGETS = /src[\\/]lib[\\/](pinyin-table|zhvar-table|samplepack)\.ts$/;
export const PACK_RE = /((?:export )?const \w+ =\s*)(['"])([A-Za-z0-9+/=]{2000,})\2/;

/** 返回 { code, bytes } 或 null（认不出时构建失败，免得悄悄不压） */
export function splitPack(code) {
  const m = PACK_RE.exec(code);
  if (!m) return null;
  return { head: m[1], b64: m[3], index: m.index, len: m[0].length };
}

export function binPack() {
  return {
    name: 'glean-bin-pack',
    apply: 'build',
    transform(code, id) {
      const t = TARGETS.exec(id);
      if (!t) return null;
      const p = splitPack(code);
      if (!p) throw new Error(`binpack: ${t[1]} 里没找到 base64 包`);
      const ref = this.emitFile({ type: 'asset', name: `${t[1]}.bin`, source: Buffer.from(p.b64, 'base64') });
      const out = code.slice(0, p.index) + p.head + `"@" + import.meta.ROLLUP_FILE_URL_${ref}` + code.slice(p.index + p.len);
      return { code: out, map: null };
    },
  };
}
