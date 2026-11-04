// v0.42 瘦身：大块静态数据（拼音字表、示例池）以 zlib deflate + base64 进包，用到时用浏览器自带的 DecompressionStream 解开。
// 'deflate'（带 zlib 头）Chrome 80 起就有；'deflate-raw' 要 103+，所以不用。
export async function inflateBytes(b64: string): Promise<Uint8Array> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
}
export const inflate = async (b64: string): Promise<string> => new TextDecoder().decode(await inflateBytes(b64));
