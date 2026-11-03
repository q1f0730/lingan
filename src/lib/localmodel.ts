// v0.24 0208 / 0209 本地模型：一键探测 LM Studio（:1234）/ Ollama（:11434），读 /v1/models 选模型；
// 手机填电脑的局域网 IP 调用电脑上的模型（只放局域网 / 本机地址，http 不出公网）。
// 两家都提供 OpenAI 兼容接口（/v1/chat/completions、/v1/embeddings），接上之后和云端模型走同一条路。
import { getFetch } from './ai';
import { isLocalHost } from './privacy';
export { aiVisible, allowPrivate, isLocalBaseUrl, isLocalHost } from './privacy';

export type LocalKind = 'lmstudio' | 'ollama';
export interface LocalServer {
  kind: LocalKind;
  name: string;
  port: number;
  /** 让手机连得上要在电脑上做的事 */
  lanTip: string;
}
export const LOCAL_SERVERS: LocalServer[] = [
  { kind: 'lmstudio', name: 'LM Studio', port: 1234, lanTip: 'LM Studio → Developer → 打开「Serve on Local Network」（监听 0.0.0.0:1234）' },
  { kind: 'ollama', name: 'Ollama', port: 11434, lanTip: 'Ollama 默认只听本机：设置环境变量 OLLAMA_HOST=0.0.0.0 和 OLLAMA_ORIGINS=* 后重启 Ollama' },
];
const BY_KIND = new Map(LOCAL_SERVERS.map((s) => [s.kind, s]));
export function serverOf(kind: LocalKind): LocalServer {
  return BY_KIND.get(kind)!;
}

/**
 * 把用户填的地址（「192.168.1.5」「192.168.1.5:1234」「http://pc.local:11434/v1」）规范成 http://host:port。
 * 不是本机 / 局域网的返回 null（http 不出公网）。没写端口就用这一家的默认端口。
 */
export function normalizeHost(input: string, kind: LocalKind): { origin: string; host: string; port: number } | null {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'http://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname;
  if (!isLocalHost(host)) return null;
  const port = u.port ? Number(u.port) : serverOf(kind).port;
  const h = host.includes(':') ? `[${host}]` : host;
  return { origin: `${u.protocol}//${h}:${port}`, host, port };
}

export function baseUrlOf(origin: string): string {
  return origin.replace(/\/+$/, '') + '/v1';
}

export interface ProbeResult {
  kind: LocalKind;
  name: string;
  origin: string;
  baseUrl: string;
  ok: boolean;
  models: string[];
  ms: number;
  error?: string;
}

const EMBED_RE = /embed|bge|e5-|gte-|nomic|minilm|text-embedding/i;
const VISION_RE = /vl\b|vl-|-vl|vision|llava|minicpm-v|gemma-?3|qwen2\.5-?vl|qwen3-?vl|pixtral|moondream|glm-4\.?\dv/i;
export function isEmbedModel(id: string): boolean {
  return EMBED_RE.test(id);
}
/** 对话模型：不是向量模型的那些（原顺序） */
export function chatModels(models: string[]): string[] {
  return models.filter((m) => !isEmbedModel(m));
}
export function embedModels(models: string[]): string[] {
  return models.filter(isEmbedModel);
}
/** 推荐：对话用第一个不是向量模型的；看图用名字里像多模态的；向量用第一个向量模型 */
export function suggestModels(models: string[]): { chat: string; vision: string; embed: string } {
  const c = chatModels(models);
  return { chat: c[0] || '', vision: c.find((m) => VISION_RE.test(m)) || '', embed: embedModels(models)[0] || '' };
}

/** 解析 /v1/models（OpenAI 兼容：{data:[{id}]}）或 Ollama 原生 /api/tags（{models:[{name}]}） */
export function parseModels(j: unknown): string[] {
  const o = (j && typeof j === 'object' ? j : {}) as { data?: Array<{ id?: unknown }>; models?: Array<{ name?: unknown; model?: unknown }> };
  const out: string[] = [];
  for (const m of o.data || []) if (typeof m?.id === 'string') out.push(m.id);
  for (const m of o.models || []) {
    const n = typeof m?.name === 'string' ? m.name : typeof m?.model === 'string' ? m.model : '';
    if (n) out.push(n);
  }
  return [...new Set(out)];
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

async function getJSON(f: FetchFn, url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await f(url, { method: 'GET', signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** 探测一台机器上的一家服务：先 /v1/models，Ollama 再试 /api/tags。不抛错，结果里写 ok / error */
export async function probeServer(origin: string, kind: LocalKind, opts: { fetch?: FetchFn; timeoutMs?: number } = {}): Promise<ProbeResult> {
  const f = opts.fetch || (await getFetch());
  const timeoutMs = opts.timeoutMs ?? 1500;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const s = serverOf(kind);
  const base = baseUrlOf(origin);
  const done = (ok: boolean, models: string[], error?: string): ProbeResult => ({
    kind,
    name: s.name,
    origin,
    baseUrl: base,
    ok,
    models,
    ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
    ...(error ? { error } : {}),
  });
  let firstErr = '';
  try {
    const models = parseModels(await getJSON(f, base + '/models', timeoutMs));
    return done(true, models);
  } catch (e) {
    firstErr = probeError(e);
  }
  if (kind === 'ollama') {
    try {
      const models = parseModels(await getJSON(f, origin.replace(/\/+$/, '') + '/api/tags', timeoutMs));
      return done(true, models);
    } catch {
      /* 用第一次的错误 */
    }
  }
  return done(false, [], firstErr);
}

function probeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(m)) return '没有回应（超时）';
  if (/not allowed|scope/i.test(m)) return '这个地址不在允许范围（只能连本机或局域网）';
  if (/HTTP \d+/.test(m)) return m.replace('HTTP', '接口返回');
  return '连不上（没开、端口不对，或没打开局域网访问）';
}

/** 一键探测：对每个主机同时试 LM Studio 与 Ollama 的默认端口。hosts 默认本机 */
export async function probeLocal(hosts: string[] = ['127.0.0.1'], opts: { fetch?: FetchFn; timeoutMs?: number; kinds?: LocalKind[] } = {}): Promise<ProbeResult[]> {
  const kinds = opts.kinds || LOCAL_SERVERS.map((s) => s.kind);
  const jobs: Array<Promise<ProbeResult>> = [];
  for (const h of hosts) {
    for (const k of kinds) {
      const n = normalizeHost(h, k);
      if (n) jobs.push(probeServer(n.origin, k, opts));
    }
  }
  return Promise.all(jobs);
}

