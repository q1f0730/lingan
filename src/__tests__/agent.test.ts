// v0.25 Agent 与工程：0806 glean-mcp、0807 只读 + 写入确认、0809 口味资源、0836 查套路、0838 访问审计、
// 本地 API 配置、0511 / 0751 更新检查的纯逻辑。
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addItem, addUserCliche, LinganDB } from '../lib/db';
import { AGENT_SOURCE, checkCliches, handleApi, itemOut, mcpTools, parseDraft, tasteMarkdown, type ApiDeps } from '../lib/agentapi';
import { AUDIT_MAX, clearAudit, readAudit, recordAudit, weekSummary } from '../lib/apiaudit';
import { AGENT_DEFAULT, claudeCodeCmd, httpConfig, readAgentCfg, stdioConfig, validPort } from '../lib/agent';
import { apkUrl, cmpVer, dueForCheck, parseLatest, DAY } from '../lib/update';
import { draftSummary } from '../lib/agentboot';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  key() {
    return null;
  }
  get length() {
    return this.m.size;
  }
}
const ls = new MemStorage();
(globalThis as { localStorage?: unknown }).localStorage = ls;

const NOW = Date.UTC(2026, 10, 3, 8);
let db: LinganDB;
let ids: Record<string, number> = {};

beforeAll(async () => {
  db = new LinganDB('agent-' + Math.random().toString(36).slice(2));
  const add = (k: string, data: Parameters<typeof addItem>[0]) => addItem(data, db).then((id) => (ids[k] = id));
  await add('night', { type: 'music', title: '夜的钢琴曲五', creator: '石进', why: '下雨天听，像有人在旁边慢慢说话', tags: ['钢琴', '雨'] });
  await add('film', { type: 'film', title: '花样年华', creator: '王家卫', year: '2000', why: '走廊里的慢镜头', tags: ['电影', '雨'] });
  await add('secret', { type: 'text', title: '夜里写给自己的话', content: '不给任何 AI 看', tags: ['日记'], private: 1 });
  await add('hate', { type: 'text', title: '夜间营销文案', why: '太油了', tags: ['广告'], polarity: -1 });
  await add('gone', { type: 'text', title: '夜 已删除', tags: [] });
  await db.items.update(ids.gone, { deletedAt: NOW });
  await addUserCliche('氛围感拉满', db);
  await db.developments.add({ itemIds: [ids.night, ids.film, ids.secret], jump: 0.7, idea: { title: '雨夜放映', bridge: '雨', idea: '在雨夜放一部默片', cliches: [] }, source: 'offline', createdAt: NOW - 1000, starred: true });
});
beforeEach(() => ls.clear());

function deps(over: Partial<ApiDeps> = {}): ApiDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    db,
    version: '0.25.0',
    canWrite: () => false,
    confirmWrite: async (c) => (asked.push(c), true),
    addItem: (data) => addItem(data, db, { inbox: true }),
    now: () => NOW,
    asked,
    ...over,
  };
}
const rpc = (method: string, params: Record<string, unknown> = {}, id: number | null = 1) => ({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params });
async function mcp(d: ApiDeps, msg: unknown, session = '') {
  const r = await handleApi({ method: 'POST', path: '/mcp', body: JSON.stringify(msg), client: 'curl/8', session }, d);
  return { ...r, json: r.body ? JSON.parse(r.body) : null };
}
const toolText = (j: { result: { content: Array<{ text: string }> } }) => j.result.content[0].text;

