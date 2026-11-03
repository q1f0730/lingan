// v0.32 局域网直连的参考服务（Node，无依赖）：协议与 src-tauri/src/lancore.rs 一致，e2e 用它当「电脑上的柜子」，
// vitest 用它测 LanTransport 的真实 HTTP 往返。另带 /__admin/*（只有测试用）：浏览器里的模拟电脑经它开柜子 / 放配对包 / 收变更通知。
// 用法：node e2e/lanmock.mjs <端口>   或   import { startLanMock } from './lanmock.mjs'
import http from 'node:http';
import crypto from 'node:crypto';

const SKEW_MS = 5 * 60_000;
const SEG = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$/;
const pathOk = (p, max, empty) => (p === '' ? empty : p.split('/').length <= max && p.split('/').every((s) => SEG.test(s)));

export function sign(keyHex, method, url, ts = Date.now(), nonce = crypto.randomBytes(12).toString('hex')) {
  const sig = crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(`${method}\n${url}\n${ts}\n${nonce}`).digest('hex');
  return `${ts}.${nonce}.${sig}`;
}

export function startLanMock(port = 0) {
  const files = new Map(); // path -> { b: Buffer, v: number }
  let auth = null;
  let offer = null;
  let ver = 0;
  const nonces = new Map();
  const changes = [];
  const stats = { requests: 0, bytesIn: 0, bytesOut: 0, puts: 0, gets: 0, lists: 0, rejected: 0 };
  const verify = (keyHex, h, method, url) => {
    if (!h) return 'unsigned';
    const [ts, nonce, sig] = h.split('.');
    const now = Date.now();
    if (!/^\d+$/.test(ts || '') || !/^[A-Za-z0-9]{8,64}$/.test(nonce || '')) return 'bad signature';
    if (Math.abs(now - Number(ts)) > SKEW_MS) return 'clock skew';
    const want = crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(`${method}\n${url}\n${ts}\n${nonce}`).digest('hex');
    if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return 'bad signature';
    for (const [k, t] of nonces) if (t + 600_000 < now) nonces.delete(k);
    if (nonces.has(nonce)) return 'replay';
    nonces.set(nonce, now);
    return null;
  };
  const changed = (p) => changes.push({ n: changes.length + 1, path: p });
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-Glean-Lan, If-None-Match, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS', 'Access-Control-Expose-Headers': '*' };
      const send = (status, data, type = 'application/json') => {
        const b = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
        stats.bytesOut += b.length;
        res.writeHead(status, { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(b);
      };
      if (req.method === 'OPTIONS') return send(204, '');
      const url = req.url || '/';
      const [path, query = ''] = url.split('?');
      // ── 测试用的管理口（真的 Rust 柜子没有这些） ──
      if (path.startsWith('/__admin/')) {
        const j = body.length ? JSON.parse(body.toString()) : {};
        if (path === '/__admin/start') {
          auth = j.keyHex;
          return send(200, { port: server.address().port, addrs: ['127.0.0.1'] });
        }
        if (path === '/__admin/stop') {
          auth = null;
          offer = null;
          return send(200, { ok: true });
        }
        if (path === '/__admin/offer') {
          offer = { auth: j.authHex, bundle: Buffer.from(j.bundle, 'base64'), exp: Date.now() + (j.ttl || 600) * 1000 };
          return send(200, { ok: true });
        }
        if (path === '/__admin/changes') return send(200, changes.slice(Number(new URLSearchParams(query).get('since') || 0)));
        if (path === '/__admin/stats') return send(200, { ...stats, files: [...files.keys()] });
        if (path === '/__admin/reset-stats') {
          for (const k of Object.keys(stats)) stats[k] = 0;
          return send(200, { ok: true });
        }
        return send(404, { error: 'no' });
      }
      stats.requests++;
      stats.bytesIn += body.length;
      if (req.method === 'GET' && path === '/lan/hello') return send(200, { app: 'glean', v: 1, now: Date.now() });
      const h = req.headers['x-glean-lan'];
      if (req.method === 'GET' && path === '/lan/v1/pair') {
        if (!offer) return send(404, { error: 'no pairing' });
        if (offer.exp < Date.now()) return (offer = null), send(410, { error: 'pairing expired' });
        if (verify(offer.auth, h, 'GET', url)) return stats.rejected++, send(401, { error: 'unauthorized' });
        const b = offer.bundle;
        offer = null;
        changed('pair');
        return send(200, b, 'application/octet-stream');
      }
      if (!auth) return send(503, { error: 'not ready' });
      const bad = verify(auth, h, req.method, url);
      if (bad) return stats.rejected++, send(401, { error: bad });
      if (req.method === 'GET' && path === '/lan/v1/list') {
        stats.lists++;
        const dir = (new URLSearchParams(query).get('dir') || '').replace(/^\/|\/$/g, '');
        if (!pathOk(dir, 2, true)) return send(400, { error: 'bad dir' });
        const pre = dir ? dir + '/' : '';
        const out = new Map();
        for (const [p, f] of files) {
          if (!p.startsWith(pre)) continue;
          const rest = p.slice(pre.length);
          const i = rest.indexOf('/');
          if (i < 0) out.set(p, { path: p, size: f.b.length, etag: `${f.v}-${f.b.length}`, dir: false });
          else out.set(pre + rest.slice(0, i), { path: pre + rest.slice(0, i), size: 0, etag: '', dir: true });
        }
        return send(200, [...out.values()].sort((a, b) => (a.path < b.path ? -1 : 1)));
      }
      if (!path.startsWith('/lan/v1/f/')) return send(404, { error: 'not found' });
      const rel = path.slice('/lan/v1/f/'.length);
      if (!pathOk(rel, 3, false)) return send(400, { error: 'bad path' });
      if (req.method === 'GET') {
        stats.gets++;
        const f = files.get(rel);
        return f ? send(200, f.b, 'application/octet-stream') : send(404, { error: 'not found' });
      }
      if (req.method === 'PUT') {
        stats.puts++;
        if (req.headers['if-none-match'] === '*' && files.has(rel)) return send(412, { error: 'exists' });
        files.set(rel, { b: body, v: ++ver });
        changed(rel);
        return send(201, { ok: true });
      }
      if (req.method === 'DELETE') {
        files.delete(rel);
        changed(rel);
        return send(204, '');
      }
      return send(405, { error: 'method not allowed' });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        files,
        stats,
        setAuth: (hex) => (auth = hex),
        setOffer: (authHex, bundle, ttl = 600) => (offer = { auth: authHex, bundle: Buffer.from(bundle), exp: Date.now() + ttl * 1000 }),
        stop: () => new Promise((r) => server.close(() => r())),
        server,
      }),
    );
  });
}

if (process.argv[1] && process.argv[1].endsWith('lanmock.mjs') && process.argv[2]) {
  startLanMock(Number(process.argv[2])).then((m) => console.log(`lanmock on ${m.port}`));
}
