// v0.25 Agent 与工程：本地 API + glean-mcp（0806 0807 0809 0836 0838）。
// Rust 端（src-tauri/src/apicore.rs）只听 127.0.0.1、核 Host / Origin / 令牌，然后把请求交给这里：
//   GET  /v1/items?q=&limit=        搜穗（不带 q = 最新的穗）
//   GET  /v1/items/<uid>            读一穗
//   GET  /v1/branches?limit=        列新枝
//   GET  /v1/taste                  口味侧写（markdown）
//   POST /v1/cliches/check          {text} → 撞了套路墙的哪些词、在哪
//   POST /v1/items                  拾一穗（要在 App 里开「允许写入」，每次弹窗确认，进待理、标「Agent 代拾」）
//   POST /mcp                       MCP Streamable HTTP（JSON 应答，无 SSE）
// 私密穗（0242）永远不给 Agent；不返回图片原图和向量。

import { outboundOff } from './gate';
import type { LinganDB } from './db';
import type { Item, Development, ItemType } from './types';
import { parseQuery, searchDocs, toDoc } from './search';
import { computeTaste } from './taste';
import { clicheRegex, enforcedKeys, sortWall } from './wall';
import { recordAudit } from './apiaudit';

export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const AGENT_SOURCE = 'Agent 代拾';
const TYPES: ItemType[] = ['music', 'film', 'image', 'text', 'link', 'idea'];

export interface ApiReq {
  method: string;
  path: string;
  query?: string;
  body?: string;
  client?: string;
  session?: string;
}
export interface ApiRes {
  status: number;
  body: string;
  headers?: Array<[string, string]>;
}
export interface ApiDeps {
  db: LinganDB;
  version: string;
  /** 设置里「允许 Agent 写入」 */
  canWrite: () => boolean;
  /** 每次写入都问本人；false = 拒绝 / 超时 */
  confirmWrite: (client: string, draft: AgentDraft) => Promise<boolean>;
  addItem: (data: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>;
  now?: () => number;
}
export interface AgentDraft {
  type: ItemType;
  title: string;
  content?: string;
  url?: string;
  why?: string;
  creator?: string;
  tags: string[];
}

// ——— 数据整形 ———
const iso = (t?: number) => (t ? new Date(t).toISOString() : undefined);
const cut = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s || undefined);

export function visible(it: Item): boolean {
  return !it.deletedAt && !it.private && !it.locked;
}

export function itemOut(it: Item, full = false) {
  return {
    id: it.uid || `local-${it.id}`,
    n: it.id,
    type: it.type,
    title: it.title,
    creator: it.creator || undefined,
    year: it.year || undefined,
    why: it.why || undefined,
    tags: it.tags,
    url: it.url || undefined,
    content: cut(it.content, full ? 4000 : 280),
    caption: full ? it.caption || undefined : undefined,
    source: it.source || undefined,
    dislike: it.polarity === -1 ? true : undefined,
    inbox: it.inbox ? true : undefined,
    hasImage: it.hasImage ? true : undefined,
    createdAt: iso(it.createdAt),
  };
}

export function branchOut(d: Development, byId: Map<number, Item>) {
  return {
    id: d.uid || `local-${d.id}`,
    title: d.idea.title,
    bridge: d.idea.bridge,
    idea: d.idea.idea,
    form: d.idea.form || undefined,
    firstStep: d.idea.firstStep || undefined,
    experiment: d.idea.experiment || undefined,
    starred: d.starred ? true : undefined,
    mode: d.mode || undefined,
    refs: d.itemIds
      .map((id) => byId.get(id))
      .filter((x): x is Item => !!x && visible(x))
      .map((x) => ({ id: x.uid || `local-${x.id}`, title: x.title })),
    createdAt: iso(d.createdAt),
  };
}

async function liveVisible(db: LinganDB): Promise<Item[]> {
  return (await db.items.toArray()).filter(visible);
}

export async function searchItems(db: LinganDB, q: string, limit = 20, type?: string): Promise<Item[]> {
  let items = await liveVisible(db);
  if (type && (TYPES as string[]).includes(type)) items = items.filter((i) => i.type === type);
  const n = Math.max(1, Math.min(100, Math.floor(limit) || 20));
  const terms = parseQuery(q || '');
  if (!terms.length) return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, n);
  return searchDocs(null, items.map((i) => toDoc('i', i)), terms)
    .slice(0, n)
    .map((h) => h.doc.obj);
}

