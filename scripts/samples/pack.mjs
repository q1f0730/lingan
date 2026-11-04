// v0.42 生成 src/lib/samplepack.ts：SAMPLE_POOL → 每条一个数组 → JSON → GBK 编码（汉字 2 字节，GBK 外的字写成 \uXXXX）→ zlib deflate(9) → base64。
// 改了 samples.ts 的示例池之后跑：node scripts/samples/pack.mjs（单测 v042 核对解压结果 = SAMPLE_POOL）
import { createServer } from 'vite';
import zlib from 'node:zlib';
import fs from 'node:fs';
const sv = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { SAMPLE_POOL } = await sv.ssrLoadModule('/src/lib/samples.ts');
await sv.close();
const F = ['type', 'title', 'creator', 'year', 'content', 'url', 'why'];
const json = JSON.stringify(SAMPLE_POOL.map((s) => [...F.map((k) => s[k] || ''), s.tags.join('\u0001')]));
// GBK 反查表：所有双字节组合解一遍
const dec = new TextDecoder('gbk');
const rev = new Map();
for (let h = 0x81; h < 0xff; h++)
  for (let l = 0x40; l < 0xff; l++) {
    if (l === 0x7f) continue;
    const c = dec.decode(new Uint8Array([h, l]));
    if (c.length === 1 && c !== '\ufffd' && !rev.has(c)) rev.set(c, [h, l]);
  }
const bytes = [];
for (const c of json) {
  const p = c.codePointAt(0);
  if (p < 128) bytes.push(p);
  else if (rev.has(c)) bytes.push(...rev.get(c));
  else for (const b of Buffer.from(p > 0xffff ? JSON.stringify(c).slice(1, -1) : '\\u' + p.toString(16).padStart(4, '0'))) bytes.push(b);
}
const b64 = zlib.deflateSync(Buffer.from(bytes), { level: 9 }).toString('base64');
fs.writeFileSync(
  new URL('../../src/lib/samplepack.ts', import.meta.url),
  `// 自动生成（scripts/samples/pack.mjs）：示例池 ${SAMPLE_POOL.length} 条 → 数组 JSON → GBK → deflate → base64。不要手改\nimport { inflateBytes } from './inflate';\nimport type { ItemType } from './types';\nimport type { Sample } from './sampledraw';\nconst Z =\n  '${b64}';\nconst F = ${JSON.stringify(F)} as const;\nexport async function loadSamplePool(): Promise<Sample[]> {\n  const rows: string[][] = JSON.parse(new TextDecoder('gbk').decode(await inflateBytes(Z)));\n  return rows.map((r) => {\n    const s: Record<string, unknown> = { type: r[0] as ItemType, tags: r[7].split('\\u0001') };\n    F.forEach((k, i) => i && r[i] && (s[k] = r[i]));\n    return s as unknown as Sample;\n  });\n}\n`,
);
console.log(SAMPLE_POOL.length, bytes.length, b64.length);
