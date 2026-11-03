// v0.38 ROADMAP 端侧向量（原 v0.21）：没配向量模型时，可以在设置里下载一个约 8.8MB 的中文静态向量小模型，
// 之后语义搜索（0109）、母题聚类（0106）、星图、三枝不撞车都能离线算。
// 模型 = minishlab/potion-multilingual-128M（model2vec，MIT）裁到中文 + 常用英文词元、int8 量化，格式见 models/README.md。
// 推理不需要任何运行库：Unigram（Viterbi）分词 → 词元向量取平均 → 归一化。这个模块只在设置页 / 用到向量时懒加载。
import Dexie from 'dexie';
import { getFetch } from './ai';
import { MINI_KEY } from './privacy';

export const MINI_ID = 'glean-mini-zh-v1';
export const MINI_SIZE = 8799540;
export const MINI_SHA = '34ac606785ca9f6321807169811905d268b64fa9b199d86015db7e56a8f493d1';
// 固定到发版 tag：内容不会变；下载完核对大小与 SHA-256（镜像是第三方的也不怕被换包）
const GH = 'q1f0730/lingan@v0.38.0/models/mini-zh-v1.bin';
const RAW = 'q1f0730/lingan/v0.38.0/models/mini-zh-v1.bin';
export const MINI_URLS = [`https://cdn.jsdelivr.net/gh/${GH}`, `https://raw.githubusercontent.com/${RAW}`];
// v0.39 国内镜像：2026-11-04 用阿里云拨测（7 个大区 × 移动 / 电信 / 联通）实测 —— cdn.jsdmirror.com、jsd.onmicrosoft.cn 是国内节点、
// 三网都 200；fastly.jsdelivr.net 三网可达；gh-proxy.com 可达但走境外节点；cdn.jsdelivr.net 移动基本不通，raw.githubusercontent.com 移动全挂。
export const MINI_CN_URLS = [`https://cdn.jsdmirror.com/gh/${GH}`, `https://jsd.onmicrosoft.cn/gh/${GH}`, `https://fastly.jsdelivr.net/gh/${GH}`, `https://cdn.jsdelivr.net/gh/${GH}`, `https://gh-proxy.com/https://raw.githubusercontent.com/${RAW}`, `https://raw.githubusercontent.com/${RAW}`];
export const MINI_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'cdn.jsdmirror.com', 'jsd.onmicrosoft.cn', 'gh-proxy.com', 'raw.githubusercontent.com'];

/** 在国内（时区是中国大陆）先走国内镜像；其它地方 jsDelivr → GitHub raw → 再试国内镜像 */
export function miniUrls(tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''): string[] {
  const cn = /^Asia\/(Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar|Beijing)$|^PRC$/.test(tz);
  return cn ? MINI_CN_URLS : [...MINI_URLS, ...MINI_CN_URLS.filter((u) => !MINI_URLS.includes(u))];
}

const store = () => {
  const d = new Dexie('glean-mini');
  d.version(1).stores({ f: '' });
  return d.table<ArrayBuffer, string>('f');
};

export interface Mini {
  dim: number;
  max: number;
  voc: Map<string, number>;
  score: Float32Array;
  scale: Float32Array;
  mat: Int8Array;
}

/** 解析模型文件（小端）：GM1\0 · n · dim · 词表字节数 · 词表 · 分数 · 缩放 · int8 矩阵 */
export function parseMini(buf: ArrayBuffer): Mini {
  const u = new Uint8Array(buf);
  const h = new DataView(buf);
  if (u[0] !== 71 || u[1] !== 77 || u[2] !== 49) throw new Error('模型文件格式不对');
  const n = h.getUint32(4, true),
    dim = h.getUint32(8, true),
    vb = h.getUint32(12, true);
  let o = 16;
  const words = new TextDecoder().decode(u.subarray(o, o + vb)).split('\n');
  o += vb + ((4 - (vb % 4)) % 4);
  const score = new Float32Array(buf, o, n);
  const scale = new Float32Array(buf, o + n * 4, n);
  const mat = new Int8Array(buf, o + n * 8, n * dim);
  const voc = new Map<string, number>();
  let max = 1;
  words.forEach((w, i) => {
    voc.set(w, i);
    max = Math.max(max, w.length);
  });
  return { dim, max, voc, score, scale, mat };
}

/** Unigram 分词（和 HF tokenizers 的 Viterbi 一致）：认不出的单字记一个很低的分、丢掉 */
export function tokenize(m: Mini, text: string): number[] {
  const s = '▁' + text.normalize('NFKC').trim().replace(/\s+/g, '▁');
  const N = s.length;
  const best = new Float64Array(N + 1).fill(-1e18);
  const from = new Int32Array(N + 1);
  const tok = new Int32Array(N + 1);
  best[0] = 0;
  for (let j = 1; j <= N; j++)
    for (let i = Math.max(0, j - m.max); i < j; i++) {
      if (best[i] < -1e17) continue;
      const k = m.voc.get(s.slice(i, j));
      const v = k != null ? best[i] + m.score[k] : j - i === 1 ? best[i] - 30 : NaN;
      if (v > best[j]) {
        best[j] = v;
        from[j] = i;
        tok[j] = k ?? -1;
      }
    }
  const out: number[] = [];
  for (let j = N; j > 0; j = from[j]) if (tok[j] >= 0) out.push(tok[j]);
  return out.reverse();
}

export function embedOne(m: Mini, text: string): number[] {
  const v = new Float64Array(m.dim);
  for (const k of tokenize(m, text)) {
    const c = m.scale[k],
      o = k * m.dim;
    for (let d = 0; d < m.dim; d++) v[d] += m.mat[o + d] * c;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => Math.round((x / n) * 1e5) / 1e5);
}

let loaded: Promise<Mini> | null = null;
export async function embedTexts(texts: string[]): Promise<number[][]> {
  loaded ||= store()
    .get(MINI_ID)
    .then((b) => {
      if (!b) throw new Error('本机向量模型还没下载');
      return parseMini(b);
    });
  loaded.catch(() => (loaded = null));
  const m = await loaded;
  return texts.map((t) => embedOne(m, t.slice(0, 2000)));
}

async function sha(b: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** 下载（jsDelivr → GitHub raw）→ 核对大小与 SHA-256 → 存进独立的 IndexedDB glean-mini */
export async function downloadMini(onPct?: (p: number) => void): Promise<void> {
  const f = await getFetch();
  const { assertPlug } = await import('./plugs');
  let err = '';
  for (const url of miniUrls()) {
    try {
      assertPlug('mini', url, MINI_HOSTS);
      const r = await f(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rd = r.body?.getReader();
      let buf: ArrayBuffer;
      if (rd) {
        const all = new Uint8Array(MINI_SIZE);
        let n = 0;
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          if (n + value.length > MINI_SIZE) throw new Error('文件大小不对');
          all.set(value, n);
          n += value.length;
          onPct?.(Math.floor((n / MINI_SIZE) * 100));
        }
        buf = all.buffer.slice(0, n);
      } else buf = await r.arrayBuffer();
      if (buf.byteLength !== MINI_SIZE || (await sha(buf)) !== MINI_SHA) throw new Error('校验没通过');
      parseMini(buf);
      await store().put(buf, MINI_ID);
      localStorage.setItem(MINI_KEY, MINI_ID);
      loaded = null;
      return;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error('下载失败：' + err);
}

export async function removeMini(): Promise<void> {
  localStorage.removeItem(MINI_KEY);
  loaded = null;
  await Dexie.delete('glean-mini');
}
