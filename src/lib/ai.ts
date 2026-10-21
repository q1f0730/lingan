import type { Settings } from './settings';
import { embedConfig } from './settings';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

let cachedFetch: FetchFn | null = null;
async function getFetch(): Promise<FetchFn> {
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

export class AIError extends Error {}

async function postJSON(url: string, key: string, body: unknown, timeoutMs = 90000): Promise<unknown> {
  const f = await getFetch();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    throw new AIError(msg.includes('abort') ? '请求超时，请检查网络或换个模型' : `网络错误：${msg}`);
  }
  clearTimeout(t);
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || detail;
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) throw new AIError(`密钥无效或无权限（${res.status}）：${detail}`);
    if (res.status === 429) throw new AIError(`请求太频繁或额度用完（429）：${detail}`);
    throw new AIError(`接口返回 ${res.status}：${detail}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError('接口返回的不是 JSON');
  }
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

export async function chat(s: Settings, messages: ChatMsg[], opts: { model?: string; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const body = {
    model: opts.model || s.chat.chatModel,
    messages,
    temperature: opts.temperature ?? s.temperature,
    max_tokens: opts.maxTokens ?? 1600,
    ...extra(s),
  };
  const j = (await postJSON(joinUrl(s.chat.baseUrl, '/chat/completions'), s.chat.apiKey, body)) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = j.choices?.[0]?.message?.content;
  if (typeof out !== 'string' || !out.trim()) throw new AIError('模型没有返回内容');
  return out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function caption(s: Settings, imageDataUrl: string): Promise<string> {
  if (!s.chat.visionModel) throw new AIError('没有配置看图模型');
  return chat(
    s,
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: '用中文描述这张图：画面内容、构图、色彩、光线、情绪与氛围、可能的风格流派。80字以内，最后给出5个短标签，格式：标签：a,b,c,d,e' },
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
  const j = (await postJSON(joinUrl(c.baseUrl, '/embeddings'), c.apiKey, { model: c.model, input: texts })) as {
    data?: Array<{ embedding: number[]; index?: number }>;
  };
  if (!j.data || j.data.length !== texts.length) throw new AIError('向量接口返回数量不对');
  return [...j.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
}

export async function testConnection(s: Settings): Promise<string> {
  const r = await chat(s, [{ role: 'user', content: '只回复两个字：显影' }], { temperature: 0, maxTokens: 20 });
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
