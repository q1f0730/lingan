// v0.43 瘦身：hash-wasm（同步口令的 Argon2id，懒加载块）里的 wasm 是原样 base64（argon2 6.7KB + blake2b 7.4KB → 18.8KB 文本）。
// 构建时把它们换成 zlib deflate 后的 base64（约 7.3KB），加载处先用浏览器自带的 DecompressionStream('deflate') 解开再 compile。
// wasm 字节不变（单测 v043 解回来逐字节比），所以 Argon2id 结果不变、老设备的同步口令照样能开。
// 认不出要改的地方就抛错（hash-wasm 升级换了写法时构建直接失败，而不是悄悄不压）。
import { deflateSync } from 'node:zlib';

const WASM_B64 = /var (data\$\w+) = "(AGFzbQ[A-Za-z0-9+/=]+)";/g;
const LOAD = 'const asm = decodeBase64(binary.data);\n                const promise = WebAssembly.compile(asm);';
const LOAD_Z =
  "const promise = new Response(new Blob([decodeBase64(binary.data)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer().then((b) => WebAssembly.compile(b));";

/** 返回改好的源码；packed = 压了几个 wasm */
export function packHashWasm(code) {
  if (!code.includes(LOAD)) throw new Error('wasmpack: hash-wasm 的加载代码变了，先对一遍 node_modules/hash-wasm/dist/index.esm.js');
  let packed = 0;
  const out = code
    .replace(WASM_B64, (_, v, b64) => {
      packed++;
      return `var ${v} = "${deflateSync(Buffer.from(b64, 'base64'), { level: 9 }).toString('base64')}";`;
    })
    .replace(LOAD, LOAD_Z);
  if (!packed) throw new Error('wasmpack: 没找到 wasm 数据');
  return { code: out, packed };
}

/** vite 插件：只在构建时改 hash-wasm 的 ESM 入口 */
export function hashWasmPack() {
  return {
    name: 'glean-hash-wasm-pack',
    apply: 'build',
    transform(code, id) {
      if (!/hash-wasm[\\/]dist[\\/]index\.esm\.js$/.test(id)) return null;
      return { code: packHashWasm(code).code, map: null };
    },
  };
}