export async function getItem(db: LinganDB, id: string): Promise<Item | null> {
  const s = String(id || '').trim();
  let it: Item | undefined;
  const m = /^local-(\d+)$/.exec(s) || /^(\d+)$/.exec(s);
  if (m) it = await db.items.get(Number(m[1]));
  else if (s) it = await db.items.where('uid').equals(s).first();
  return it && visible(it) ? it : null;
}

export async function listBranches(db: LinganDB, limit = 20, starred = false) {
  const devs = (await db.developments.toArray()).filter((d) => !d.deletedAt && (!starred || d.starred)).sort((a, b) => b.createdAt - a.createdAt);
  const n = Math.max(1, Math.min(100, Math.floor(limit) || 20));
  const pick = devs.slice(0, n);
  const ids = new Set(pick.flatMap((d) => d.itemIds));
  const byId = new Map<number, Item>();
  for (const it of await db.items.bulkGet([...ids])) if (it?.id != null) byId.set(it.id, it);
  return pick.map((d) => branchOut(d, byId));
}

/** 0809 口味侧写：高频标签、最近 30 天升温 / 冷下来、常拾的作者、套路墙前 30 条 */
export async function tasteMarkdown(db: LinganDB, now = Date.now()): Promise<string> {
  const items = (await liveVisible(db)).filter((i) => i.polarity !== -1 && !i.sample);
  const dislikes = (await liveVisible(db)).filter((i) => i.polarity === -1);
  const t = computeTaste(items, now);
  const day = 86400000;
  const recent = new Map<string, number>();
  const before = new Map<string, number>();
  for (const it of items) {
    const age = now - it.createdAt;
    const m = age <= 30 * day ? recent : age <= 120 * day ? before : null;
    if (m) for (const g of it.tags) m.set(g, (m.get(g) || 0) + 1);
  }
  const warming = [...recent.entries()].filter(([g, n]) => n >= 2 && n / 30 > ((before.get(g) || 0) / 90) * 1.5).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const cooling = [...before.entries()].filter(([g, n]) => n >= 3 && !recent.has(g)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const wall = sortWall((await db.cliches.toArray()).filter((c) => !c.struck)).slice(0, 30);
  const L: string[] = [];
  L.push('# 拾穗 · 我的口味侧写', '', `共 ${t.total} 穗（私密穗不计入）。`);
  const types = Object.entries(t.byType).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ');
  if (types) L.push(`类型：${types}`);
  if (t.topTags.length) L.push('', '## 高频标签', t.topTags.map(([g, n]) => `${g}(${n})`).join('、'));
  if (warming.length) L.push('', '## 最近 30 天升温', warming.map(([g, n]) => `${g}(+${n})`).join('、'));
  if (cooling.length) L.push('', '## 冷下来（30–120 天前常拾，最近没有）', cooling.map(([g]) => g).join('、'));
  if (t.topCreators.length) L.push('', '## 常拾的作者', t.topCreators.map(([g, n]) => `${g}(${n})`).join('、'));
  if (t.whyWords.length) L.push('', '## 「为什么」里常出现的词', t.whyWords.map(([g]) => g).join('、'));
  if (dislikes.length) L.push('', '## 我讨厌的（反口味，别往这个方向写）', dislikes.slice(0, 12).map((i) => i.title).join('、'));
  if (wall.length) L.push('', '## 套路墙（写东西时避开这些说法）', wall.map((c) => c.text).join('、'));
  return L.join('\n');
}

/** 0836 套路墙作为禁用词服务：命中的词、原文位置 */
export async function checkCliches(db: LinganDB, text: string): Promise<Array<{ text: string; at: number; len: number }>> {
  const src = String(text || '').normalize('NFKC').slice(0, 50000);
  const keys = enforcedKeys(await db.cliches.toArray());
  const out: Array<{ text: string; at: number; len: number }> = [];
  for (const k of keys) {
    const re = clicheRegex(k);
    if (!re) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) && out.length < 500) {
      const at = m.index;
      const end = at + m[0].length;
      // 键按长到短排：已被更长的词盖住的位置不再重复报
      if (!out.some((h) => at < h.at + h.len && end > h.at)) out.push({ text: m[0], at, len: m[0].length });
      if (!m[0].length) re.lastIndex++;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function parseDraft(a: Record<string, unknown>): AgentDraft | string {
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const title = str(a.title, 200);
  const content = str(a.content, 10000);
  const url = str(a.url, 2000);
  if (!title && !content && !url) return 'title / content / url 至少要一个';
  if (url && !/^https?:\/\//i.test(url)) return 'url 只收 http(s)';
  const type = (TYPES as string[]).includes(String(a.type)) && a.type !== 'image' ? (a.type as ItemType) : url && !content ? 'link' : 'text';
  const tags = Array.isArray(a.tags) ? a.tags.map((x) => str(x, 30)).filter(Boolean).slice(0, 12) : [];
  return { type, title: title || (content || url).slice(0, 40), content: content || undefined, url: url || undefined, why: str(a.why, 1000) || undefined, creator: str(a.creator, 120) || undefined, tags };
}

async function writeItem(deps: ApiDeps, client: string, a: Record<string, unknown>): Promise<{ ok: true; id: string; n: number } | { ok: false; status: number; error: string }> {
  // v0.34 0905 出站总开关关着：Agent 写入一律停用（读还在，本地 API 只在本机）
  if (outboundOff()) return { ok: false, status: 403, error: '拾穗关了出站总开关：Agent 写入已停用' };
  if (!deps.canWrite()) return { ok: false, status: 403, error: '拾穗没开「允许 Agent 写入」：请本人在 设置 → Agent 与 API 里打开' };
  const d = parseDraft(a);
  if (typeof d === 'string') return { ok: false, status: 400, error: d };
  const yes = await deps.confirmWrite(client, d);
  if (!yes) return { ok: false, status: 403, error: '本人没有同意这次写入' };
  const id = await deps.addItem({ ...d, source: `${AGENT_SOURCE} · ${client || '未知客户端'}` });
  const row = await deps.db.items.get(id);
  return { ok: true, id: row?.uid || `local-${id}`, n: id };
}

// ——— MCP ———
const READ_TOOLS = [
  {
    name: 'search_items',
    title: '搜穗',
    description: '在拾穗穗仓里全文搜索（标题、作者、内容、为什么、标签）。不给 query 就返回最新的穗。私密穗不会出现。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词；中文按连续短语匹配，英文按词前缀；多个词是 AND' },
        type: { type: 'string', enum: TYPES, description: '只看某一类' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_item',
    title: '读穗',
    description: '按 id（search_items 返回的 id）读一穗的完整内容。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_branches',
    title: '列新枝',
    description: '列出嫁接长出的新枝（创意），最新的在前；refs 是它用到的穗。',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, starred: { type: 'boolean', description: '只看星标的' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_taste',
    title: '口味侧写',
    description: '主人的口味侧写（markdown）：高频标签、最近升温 / 冷下来、常拾的作者、反口味和套路墙。帮他写东西前先读它。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'check_cliches',
    title: '查套路',
    description: '用主人的套路墙检查一段文字，返回撞到的说法和位置（at = 字符下标）。',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: true },
  },
];
const WRITE_TOOL = {
  name: 'add_item',
  title: '代拾一穗',
  description: '替主人拾一穗。每次都会在拾穗 App 里弹窗等本人点「允许」（最多等 3 分钟）；收下的穗进「待理」并标「Agent 代拾」，不会直接进穗仓。',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content: { type: 'string', description: '摘抄 / 正文' },
      url: { type: 'string' },
      why: { type: 'string', description: '为什么值得拾（最好用主人的口吻，一句话）' },
      creator: { type: 'string' },
      type: { type: 'string', enum: ['music', 'film', 'text', 'link', 'idea'] },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
};

export function mcpTools(write: boolean) {
  return write ? [...READ_TOOLS, WRITE_TOOL] : READ_TOOLS;
}

const sessions = new Map<string, string>();
function newSession(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

type Json = Record<string, unknown>;
const rpcOk = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const textResult = (data: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }],
  ...(isError ? { isError: true } : typeof data === 'string' ? {} : { structuredContent: Array.isArray(data) ? { items: data } : data }),
});

/** 调一个工具 → [MCP 结果, 返回了几穗（审计用）] */
export async function callTool(deps: ApiDeps, client: string, name: string, args: Json): Promise<[unknown, number]> {
  const { db } = deps;
  switch (name) {
    case 'search_items': {
      const list = await searchItems(db, String(args.query ?? ''), Number(args.limit ?? 20), args.type ? String(args.type) : undefined);
      return [textResult(list.map((i) => itemOut(i))), list.length];
    }
    case 'get_item': {
      const it = await getItem(db, String(args.id ?? ''));
      return it ? [textResult(itemOut(it, true)), 1] : [textResult('没有这一穗（或它是私密穗）', true), 0];
    }
    case 'list_branches': {
      const list = await listBranches(db, Number(args.limit ?? 20), !!args.starred);
      return [textResult(list), list.reduce((s, b) => s + b.refs.length, 0)];
    }
    case 'get_taste':
      return [textResult(await tasteMarkdown(db, deps.now?.())), 0];
    case 'check_cliches': {
      const hits = await checkCliches(db, String(args.text ?? ''));
      return [textResult({ count: hits.length, hits }), 0];
    }
    case 'add_item': {
      if (!deps.canWrite()) return [textResult('拾穗没开「允许 Agent 写入」', true), 0];
      const r = await writeItem(deps, client, args);
      return r.ok ? [textResult({ ok: true, id: r.id, note: '已进待理，标「Agent 代拾」' }), 0] : [textResult(r.error, true), 0];
    }
  }
  throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
}

export async function handleMcpMessage(deps: ApiDeps, msg: Json, client: string): Promise<{ reply: unknown | null; session?: string; client: string; tool?: string; n?: number }> {
  const id = msg.id;
  const method = String(msg.method || '');
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Json;
  if (msg.jsonrpc !== '2.0' || !method) return { reply: id === undefined ? null : rpcErr(id, -32600, 'invalid request'), client };
  if (id === undefined) return { reply: null, client }; // 通知（notifications/initialized 等）
  switch (method) {
    case 'initialize': {
      const want = String(params.protocolVersion || '');
      const ci = (params.clientInfo || {}) as Json;
      const name = String(ci.name || client || '').slice(0, 60);
      const sid = newSession();
      sessions.set(sid, name);
      if (sessions.size > 200) sessions.delete(sessions.keys().next().value!);
      return {
        reply: rpcOk(id, {
          protocolVersion: MCP_PROTOCOLS.includes(want) ? want : MCP_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: 'glean', title: '拾穗 Glean', version: deps.version },
          instructions: '这是主人的私人灵感穗仓（拾穗 Glean）。默认只读：search_items / get_item / list_branches / get_taste / check_cliches。写东西前可先读 get_taste，写完用 check_cliches 查套路。引用穗时带上它的 id。',
        }),
        session: sid,
        client: name,
      };
    }
    case 'ping':
      return { reply: rpcOk(id, {}), client };
    case 'tools/list':
      return { reply: rpcOk(id, { tools: mcpTools(deps.canWrite()) }), client };
    case 'resources/list':
      return { reply: rpcOk(id, { resources: [{ uri: 'glean://taste', name: 'taste', title: '口味侧写', description: '高频标签、升温 / 冷下来、常拾的作者、反口味、套路墙前 30 条', mimeType: 'text/markdown' }] }), client };
    case 'resources/templates/list':
      return { reply: rpcOk(id, { resourceTemplates: [] }), client };
    case 'prompts/list':
      return { reply: rpcOk(id, { prompts: [] }), client };
    case 'resources/read': {
      if (params.uri !== 'glean://taste') return { reply: rpcErr(id, -32002, 'resource not found'), client };
      return { reply: rpcOk(id, { contents: [{ uri: 'glean://taste', mimeType: 'text/markdown', text: await tasteMarkdown(deps.db, deps.now?.()) }] }), client, tool: 'resource:taste', n: 0 };
    }
    case 'tools/call': {
      const name = String(params.name || '');
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json;
      if (!mcpTools(deps.canWrite()).some((t) => t.name === name)) return { reply: rpcErr(id, -32602, `unknown tool: ${name}`), client, tool: name, n: 0 };
      try {
        const [res, n] = await callTool(deps, client, name, args);
        return { reply: rpcOk(id, res), client, tool: name, n };
      } catch (e) {
        return { reply: rpcOk(id, textResult(`出错：${(e as Error).message}`, true)), client, tool: name, n: 0 };
      }
    }
  }
  return { reply: rpcErr(id, -32601, `method not found: ${method}`), client };
}

