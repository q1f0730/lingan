// v0.45 瘦身：懒加载块里的中文字符串（JSX 文案、提示词、标签……）构建时收成每块一个压缩包。
// 做法：renderChunk（还没压缩混淆）时解析整块，把含 ≥3 个中日韩字符的字符串字面量 / 模板字符串片段换成 __glzS(n)，
// 块开头加一个懒解包函数：第一次取字时调 globalThis.__glz（src/lib/zunpack.ts，首屏 main.tsx 第一个 import）解开整包。
// 包 = 字符串数组 JSON → GBK（汉字 2 字节，GBK 外的字写 \uXXXX）→ raw deflate(9) → base64。
// 不碰：首屏块（入口 / app / runtime）、对象和类的非计算键、import / export 的来源与名字、正则、带标签的模板字符串。
// 单测 v045 用 expandChunk 把换过的代码还原，核对和原代码逐字相同，并用 zunpack 解包核对字符串。
import { parseAst } from 'rolldown/parseAst';
import { deflateRawSync } from 'node:zlib';

const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/g;
export const FN = '__glzS';
const cjkCount = (s) => (s.match(CJK) || []).length;

let REV = null;
function gbkRev() {
  if (REV) return REV;
  const dec = new TextDecoder('gbk');
  REV = new Map();
  for (let h = 0x81; h < 0xff; h++)
    for (let l = 0x40; l < 0xff; l++) {
      if (l === 0x7f) continue;
      const c = dec.decode(new Uint8Array([h, l]));
      if (c.length === 1 && c !== '\ufffd' && !REV.has(c)) REV.set(c, [h, l]);
    }
  return REV;
}

/** 字符串数组 → base64 包（zunpack.unpackStrings 的逆） */
export function packStrings(strings) {
  const rev = gbkRev();
  const json = JSON.stringify(strings);
  const bytes = [];
  for (const c of json) {
    const p = c.codePointAt(0);
    if (p < 128) bytes.push(p);
    else if (rev.has(c)) bytes.push(...rev.get(c));
    // GBK 外的字写成 \uXXXX（BMP 外的字拆成两个代理项，JSON.parse 会拼回去）
    else for (let i = 0; i < c.length; i++) for (const b of Buffer.from('\\u' + c.charCodeAt(i).toString(16).padStart(4, '0'))) bytes.push(b);
  }
  return deflateRawSync(Buffer.from(bytes), { level: 9 }).toString('base64');
}

const SKIP_PARENT = new Set(['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression', 'ImportSpecifier', 'ExportSpecifier', 'ImportAttribute']);

/** 找出要换的位置：[{ start, end, value, tpl }]（tpl = 模板字符串片段，换成 ${…}） */
export function findStrings(code, min = 3) {
  const ast = parseAst(code);
  const hits = [];
  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Literal' && typeof node.value === 'string' && cjkCount(node.value) >= min) {
      const isKey = parent && (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed;
      const directive = parent && parent.type === 'ExpressionStatement' && parent.directive != null;
      if (!isKey && !directive && !(parent && SKIP_PARENT.has(parent.type))) hits.push({ start: node.start, end: node.end, value: node.value, tpl: false });
    }
    if (node.type === 'TemplateLiteral' && !(parent && parent.type === 'TaggedTemplateExpression')) {
      for (const q of node.quasis) {
        const v = q.value.cooked;
        if (v != null && cjkCount(v) >= min) hits.push({ start: q.start, end: q.end, value: v, tpl: true, raw: q.value.raw });
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) visit(c, node, k);
      else if (v && typeof v === 'object') visit(v, node, k);
    }
  };
  visit(ast, null, null);
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

/** 换掉一块里的中文字符串；没有可换的返回 null。{ code, strings, header } */
export function packChunk(code, min = 3) {
  const hits = findStrings(code, min);
  if (!hits.length) return null;
  const strings = [];
  const orig = [];
  const ids = [];
  const idx = new Map();
  let out = '';
  let at = 0;
  for (const h of hits) {
    // 模板片段的范围在不同解析器里可能含不含定界符，按 raw 文本在代码里核对
    let { start, end } = h;
    if (h.tpl) {
      const raw = h.raw;
      if (code.slice(start, end) !== raw) {
        const i = code.indexOf(raw, start);
        if (i < 0 || i > end) throw new Error('zhpack: 模板片段定位失败');
        start = i;
        end = i + raw.length;
      }
    }
    if (start < at) continue;
    let n = idx.get(h.value);
    if (n == null) {
      n = strings.length;
      strings.push(h.value);
      idx.set(h.value, n);
    }
    orig.push(code.slice(start, end));
    ids.push(n);
    out += code.slice(at, start) + (h.tpl ? '${' + FN + '(' + n + ')}' : FN + '(' + n + ')');
    at = end;
  }
  out += code.slice(at);
  const header = `var ${FN}T;function ${FN}(i){return(${FN}T||(${FN}T=globalThis.__glz(${JSON.stringify(packStrings(strings))})))[i]}\n`;
  return { code: header + out, strings, header, orig, ids };
}

/** 单测用：按出现顺序把 __glzS(n) / ${__glzS(n)} 换回原来的源码片段（应和原代码逐字相同） */
export function expandChunk(packed) {
  const body = packed.code.slice(packed.header.length);
  let k = 0;
  return body.replace(new RegExp('\\$\\{' + FN + '\\(\\d+\\)\\}|' + FN + '\\(\\d+\\)', 'g'), () => packed.orig[k++]);
}

/** vite 插件：只在构建时、只对非首屏块 */
export function zhPack() {
  let saved = 0;
  return {
    name: 'glean-zh-pack',
    apply: 'build',
    renderChunk(code, chunk) {
      if (chunk.isEntry || chunk.name === 'app' || chunk.name === 'rolldown-runtime') return null;
      if (chunk.moduleIds?.some((id) => /src[\\/]main\.tsx$/.test(id))) return null;
      const r = packChunk(code);
      if (!r) return null;
      saved += Buffer.byteLength(code) - Buffer.byteLength(r.code);
      return { code: r.code, map: null };
    },
    generateBundle() {
      if (process.env.ZHPACK_LOG) console.log(`[zhpack] 未压缩前少了 ${(saved / 1024).toFixed(1)} KB`);
    },
  };
}
