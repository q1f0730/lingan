// v0.42 瘦身：大块静态数据（拼音字表、示例池）以 zlib deflate + base64 进包，用到时用浏览器自带的 DecompressionStream 解开。
// 'deflate'（带 zlib 头）Chrome 80 起就有；'deflate-raw' 要 103+，所以不用。
// v0.45：构建时 scripts/binpack.mjs 把这几个包换成单独的 .bin 资源，传进来的是 "@" + 地址，fetch 原始字节（省掉 base64 的 1/3）。
export async function inflateBytes(z: string): Promise<Uint8Array> {
  const body = z[0] === '@' ? await fetch(z.slice(1)).then((r) => r.arrayBuffer()) : Uint8Array.from(atob(z), (c) => c.charCodeAt(0));
  return new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
}
export const inflate = async (z: string): Promise<string> => new TextDecoder().decode(await inflateBytes(z));