describe('0806 glean-mcp（Streamable HTTP，JSON 应答）', () => {
  it('initialize：协商版本、带会话 id、服务名 glean', async () => {
    const r = await mcp(deps(), rpc('initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'claude-code', version: '2' }, capabilities: {} }));
    expect(r.status).toBe(200);
    expect(r.json.result.protocolVersion).toBe('2025-03-26');
    expect(r.json.result.serverInfo).toMatchObject({ name: 'glean', version: '0.25.0' });
    expect(r.json.result.capabilities.tools).toBeTruthy();
    expect(r.headers?.find(([k]) => k === 'Mcp-Session-Id')?.[1]).toMatch(/^[0-9a-f]{24}$/);
    const odd = await mcp(deps(), rpc('initialize', { protocolVersion: '1999-01-01' }));
    expect(odd.json.result.protocolVersion).toBe('2025-06-18');
  });
  it('通知不回包（202）；未知方法 -32601；非法请求 -32600；批量拒绝', async () => {
    const n = await mcp(deps(), rpc('notifications/initialized', {}, null));
    expect(n.status).toBe(202);
    expect(n.body).toBe('');
    expect((await mcp(deps(), rpc('nope/x'))).json.error.code).toBe(-32601);
    expect((await mcp(deps(), { id: 3, method: 'ping' })).json.error.code).toBe(-32600);
    expect((await mcp(deps(), [rpc('ping')])).status).toBe(400);
    expect((await mcp(deps(), rpc('ping'))).json.result).toEqual({});
  });
  it('默认只读：tools/list 没有 add_item；开写入后才有', async () => {
    const ro = await mcp(deps(), rpc('tools/list'));
    expect(ro.json.result.tools.map((t: { name: string }) => t.name)).toEqual(['search_items', 'get_item', 'list_branches', 'get_taste', 'check_cliches']);
    expect(ro.json.result.tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
    const rw = await mcp(deps({ canWrite: () => true }), rpc('tools/list'));
    expect(rw.json.result.tools.map((t: { name: string }) => t.name)).toContain('add_item');
    expect(mcpTools(false).length).toBe(5);
  });
  it('search_items：全文搜，私密穗 / 墓碑永远不出现；反口味标 dislike', async () => {
    const r = await mcp(deps(), rpc('tools/call', { name: 'search_items', arguments: { query: '夜' } }));
    const list = JSON.parse(toolText(r.json));
    const titles = list.map((x: { title: string }) => x.title);
    expect(titles).toContain('夜的钢琴曲五');
    expect(titles).toContain('夜间营销文案');
    expect(titles).not.toContain('夜里写给自己的话');
    expect(titles).not.toContain('夜 已删除');
    expect(list.find((x: { title: string }) => x.title === '夜间营销文案').dislike).toBe(true);
    expect(r.json.result.structuredContent.items.length).toBe(list.length);
    const typed = JSON.parse(toolText((await mcp(deps(), rpc('tools/call', { name: 'search_items', arguments: { query: '雨', type: 'film' } }))).json));
    expect(typed.map((x: { title: string }) => x.title)).toEqual(['花样年华']);
    const latest = JSON.parse(toolText((await mcp(deps(), rpc('tools/call', { name: 'search_items', arguments: { limit: 2 } }))).json));
    expect(latest.length).toBe(2);
  });
  it('get_item：按 uid / 本机编号读；私密穗当不存在', async () => {
    const one = await db.items.get(ids.film);
    const r = await mcp(deps(), rpc('tools/call', { name: 'get_item', arguments: { id: one!.uid } }));
    expect(JSON.parse(toolText(r.json))).toMatchObject({ title: '花样年华', creator: '王家卫', year: '2000', id: one!.uid });
    const sec = await db.items.get(ids.secret);
    const s = await mcp(deps(), rpc('tools/call', { name: 'get_item', arguments: { id: sec!.uid } }));
    expect(s.json.result.isError).toBe(true);
    const local = await mcp(deps(), rpc('tools/call', { name: 'get_item', arguments: { id: `local-${ids.night}` } }));
    expect(JSON.parse(toolText(local.json)).title).toBe('夜的钢琴曲五');
  });
  it('list_branches：新枝带 refs，私密穗不进 refs', async () => {
    const r = await mcp(deps(), rpc('tools/call', { name: 'list_branches', arguments: { starred: true } }));
    const b = JSON.parse(toolText(r.json));
    expect(b[0].title).toBe('雨夜放映');
    expect(b[0].refs.map((x: { title: string }) => x.title)).toEqual(['夜的钢琴曲五', '花样年华']);
  });
  it('未知工具 -32602；工具里抛错 → isError 结果而不是协议错误', async () => {
    expect((await mcp(deps(), rpc('tools/call', { name: 'rm_rf' }))).json.error.code).toBe(-32602);
    const bad = deps({ db: { ...db, cliches: { toArray: () => Promise.reject(new Error('boom')) } } as unknown as LinganDB });
    const r = await mcp(bad, rpc('tools/call', { name: 'check_cliches', arguments: { text: 'x' } }));
    expect(r.json.result.isError).toBe(true);
  });
});

describe('0807 写入：开关 + 逐次确认 + 进待理标 Agent 代拾', () => {
  it('没开写入：MCP 里连工具都调不到，REST 返回 403', async () => {
    const r = await mcp(deps(), rpc('tools/call', { name: 'add_item', arguments: { title: 'x' } }));
    expect(r.json.error.code).toBe(-32602);
    const rest = await handleApi({ method: 'POST', path: '/v1/items', body: '{"title":"x"}', client: 'curl' }, deps());
    expect(rest.status).toBe(403);
  });
  it('开了写入、本人拒绝 → 不落库', async () => {
    const before = await db.items.count();
    const d = deps({ canWrite: () => true, confirmWrite: async () => false });
    const r = await mcp(d, rpc('tools/call', { name: 'add_item', arguments: { title: '被拒的一穗' } }));
    expect(r.json.result.isError).toBe(true);
    expect(await db.items.count()).toBe(before);
  });
  it('允许 → 进待理、来源标「Agent 代拾 · 客户端名」（客户端名取 initialize 的 clientInfo）', async () => {
    const d = deps({ canWrite: () => true });
    const init = await mcp(d, rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'Cherry Studio' } }));
    const sid = init.headers!.find(([k]) => k === 'Mcp-Session-Id')![1];
    const r = await mcp(d, rpc('tools/call', { name: 'add_item', arguments: { title: 'Agent 推荐的歌', url: 'https://music.163.com/song?id=1', why: '和你收过的钢琴曲很像', tags: ['推荐', 'x'.repeat(50)] } }), sid);
    const out = JSON.parse(toolText(r.json));
    expect(out.ok).toBe(true);
    expect(d.asked).toEqual(['Cherry Studio']);
    const row = await db.items.where('uid').equals(out.id).first();
    expect(row).toMatchObject({ title: 'Agent 推荐的歌', inbox: 1, source: `${AGENT_SOURCE} · Cherry Studio`, type: 'link' });
    expect(row!.tags).toContain('推荐');
    expect(row!.tags.every((t) => t.length <= 30)).toBe(true);
  });
  it('REST POST /v1/items 也走确认；非 http 链接 / 空内容被拒', async () => {
    const d = deps({ canWrite: () => true });
    const ok = await handleApi({ method: 'POST', path: '/v1/items', body: JSON.stringify({ content: '一句摘抄', type: 'text' }), client: 'my-script' }, d);
    expect(ok.status).toBe(201);
    expect(JSON.parse(ok.body).inbox).toBe(true);
    expect(d.asked).toEqual(['my-script']);
    expect((await handleApi({ method: 'POST', path: '/v1/items', body: '{"url":"javascript:alert(1)"}', client: 'x' }, d)).status).toBe(400);
    expect((await handleApi({ method: 'POST', path: '/v1/items', body: '{}', client: 'x' }, d)).status).toBe(400);
    expect((await handleApi({ method: 'POST', path: '/v1/items', body: 'not json', client: 'x' }, d)).status).toBe(400);
  });
  it('parseDraft：不收 image 类型、标题兜底、标签最多 12 个', () => {
    const d = parseDraft({ type: 'image', content: '长长的一段摘抄'.repeat(10), tags: Array.from({ length: 20 }, (_, i) => 't' + i) });
    expect(typeof d).toBe('object');
    if (typeof d === 'object') {
      expect(d.type).toBe('text');
      expect(d.title.length).toBe(40);
      expect(d.tags.length).toBe(12);
    }
    expect(draftSummary('Claude', { type: 'link', title: 'T', url: 'https://a.b', tags: ['x'] })).toContain('来自：Claude');
  });
});

