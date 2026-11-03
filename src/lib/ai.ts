import type { Settings } from './settings';
import { embedConfig } from './settings';
import type { ChatBody, OutKind } from './outbound';
import { assertReach } from './gate';
import { MINI } from './privacy';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

let cachedFetch: FetchFn | null = null;
/** v0.34 0905：所有外联都经这里拿 fetch，出站总开关关着时外网地址直接报错（本机 / 局域网照常） */
export async function getFetch(): Promise<FetchFn> {
  const f = await rawFetch();
  return async (i, init) => {
    assertReach(i);
    return f(i, init);
  };
}
async function rawFetch(): Promise<FetchFn> {
  if (cachedFetch) return cachedFetch;
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    try {
      const mod = await import('@tauri-apps/plugin-http');
      cachedFetch = mod.fetch as unknown as FetchFn;
      return cachedFetch;
    } catch {
      /* fall through */
    }
  }
  cachedFetch = (i, init) => fetch(i, init);
  return cachedFetch;
}

function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, '') + path;
}

export class AIError extends Error {
  /** HTTP 状态码；网络错误/超时为 0，其他本地错误为 undefined */
  status?: number;
  /** 服务端给的 Retry-After（毫秒） */
  retryAfterMs?: number;
  constructor(msg: string, status?: number, retryAfterMs?: number) {
    super(msg);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

async function postJSON(url: string, key: string, body0: ChatBody, timeoutMs = 90000, signal?: AbortSignal, kind: OutKind = 'chat'): Promise<unknown> {
  // v0.30 发出去前看一眼（可能去掉图片）+ 出站记录（只记域名 / 种类 / 字段类别 / 字节，不记内容）
  // 出站模块按需加载（ai.ts 在首屏包里，出站逻辑不用跟着进首屏）
  // v0.39 0805 接入清单里停用了 AI 服务：一律不发
  const { plugOn, PLUG_NAME } = await import('./plugs');
  if (!plugOn('ai')) throw new AIError(`「${PLUG_NAME.ai}」已停用：设置 → 出站 → 接入与权限 里打开`);
  const { fieldsOf, gateOutbound, hostOf, OutboundCancel, recordOutbound } = await import('./outbound');
  let body = body0;
  let stripped = 0;
  try {
    const g = await gateOutbound(url, body0, kind);
    body = g.body;
    stripped = g.stripped;
  } catch (e) {
    if (e instanceof OutboundCancel) throw new AIError(e.message);
    throw e;
  }
  const payload = JSON.stringify(body);
  const rec = (ok: boolean) => recordOutbound({ at: Date.now(), host: hostOf(url), kind, fields: fieldsOf(body, kind), bytes: payload.length, ok, ...(stripped ? { stripped } : {}) });
  const f = await getFetch();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      headers: key ? { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } : { 'Content-Type': 'application/json' },
      body: payload,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    rec(false);
    const msg = e instanceof Error ? e.message : String(e);
    if (signal?.aborted) throw new AIError('已取消');
    // v0.20 网络权限收紧：http 只放本机 / 局域网（本地模型），公网必须 https
    if (/not allowed|scope/i.test(msg)) throw new AIError('这个接口地址不在允许范围：公网服务请用 https://；本地模型用 localhost、局域网 IP 或 *.local', 0);
    throw new AIError(msg.includes('abort') ? '请求超时，请检查网络或换个模型' : `网络错误：${msg}`, 0);
  }
  clearTimeout(t);
  rec(res.ok);
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || detail;
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) throw new AIError(`密钥无效或无权限（${res.status}）：${detail}`, res.status);
    const ra = Number(res.headers?.get?.('retry-after'));
    const raMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
    if (res.status === 429) throw new AIError(`请求太频繁或额度用完（429）：${detail}`, 429, raMs);
    throw new AIError(`接口返回 ${res.status}：${detail}`, res.status, raMs);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError('接口返回的不是 JSON');
  }
}

/** 请求里有没有图片（决定出站种类「看图」） */
function hasImage(b: ChatBody): boolean {
  return (b.messages || []).some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
}

export type ChatContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

function extra(s: Settings): Record<string, unknown> {
  if (!s.chat.extraBody) return {};
  try {
    const j = JSON.parse(s.chat.extraBody);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

export async function chat(s: Settings, messages: ChatMsg[], opts: { model?: string; temperature?: number; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
  const body = {
    model: opts.model || s.chat.chatModel,
    messages,
    temperature: opts.temperature ?? s.temperature,
    max_tokens: opts.maxTokens ?? 1600,
    ...extra(s),
  };
  const j = (await postJSON(joinUrl(s.chat.baseUrl, '/chat/completions'), s.chat.apiKey, body as ChatBody, opts.timeoutMs, opts.signal, hasImage(body as ChatBody) ? 'vision' : 'chat')) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = j.choices?.[0]?.message?.content;
  if (typeof out !== 'string' || !out.trim()) throw new AIError('模型没有返回内容');
  return out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function caption(s: Settings, imageDataUrl: string, vocab: string[] = []): Promise<string> {
  if (!s.chat.visionModel) throw new AIError('没有配置看图模型');
  // v0.23 0110：标签只从你已有的词汇里选，实在没有合适的才给新词（新词要你点头才算数）
  const voc = vocab.slice(0, 80);
  const tagRule = voc.length ? `最后给出 3–5 个短标签，尽量只从这些已有标签里选：${voc.join('、')}；实在没有合适的才写新词。格式：标签：a,b,c` : '最后给出5个短标签，格式：标签：a,b,c,d,e';
  return chat(
    s,
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: '用中文描述这张图：画面内容、构图、色彩、光线、情绪与氛围、可能的风格流派。80字以内，' + tagRule },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    { model: s.chat.visionModel, temperature: 0.4, maxTokens: 400 },
  );
}

export async function embed(s: Settings, texts: string[]): Promise<number[][]> {
  const c = embedConfig(s);
  if (!c) throw new AIError('没有配置向量模型');
  if (c.baseUrl === MINI) return (await import('./mini')).embedTexts(texts);
  const j = (await postJSON(joinUrl(c.baseUrl, '/embeddings'), c.apiKey, { model: c.model, input: texts }, 90000, undefined, 'embed')) as {
    data?: Array<{ embedding: number[]; index?: number }>;
  };
  if (!j.data || j.data.length !== texts.length) throw new AIError('向量接口返回数量不对');
  return [...j.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
}

export async function testConnection(s: Settings): Promise<string> {
  const r = await chat(s, [{ role: 'user', content: '只回复两个字：拾穗' }], { temperature: 0, maxTokens: 20 });
  return r.slice(0, 40);
}

/** Extract first JSON object from model output. */
export function parseJSONLoose<T = unknown>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
