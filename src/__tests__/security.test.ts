import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import confRaw from '../../src-tauri/tauri.conf.json?raw';
import capRaw from '../../src-tauri/capabilities/default.json?raw';
import runRaw from '../../e2e/run.mjs?raw';
import { androidBackend, browserBackend, detectBackend, keychainBackend, memoryBackend, type VaultBackend } from '../lib/vault';
import { _resetSecretsForTest, defaultSettings, flushSecrets, initSecrets, loadSettings, saveSettings, stripSecrets, vaultKind } from '../lib/settings';
import { ERRLOG_MAX, clearErrors, logError, readErrors, scrub } from '../lib/errlog';
import { buildDiagnostics, platformOf, webviewOf } from '../lib/diagnostics';
import { LinganDB, addItem, exportAll } from '../lib/db';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  _resetSecretsForTest();
  clearErrors();
});

const KEY = 'lingan.settings.v1';
const SECRET = 'sk-test-0123456789abcdefXYZ';

/** 模拟钥匙串：一个 Map + 可选故障 */
function fakeKeychain(fail = false): VaultBackend & { m: Map<string, string> } {
  const m = new Map<string, string>();
  const b = keychainBackend(async <T,>(cmd: string, args?: Record<string, unknown>) => {
    if (fail) throw new Error('boom ' + String(args?.value ?? ''));
    const name = String(args?.name);
    if (cmd === 'secret_get') return (m.get(name) ?? null) as T;
    if (cmd === 'secret_set') return void m.set(name, String(args?.value)) as T;
    if (cmd === 'secret_delete') return void m.delete(name) as T;
    throw new Error('unknown');
  });
  return Object.assign(b, { m });
}