describe('REST 只读端点', () => {
  it('GET /v1/items?q= · /v1/items/:id · /v1/branches · /v1/taste · 404', async () => {
    const r = await handleApi({ method: 'GET', path: '/v1/items', query: 'q=%E9%9B%A8&limit=5', client: 'curl' }, deps());
    expect(JSON.parse(r.body).items.map((x: { title: string }) => x.title).sort()).toEqual(['夜的钢琴曲五', '花样年华'].sort());
    const one = await db.items.get(ids.night);
    expect(JSON.parse((await handleApi({ method: 'GET', path: `/v1/items/${one!.uid}` }, deps())).body).why).toContain('下雨天');
    expect((await handleApi({ method: 'GET', path: '/v1/items/nope' }, deps())).status).toBe(404);
    expect(JSON.parse((await handleApi({ method: 'GET', path: '/v1/branches', query: 'starred=1' }, deps())).body).branches.length).toBe(1);
    expect(JSON.parse((await handleApi({ method: 'GET', path: '/v1/taste' }, deps())).body).markdown).toContain('口味侧写');
    expect((await handleApi({ method: 'GET', path: '/v2/x' }, deps())).status).toBe(404);
    expect((await handleApi({ method: 'GET', path: '/mcp' }, deps())).status).toBe(405);
    expect(JSON.parse((await handleApi({ method: 'GET', path: '/v1' }, deps())).body).write).toBe(false);
  });
  it('itemOut 不带向量、缩略图、原图', async () => {
    const it = (await db.items.get(ids.night))!;
    const o = itemOut({ ...it, embedding: [1, 2], image: 'data:x', thumb: new Blob(['x']) }) as Record<string, unknown>;
    expect(o.embedding).toBeUndefined();
    expect(o.image).toBeUndefined();
    expect(o.thumb).toBeUndefined();
  });
});