const json = (status: number, data: unknown, headers?: Array<[string, string]>): ApiRes => ({ status, body: JSON.stringify(data), headers });

/** 本地 API 总入口（Rust 转来的每个请求） */
export async function handleApi(req: ApiReq, deps: ApiDeps): Promise<ApiRes> {
  const now = deps.now ? deps.now() : Date.now();
  let client = (req.client || '').slice(0, 60) || '未知客户端';
  const audit = (tool: string, n: number, ok: boolean) => recordAudit({ t: now, client, tool, n, ok });
  const q = new URLSearchParams(req.query || '');
  let body: Json = {};
  if (req.body) {
    try {
      body = JSON.parse(req.body);
    } catch {
      return json(400, { error: 'body 不是 JSON' });
    }
  }
  const m = req.method.toUpperCase();
  const p = req.path.replace(/\/+$/, '') || '/';
  try {
    if (p === '/mcp') {
      if (m !== 'POST') return json(405, { error: '只支持 POST（JSON 应答，不开 SSE）' });
      if (req.session && sessions.has(req.session)) client = sessions.get(req.session) || client;
      if (Array.isArray(body)) return json(400, rpcErr(null, -32600, 'batch not supported'));
      const r = await handleMcpMessage(deps, body, client);
      if (r.tool) recordAudit({ t: now, client: r.client || client, tool: r.tool, n: r.n || 0, ok: !(r.reply as Json)?.error && !((r.reply as Json)?.result as Json)?.isError });
      if (r.reply === null) return { status: 202, body: '' };
      return json(200, r.reply, r.session ? [['Mcp-Session-Id', r.session]] : undefined);
    }
    if (p === '/v1/items' && m === 'GET') {
      const list = await searchItems(deps.db, q.get('q') || '', Number(q.get('limit') || 20), q.get('type') || undefined);
      audit('search_items', list.length, true);
      return json(200, { items: list.map((i) => itemOut(i)) });
    }
    if (p.startsWith('/v1/items/') && m === 'GET') {
      const it = await getItem(deps.db, decodeURIComponent(p.slice('/v1/items/'.length)));
      audit('get_item', it ? 1 : 0, !!it);
      return it ? json(200, itemOut(it, true)) : json(404, { error: 'not found' });
    }
    if (p === '/v1/branches' && m === 'GET') {
      const list = await listBranches(deps.db, Number(q.get('limit') || 20), q.get('starred') === '1');
      audit('list_branches', list.reduce((s, b) => s + b.refs.length, 0), true);
      return json(200, { branches: list });
    }
    if (p === '/v1/taste' && m === 'GET') {
      audit('get_taste', 0, true);
      return json(200, { markdown: await tasteMarkdown(deps.db, now) });
    }
    if (p === '/v1/cliches/check' && m === 'POST') {
      const hits = await checkCliches(deps.db, String(body.text ?? ''));
      audit('check_cliches', 0, true);
      return json(200, { count: hits.length, hits });
    }
    if (p === '/v1/items' && m === 'POST') {
      const r = await writeItem(deps, client, body);
      audit('add_item', 0, r.ok);
      return r.ok ? json(201, { id: r.id, inbox: true }) : json(r.status, { error: r.error });
    }
    if (p === '/v1' || p === '/') return json(200, { app: 'glean', version: deps.version, write: deps.canWrite(), endpoints: ['GET /v1/items?q=', 'GET /v1/items/:id', 'GET /v1/branches', 'GET /v1/taste', 'POST /v1/cliches/check', 'POST /v1/items', 'POST /mcp'] });
    return json(404, { error: 'no such endpoint' });
  } catch (e) {
    return json(500, { error: (e as Error).message || 'internal error' });
  }
}