describe('v0.20 密钥进钥匙串（0626 / 0617）', () => {
  it('首次启动：旧 localStorage 里的 key 搬进钥匙串，设置里清掉，loadSettings 仍拿得到', async () => {
    store.set(KEY, JSON.stringify({ preset: 'zhipu', chat: { apiKey: SECRET, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }, embed: { apiKey: 'emb-key-123456' } }));
    const kc = fakeKeychain();
    const r = await initSecrets(async () => kc);
    expect(r).toEqual({ kind: 'keychain', migrated: 2 });
    expect(kc.m.get('chat.apiKey')).toBe(SECRET);
    expect(kc.m.get('embed.apiKey')).toBe('emb-key-123456');
    expect(store.get(KEY)).not.toContain(SECRET);
    expect(store.get(KEY)).not.toContain('emb-key-123456');
    const s = loadSettings();
    expect(s.chat.apiKey).toBe(SECRET);
    expect(s.embed.apiKey).toBe('emb-key-123456');
    expect(s.chat.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(vaultKind()).toBe('keychain');
  });

  it('第二次启动：从钥匙串读回；保存新 key 只进钥匙串', async () => {
    const kc = fakeKeychain();
    kc.m.set('chat.apiKey', 'old-key-999999');
    store.set(KEY, JSON.stringify({ preset: 'zhipu', chat: { apiKey: '' } }));
    await initSecrets(async () => kc);
    expect(loadSettings().chat.apiKey).toBe('old-key-999999');
    const s = loadSettings();
    saveSettings({ ...s, chat: { ...s.chat, apiKey: SECRET } });
    await flushSecrets();
    expect(kc.m.get('chat.apiKey')).toBe(SECRET);
    expect(store.get(KEY)).not.toContain(SECRET);
    expect(loadSettings().chat.apiKey).toBe(SECRET);
    // 清空 key = 从钥匙串删掉
    saveSettings({ ...s, chat: { ...s.chat, apiKey: '' } });
    await flushSecrets();
    expect(kc.m.has('chat.apiKey')).toBe(false);
  });

  it('钥匙串写失败：不丢 key，保持旧行为（留在设置里）', async () => {
    store.set(KEY, JSON.stringify({ chat: { apiKey: SECRET } }));
    await initSecrets(async () => fakeKeychain(true));
    expect(loadSettings().chat.apiKey).toBe(SECRET);
    expect(store.get(KEY)).toContain(SECRET);
  });

  it('只有内存后端（钥匙串探测失败）：key 继续留在设置里，重启不丢', async () => {
    store.set(KEY, JSON.stringify({ chat: { apiKey: SECRET } }));
    await initSecrets(async () => memoryBackend());
    const s = loadSettings();
    expect(s.chat.apiKey).toBe(SECRET);
    saveSettings({ ...s, chat: { ...s.chat, apiKey: 'new-key-123456' } });
    expect(store.get(KEY)).toContain('new-key-123456');
  });

  it('设置被清掉 = 重置：钥匙串里的残留 key 一起清', async () => {
    const kc = fakeKeychain();
    kc.m.set('chat.apiKey', SECRET);
    await initSecrets(async () => kc);
    expect(loadSettings().chat.apiKey).toBe('');
    expect(kc.m.size).toBe(0);
  });

  it('浏览器降级：单独条目，不在设置里', async () => {
    store.set(KEY, JSON.stringify({ chat: { apiKey: SECRET } }));
    await initSecrets(async () => browserBackend());
    expect(store.get(KEY)).not.toContain(SECRET);
    expect(JSON.parse(store.get('glean.vault.v1')!)['chat.apiKey']).toBe(SECRET);
    expect(loadSettings().chat.apiKey).toBe(SECRET);
  });

  it('安卓后端：读写走 LinganVault，读失败抛错', async () => {
    const m = new Map<string, string>();
    const a = androidBackend({ get: (n) => m.get(n) ?? '', set: (n, v) => (v ? m.set(n, v) : m.delete(n), true) });
    await a.set('chat.apiKey', SECRET);
    expect(await a.get('chat.apiKey')).toBe(SECRET);
    await a.del('chat.apiKey');
    expect(await a.get('chat.apiKey')).toBe('');
    const bad = androidBackend({ get: () => '\u0000', set: () => false });
    await expect(bad.get('chat.apiKey')).rejects.toThrow();
    await expect(bad.set('chat.apiKey', 'x')).rejects.toThrow();
  });

  it('后端探测：安卓接口优先，其次浏览器；钥匙串错误不带出值', async () => {
    expect((await detectBackend({ LinganVault: { get: () => '', set: () => true } })).kind).toBe('android');
    expect((await detectBackend({})).kind).toBe('browser');
    expect((await detectBackend(undefined)).kind).toBe('memory');
    const kc = fakeKeychain(true);
    const err = await kc.set('chat.apiKey', SECRET).catch((e: Error) => e.message);
    expect(err).not.toContain(SECRET);
  });

  it('stripSecrets 去掉两处 key，不改原对象', () => {
    const s = { ...defaultSettings(), chat: { ...defaultSettings().chat, apiKey: SECRET } };
    const o = stripSecrets(s);
    expect(JSON.stringify(o)).not.toContain(SECRET);
    expect(s.chat.apiKey).toBe(SECRET);
  });
});

describe('v0.20 备份 / 诊断 / 日志不含 key（0629）', () => {
  it('导出备份不含 key', async () => {
    store.set(KEY, JSON.stringify({ chat: { apiKey: SECRET } }));
    await initSecrets(async () => browserBackend());
    const d = new LinganDB('sec-' + Math.random());
    await addItem({ type: 'text', title: '一句话', content: '内容', tags: [] } as never, d);
    const b = JSON.stringify(await exportAll(d));
    expect(b).not.toContain(SECRET);
    expect(b).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });

  it('错误日志脱敏：当前 key、sk- 串、Bearer、data URL 都抹掉', () => {
    const e = new Error(`请求失败 Authorization: Bearer ${SECRET} sk-abcdefghijk12345 data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB`);
    const r = logError(e, 'manual', { now: 1, version: 't' })!;
    const all = JSON.stringify(readErrors());
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('sk-abcdefghijk12345');
    expect(all).not.toContain('iVBORw0KGgo');
    expect(r.msg).toContain('[key]');
    expect(scrub('my key is custom-secret-value!', ['custom-secret-value'])).toBe('my key is [key]!');
  });

  it('环形缓冲：最多保留 ERRLOG_MAX 条，同错 1 秒内只记一次', () => {
    for (let i = 0; i < ERRLOG_MAX + 30; i++) logError(new Error('e' + i), 'error', { now: i * 2000 });
    const a = readErrors();
    expect(a.length).toBe(ERRLOG_MAX);
    expect(a[a.length - 1].msg).toBe('e' + (ERRLOG_MAX + 29));
    clearErrors();
    logError(new Error('same'), 'error', { now: 10 });
    logError(new Error('same'), 'error', { now: 500 });
    logError(new Error('same'), 'error', { now: 2000 });
    expect(readErrors().length).toBe(2);
  });

  it('诊断文本：有版本 / 平台 / 条数 / 最近错误，不含 key', () => {
    logError(new Error('boom ' + SECRET), 'render', { now: Date.now(), view: 'library' });
    const txt = buildDiagnostics({
      version: '0.20.0',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      counts: { items: 12, devs: 3, imgs: 4, cliches: 5 },
      vault: '系统钥匙串',
      persisted: true,
      aiPreset: '智谱',
      aiReady: true,
      secrets: [SECRET],
    });
    expect(txt).toContain('v0.20.0');
    expect(txt).toContain('12 穗');
    expect(txt).toContain('WebView2 / Edge 130');
    expect(txt).toContain('library render Error: boom');
    expect(txt).not.toContain(SECRET);
    expect(txt).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });

  it('平台 / WebView 识别', () => {
    expect(platformOf('Mozilla/5.0 (Linux; Android 16; V2500) Chrome/131.0', true, true)).toBe('安卓 App · Android 16');
    expect(webviewOf('Mozilla/5.0 (Linux; Android 16) Chrome/131.0.6778.39 Mobile')).toBe('Chromium 131.0.6778.39');
  });
});

describe('v0.20 CSP 与网络权限（0627）', () => {
  const conf = JSON.parse(confRaw);
  const cap = JSON.parse(capRaw);
  it('CSP 已开启，脚本只许本地，禁止 object / 外嵌', () => {
    const csp = conf.app.security.csp;
    expect(csp).toBeTruthy();
    const d = csp as Record<string, string>;
    expect(d['default-src']).toContain("'self'");
    expect(d['script-src']).toBe("'self'");
    expect(d['object-src']).toBe("'none'");
    expect(d['img-src']).toContain('data:');
    expect(d['img-src']).toContain('blob:');
    expect(d['connect-src']).toContain('ipc:');
  });
  it('e2e 用的 CSP 与 tauri.conf 一致', () => {
    const run = runRaw;
    const m = /const APP_CSP = (\{[\s\S]*?\});/.exec(run);
    expect(m).toBeTruthy();
    const e2e = Function(`return ${m![1]}`)();
    expect(e2e).toEqual(conf.app.security.csp);
  });
  it('http 只放 https 与本机 / 局域网的 http（本地模型），不再放任意 http', () => {
    const http = cap.permissions.find((p: { identifier?: string }) => p.identifier === 'http:default');
    const urls: string[] = http.allow.map((a: { url: string }) => a.url);
    expect(urls).toContain('https://*');
    expect(urls).not.toContain('http://*');
    expect(urls).toContain('http://localhost:*');
    // 数字 IP 不能写成 10.* 这种通配（URLPattern 会把它规范化成 0.0.0.10*，什么都匹配不上），要用正则组
    expect(urls).toContain('http://(192\\.168\\.\\d+\\.\\d+):*');
    expect(urls.some((u) => /^http:\/\/\d/.test(u) && u.includes('*') && !u.startsWith('http://127.0.0.1'))).toBe(false);
    const httpPats = urls.filter((u) => u.startsWith('http://')).map((u) => u.slice(7).replace(/:\*$/, ''));
    const hostOk = (h: string) => httpPats.some((p) => (p.startsWith('(') ? new RegExp('^' + p + '$').test(h) : p === h || (p.startsWith('*.') && h.endsWith(p.slice(1)))));
    for (const h of ['localhost', '127.0.0.1', 'pc.local', '10.0.0.5', '192.168.1.3', '172.16.9.9', '172.31.0.1']) expect(hostOk(h), h).toBe(true);
    for (const h of ['example.com', '172.15.0.1', '172.32.0.1', '10.evil.com', '192.168.1.3.evil.com', '8.8.8.8']) expect(hostOk(h), h).toBe(false);
  });
});

describe('v0.20 链接解析不被网络收紧误伤', () => {
  it('公网 http 链接改走 https 抓，本机 / 局域网保持 http', async () => {
    const { fetchableUrl } = await import('../lib/linkmeta');
    expect(fetchableUrl('http://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(fetchableUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(fetchableUrl('http://192.168.1.3:8080/x')).toBe('http://192.168.1.3:8080/x');
    expect(fetchableUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
    expect(fetchableUrl('http://nas.local/x')).toBe('http://nas.local/x');
    expect(fetchableUrl('http://172.32.0.1/x')).toBe('https://172.32.0.1/x');
  });
});