describe('0809 口味资源 · 0836 查套路', () => {
  it('resources/list + resources/read glean://taste：不含私密穗；反口味和套路墙单列', async () => {
    const l = await mcp(deps(), rpc('resources/list'));
    expect(l.json.result.resources[0].uri).toBe('glean://taste');
    const r = await mcp(deps(), rpc('resources/read', { uri: 'glean://taste' }));
    const md = r.json.result.contents[0].text as string;
    expect(md).toContain('高频标签');
    expect(md).toContain('雨(2)');
    expect(md).not.toContain('日记');
    expect(md).toContain('夜间营销文案');
    expect(md).toContain('氛围感拉满');
    expect((await mcp(deps(), rpc('resources/read', { uri: 'glean://x' }))).json.error.code).toBe(-32002);
    expect(await tasteMarkdown(db, NOW)).toBe(md);
  });
  it('check_cliches：内置 + 我加的；返回原文位置，字间夹标点也算', async () => {
    const hits = await checkCliches(db, '这是一场沉浸式的旅程，氛围·感拉满。');
    expect(hits.map((h) => h.text)).toEqual(['沉浸式', '旅程', '氛围·感拉满']);
    expect(hits[0].at).toBe(4);
    const r = await handleApi({ method: 'POST', path: '/v1/cliches/check', body: JSON.stringify({ text: '赋能' }) }, deps());
    expect(JSON.parse(r.body).count).toBe(1);
  });
});

