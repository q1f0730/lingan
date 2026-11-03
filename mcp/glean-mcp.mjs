#!/usr/bin/env node
// 拾穗 Glean · glean-mcp（v0.25，Q1f730，MIT）
// 单文件、零依赖，Node 18+。两种用法：
//   1) MCP stdio 桥：给只支持 stdio 的客户端用。把 stdin 的 JSON-RPC 逐行转给拾穗桌面版的本地 API（http://127.0.0.1:端口/mcp）
//      {"mcpServers":{"glean":{"command":"node","args":["/path/glean-mcp.mjs"],"env":{"GLEAN_TOKEN":"…","GLEAN_PORT":"47321"}}}}
//   2) 命令行：node glean-mcp.mjs search 雨 [--json] | get <id> | branches | taste | lint <文件|-> | add --title … [--url … --why … --tag a --tag b]
// 令牌：拾穗 → 设置 → Agent 与 API → 复制令牌。读 GLEAN_TOKEN 环境变量或 --token。不会把令牌写进任何文件或输出。
import { readFileSync } from 'node:fs';

const VERSION = '0.25.0';
const argv = process.argv.slice(2);
function opt(name) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
function opts(name) {
  const out = [];
  for (let v = opt(name); v !== undefined; v = opt(name)) out.push(v);
  return out;
}
const TOKEN = opt('token') || process.env.GLEAN_TOKEN || '';
const PORT = Number(opt('port') || process.env.GLEAN_PORT || 47321);
const BASE = `http://127.0.0.1:${PORT}`;
const JSON_OUT = argv.includes('--json') ? (argv.splice(argv.indexOf('--json'), 1), true) : false;

async function call(method, path, body, extra = {}) {
  const headers = { Authorization: `Bearer ${TOKEN}`, 'X-Glean-Client': extra.client || 'glean-cli', Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
  if (extra.session) headers['Mcp-Session-Id'] = extra.session;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, text, session: r.headers.get('mcp-session-id') || '' };
}

const DOWN = `连不上拾穗（${BASE}）：请打开拾穗 Windows 版，在 设置 → Agent 与 API 里打开「本地 API」，端口和这里一致`;

// ——— stdio 桥 ———
async function bridge() {
  let session = '';
  let client = 'stdio';
  let buf = '';
  let queue = Promise.resolve();
  const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const handle = async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    if (msg && msg.method === 'initialize' && msg.params?.clientInfo?.name) client = String(msg.params.clientInfo.name).slice(0, 60);
    try {
      const r = await call('POST', '/mcp', msg, { client, session });
      if (r.session) session = r.session;
      if (r.status === 202 || !r.text) return;
      if (r.status === 401) throw new Error('令牌不对：在拾穗 设置 → Agent 与 API 里重新复制令牌');
      if (r.status >= 500 && msg.id !== undefined) throw new Error(`拾穗没有响应（HTTP ${r.status}），确认主窗口开着`);
      process.stdout.write(r.text.trim() + '\n');
    } catch (e) {
      const m = e?.cause?.code === 'ECONNREFUSED' || /fetch failed/.test(String(e?.message)) ? DOWN : e.message;
      if (msg && msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: m } });
      else process.stderr.write(m + '\n');
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) queue = queue.then(() => handle(line));
    }
  });
  process.stdin.on('end', () => queue.then(() => process.exit(0)));
}

// ——— 命令行 ———
function out(data, human) {
  if (JSON_OUT || typeof human !== 'function') console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  else console.log(human(data));
}
async function rest(method, path, body) {
  let r;
  try {
    r = await call(method, path, body);
  } catch {
    console.error(DOWN);
    process.exit(2);
  }
  let data = null;
  try {
    data = JSON.parse(r.text);
  } catch {
    data = r.text;
  }
  if (r.status >= 400) {
    console.error(`HTTP ${r.status}: ${data?.error || r.text}`);
    process.exit(1);
  }
  return data;
}
const line = (i) => `${i.id}  [${i.type}] ${i.title}${i.creator ? ' — ' + i.creator : ''}${i.why ? '\n    为什么：' + i.why : ''}${i.tags?.length ? '\n    ' + i.tags.map((t) => '#' + t).join(' ') : ''}`;

async function cli(cmd, rest_) {
  if (!TOKEN) {
    console.error('缺令牌：设置环境变量 GLEAN_TOKEN 或加 --token（拾穗 → 设置 → Agent 与 API → 复制令牌）');
    process.exit(2);
  }
  switch (cmd) {
    case 'search': {
      const q = rest_.join(' ');
      const d = await rest('GET', `/v1/items?q=${encodeURIComponent(q)}&limit=${opt('limit') || 20}`);
      return out(d.items, (xs) => (xs.length ? xs.map(line).join('\n') : '没找到'));
    }
    case 'get':
      return out(await rest('GET', `/v1/items/${encodeURIComponent(rest_[0] || '')}`), (i) => line(i) + (i.content ? '\n\n' + i.content : ''));
    case 'branches': {
      const d = await rest('GET', `/v1/branches?limit=${opt('limit') || 20}`);
      return out(d.branches, (xs) => xs.map((b) => `${b.id}  ${b.title}\n    ${b.idea}`).join('\n'));
    }
    case 'taste': {
      const d = await rest('GET', '/v1/taste');
      return out(JSON_OUT ? d : d.markdown, (m) => m);
    }
    case 'lint': {
      const f = rest_[0] || '-';
      const text = f === '-' ? readFileSync(0, 'utf8') : readFileSync(f, 'utf8');
      const d = await rest('POST', '/v1/cliches/check', { text });
      out(d, (r) => {
        if (!r.count) return '没撞套路墙';
        return r.hits
          .map((h) => {
            const before = text.slice(0, h.at);
            const ln = before.split('\n').length;
            const col = h.at - before.lastIndexOf('\n');
            return `${f}:${ln}:${col}  ${h.text}`;
          })
          .join('\n');
      });
      return process.exit(d.count ? 1 : 0);
    }
    case 'add': {
      const body = { title: opt('title'), content: opt('content'), url: opt('url'), why: opt('why'), type: opt('type'), creator: opt('creator'), tags: opts('tag') };
      console.error('等你在拾穗里点「允许」…');
      const d = await rest('POST', '/v1/items', body);
      return out(d, (r) => `已进待理：${r.id}`);
    }
    default:
      console.log(`glean-mcp ${VERSION}
用法：
  node glean-mcp.mjs                      MCP stdio 桥（给 Agent 客户端用）
  node glean-mcp.mjs search <关键词> [--json] [--limit 20]
  node glean-mcp.mjs get <id>
  node glean-mcp.mjs branches
  node glean-mcp.mjs taste
  node glean-mcp.mjs lint <文件.md | ->     用套路墙检查文字，撞了退出码 1
  node glean-mcp.mjs add --title … [--url … --content … --why … --tag a --tag b]   需在拾穗里开写入并点允许
环境变量：GLEAN_TOKEN（必填）、GLEAN_PORT（默认 47321）`);
  }
}

const [cmd, ...rest_] = argv;
if (!cmd) {
  if (!TOKEN) process.stderr.write('glean-mcp: 缺 GLEAN_TOKEN 环境变量，所有请求都会被拒\n');
  bridge();
} else cli(cmd, rest_);
