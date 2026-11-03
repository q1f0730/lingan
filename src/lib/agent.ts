// v0.25 本地 API / MCP 的开关与桌面胶水（Rust 命令 api_*、事件 glean-api）。
// 配置存 localStorage（不含令牌：令牌只在系统钥匙串里，点「复制令牌」时才向 Rust 要）。

import { isTauriEnv } from './desktop';

export interface AgentCfg {
  /** 本地 API 开着（默认关） */
  on: boolean;
  port: number;
  /** 允许 Agent 写入（默认关；开了也每次弹窗确认） */
  write: boolean;
}
export const AGENT_KEY = 'glean.agent.v1';
export const DEFAULT_PORT = 47321;
export const AGENT_DEFAULT: AgentCfg = { on: false, port: DEFAULT_PORT, write: false };

export function validPort(p: unknown): number {
  const n = Math.floor(Number(p));
  return Number.isFinite(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_PORT;
}

export function readAgentCfg(s: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): AgentCfg {
  try {
    const o = JSON.parse(s?.getItem(AGENT_KEY) || '{}') || {};
    return { on: o.on === true, port: validPort(o.port ?? DEFAULT_PORT), write: o.write === true };
  } catch {
    return { ...AGENT_DEFAULT };
  }
}

const subs = new Set<(c: AgentCfg) => void>();
export function onAgentCfg(fn: (c: AgentCfg) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function writeAgentCfg(c: AgentCfg) {
  const v = { on: !!c.on, port: validPort(c.port), write: !!c.write };
  try {
    localStorage.setItem(AGENT_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
  for (const f of subs) f(v);
}

/** 本地 API 只有 Windows / 桌面版有（安卓和网页版没有可以常驻监听的本机端口） */
export function apiSupported(): boolean {
  return isTauriEnv() && !(typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent));
}

export interface ApiStatus {
  running: boolean;
  port: number;
  stored: 'keychain' | 'memory';
}

async function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}
export const apiStart = (port: number) => inv<ApiStatus>('api_start', { port });
export const apiStop = () => inv<ApiStatus>('api_stop');
export const apiStatus = () => inv<ApiStatus>('api_status');
export const apiToken = () => inv<string>('api_token');
export const apiRotate = () => inv<ApiStatus>('api_rotate');

export interface BridgeEvent {
  id: number;
  method: string;
  path: string;
  query: string;
  body: string;
  client: string;
  session: string;
}

/** 听 Rust 转来的请求，交给 handler，答完调 api_respond */
export async function listenApi(handler: (e: BridgeEvent) => Promise<{ status: number; body: string; headers?: Array<[string, string]> }>): Promise<() => void> {
  if (!apiSupported()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<BridgeEvent>('glean-api', async (ev) => {
    const e = ev.payload;
    let r: { status: number; body: string; headers?: Array<[string, string]> };
    try {
      r = await handler(e);
    } catch {
      r = { status: 500, body: '{"error":"internal error"}' };
    }
    try {
      await inv('api_respond', { id: e.id, status: r.status, body: r.body, headers: r.headers || null });
    } catch {
      /* Rust 那边已超时 */
    }
  });
}

/** 接入说明里用的片段（令牌用占位符，复制时才填真值） */
export function mcpUrl(port: number) {
  return `http://127.0.0.1:${port}/mcp`;
}
export function claudeCodeCmd(port: number, token = '<令牌>') {
  return `claude mcp add --transport http glean ${mcpUrl(port)} --header "Authorization: Bearer ${token}"`;
}
export function stdioConfig(port: number, token = '<令牌>', script = 'C:/path/to/glean-mcp.mjs') {
  return JSON.stringify({ mcpServers: { glean: { command: 'node', args: [script], env: { GLEAN_PORT: String(port), GLEAN_TOKEN: token } } } }, null, 2);
}
export function httpConfig(port: number, token = '<令牌>') {
  return JSON.stringify({ mcpServers: { glean: { type: 'streamableHttp', url: mcpUrl(port), headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}