describe('0838 访问审计', () => {
  it('每次调用记一行：客户端、工具、返回几穗；不记查询词', async () => {
    const d = deps();
    await mcp(d, rpc('tools/call', { name: 'search_items', arguments: { query: '雨' } }));
    await handleApi({ method: 'GET', path: '/v1/taste', client: 'my-script' }, d);
    const a = readAudit();
    expect(a.map((r) => [r.client, r.tool, r.n, r.ok])).toEqual([
      ['curl/8', 'search_items', 2, true],
      ['my-script', 'get_taste', 0, true],
    ]);
    expect(JSON.stringify(a)).not.toContain('雨');
  });
  it('环形 300 条；本周汇总按客户端；清空', () => {
    for (let i = 0; i < AUDIT_MAX + 20; i++) recordAudit({ t: NOW - i, client: i % 2 ? 'A' : 'B', tool: 'search_items', n: 1, ok: true });
    expect(readAudit().length).toBe(AUDIT_MAX);
    recordAudit({ t: NOW - 8 * DAY, client: 'old', tool: 'get_item', n: 1, ok: true });
    recordAudit({ t: NOW, client: 'A', tool: 'add_item', n: 0, ok: true });
    const w = weekSummary(readAudit(), NOW);
    expect(w.map((x) => x.client).sort()).toEqual(['A', 'B']);
    expect(w.find((x) => x.client === 'A')!.writes).toBe(1);
    clearAudit();
    expect(readAudit()).toEqual([]);
  });
});

describe('本地 API 配置与接入说明', () => {
  it('默认关、只读、端口 47321；坏端口回默认', () => {
    expect(readAgentCfg()).toEqual(AGENT_DEFAULT);
    expect(AGENT_DEFAULT).toEqual({ on: false, port: 47321, write: false });
    ls.setItem('glean.agent.v1', JSON.stringify({ on: true, port: 80, write: 'yes' }));
    expect(readAgentCfg()).toEqual({ on: true, port: 47321, write: false });
    expect(validPort('50000')).toBe(50000);
    expect(validPort(70000)).toBe(47321);
  });
  it('Claude Code / Cherry Studio / stdio 片段', () => {
    expect(claudeCodeCmd(47321, 'glean_abc')).toBe('claude mcp add --transport http glean http://127.0.0.1:47321/mcp --header "Authorization: Bearer glean_abc"');
    expect(JSON.parse(httpConfig(1234, 't')).mcpServers.glean).toEqual({ type: 'streamableHttp', url: 'http://127.0.0.1:1234/mcp', headers: { Authorization: 'Bearer t' } });
    expect(JSON.parse(stdioConfig(1234, 't')).mcpServers.glean.env).toEqual({ GLEAN_PORT: '1234', GLEAN_TOKEN: 't' });
  });
});

describe('0511 / 0751 更新检查', () => {
  it('版本比较', () => {
    expect(cmpVer('0.25.0', '0.24.0')).toBe(1);
    expect(cmpVer('v0.25.10', '0.25.9')).toBe(1);
    expect(cmpVer('0.25.0', '0.25.0')).toBe(0);
    expect(cmpVer('0.24.1', '0.25.0')).toBe(-1);
    expect(cmpVer('1.0.0-beta', '1.0.0')).toBe(0);
  });
  it('每天最多一次；关掉就不查；时钟倒退也能恢复', () => {
    expect(dueForCheck({ auto: true, lastCheck: 0 }, NOW)).toBe(true);
    expect(dueForCheck({ auto: true, lastCheck: NOW - DAY + 1000 }, NOW)).toBe(false);
    expect(dueForCheck({ auto: true, lastCheck: NOW - DAY }, NOW)).toBe(true);
    expect(dueForCheck({ auto: false, lastCheck: 0 }, NOW)).toBe(false);
    expect(dueForCheck({ auto: true, lastCheck: NOW + 3 * DAY }, NOW)).toBe(true);
  });
  it('latest.json 解析与 APK 地址', () => {
    const l = parseLatest({ version: 'v0.26.0', notes: '新功能', pub_date: '2026-11-10T00:00:00Z', platforms: {} });
    expect(l).toMatchObject({ version: '0.26.0', notes: '新功能', apkUrl: 'https://github.com/q1f0730/lingan/releases/download/v0.26.0/Glean_0.26.0_android.apk' });
    expect(parseLatest({ version: 'latest' })).toBeNull();
    expect(parseLatest(null)).toBeNull();
    expect(apkUrl('0.25.0')).toBe('https://github.com/q1f0730/lingan/releases/download/v0.25.0/Glean_0.25.0_android.apk');
  });
});
