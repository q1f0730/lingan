// v0.24 嫁接反馈与本地模型：0212 不要的理由、0208/0209 本地模型探测、三枝不撞车、0241 新颖度、0234 去 AI 腔、
// 0202 主干、0203 为什么优先、0206 反口味、0210 文风、0242 私密穗。
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LinganDB } from '../lib/db';
import { addReject, cleanCustom, CUSTOM, feedbackBlock, reasonCounts, reasonLabel, recentRejects, REASONS } from '../lib/feedback';
import { aiVisible, allowPrivate, isLocalBaseUrl, isLocalHost, normalizeHost, parseModels, probeLocal, probeServer, suggestModels } from '../lib/localmodel';
import { branchCore, enforceDistinct, maxPairSim, nearestOld, noveltyLabel, textSim } from '../lib/distinct';
import { deai, deaiIdea, DEAI_RULES } from '../lib/deai';
import { avoidBlock, buildConvergePrompt, buildMapPrompt, describeForGraft, distinctBranches, graftOffline, graftWithAI, normalizeMap, styleBlock, TRANSFORMS } from '../lib/graft';
import { aiReady, defaultSettings, distinctOf, embedConfig, styleSamples, withPreset } from '../lib/settings';
import { drawSamples } from '../lib/samples';
import { mulberry32 } from '../lib/similarity';
import type { Development, Idea, Item } from '../lib/types';
import { exportGlean, BlobSink, readBackupFile, planImport, applyImport } from '../lib/backup';

const SAMPLES = drawSamples(10, mulberry32(2424)).map(({ sample: _s, ...rest }) => (void _s, rest));
const items: Item[] = SAMPLES.map((s, i) => ({ ...s, id: i + 11, createdAt: Date.now() - i * 86400000, updatedAt: Date.now() }));
const three = items.slice(0, 3);
const fresh = () => new LinganDB('v024-' + Math.random().toString(36).slice(2));
const idea = (title: string, body: string, transform = 'invert', extra: Partial<Idea> = {}): Idea => ({ title, idea: body, bridge: '', cliches: [], transform, refs: [1, 2, 3], ...extra });

describe('0212 不要的理由', () => {
  const dev = (title: string): Development => ({ itemIds: [1, 2, 3], jump: 0.8, idea: idea(title, '正文'), source: 'ai', createdAt: 1, uid: '01JA86WJG0GQ5QF19BDCMYTXGH' });
  it('四个快捷理由 + 自定义；不选 / 空的自定义不记', async () => {
    expect(REASONS.map((r) => r.label)).toEqual(['太俗', '太远', '做不了', '不像我']);
    const d = fresh();
    expect(await addReject(dev('A'), 'nope', undefined, d)).toBeNull();
    expect(await addReject(dev('A'), CUSTOM, '   ', d)).toBeNull();
    expect(await addReject(dev('《小票上的情书》'), 'cliche', undefined, d, 1000)).toBeGreaterThan(0);
    expect(await addReject(dev('B'), CUSTOM, '  太像\n广告了  ', d, 2000)).toBeGreaterThan(0);
    const rows = await recentRejects(20, d);
    expect(rows.map((r) => r.title)).toEqual(['B', '小票上的情书']);
    expect(rows[0].text).toBe('太像 广告了');
    expect(reasonLabel(rows[0])).toBe('太像 广告了');
    expect(reasonLabel(rows[1])).toBe('太俗');
    expect(rows.every((r) => /^[0-9A-Z]{26}$/.test(r.uid!))).toBe(true);
    expect(rows[1].devUid).toBe('01JA86WJG0GQ5QF19BDCMYTXGH');
  });
  it('FEEDBACK 段：只要最近 20 条（新→旧），先汇总再逐条；没有就是空串', async () => {
    expect(feedbackBlock([])).toBe('');
    const rows = Array.from({ length: 25 }, (_, i) => ({ reason: i % 2 ? 'far' : 'cliche', title: `枝${i}`, createdAt: i }));
    const b = feedbackBlock(rows);
    expect(b).toContain('FEEDBACK');
    expect(b).toContain('《枝24》');
    expect(b).not.toContain('《枝4》');
    expect(b.split('\n').filter((l) => l.startsWith('- ')).length).toBe(20);
    expect(b).toMatch(/汇总：太俗×10、太远×10|汇总：太远×10、太俗×10/);
    expect(reasonCounts(rows)[0].n).toBe(13);
    expect(cleanCustom('x'.repeat(80)).length).toBe(40);
  });
  it('理由进下次嫁接的提示词（两次调用都带）', () => {
    const fb = feedbackBlock([{ reason: 'notme', title: '咳嗽副歌', createdAt: 1 }]);
    const p = buildMapPrompt(three, { oblique: 'o', feedback: fb });
    expect(p.user).toContain('FEEDBACK');
    expect(p.user).toContain('《咳嗽副歌》：不像我会做的东西');
    expect(p.system).toContain('同样的毛病不许再犯');
    const m = normalizeMap({ tensions: [], seeds: TRANSFORMS.map((t) => ({ t: t.id, text: t.name, refs: [11, 12, 13] })) }, three.map((x) => x.id!));
    expect(buildConvergePrompt(three, { oblique: 'o', feedback: fb }, m.tensions, m.seeds).user).toContain('FEEDBACK');
  });
  it('备份 / 导入带着理由走（按 uid 不重复）', async () => {
    const d = fresh();
    await d.items.bulkAdd(three.map(({ id: _id, ...x }) => (void _id, x)));
    await addReject(dev('留着的理由'), 'hard', undefined, d, 5);
    const sink = new BlobSink();
    await exportGlean(sink, d, { now: 10 });
    const inc = await readBackupFile(sink.blob());
    expect(inc.rejects?.length).toBe(1);
    const d2 = fresh();
    await applyImport(inc, await planImport(inc, d2, 'merge'), d2);
    await applyImport(inc, await planImport(inc, d2, 'merge'), d2);
    const rows = await d2.rejects.toArray();
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('留着的理由');
    expect(rows[0].reason).toBe('hard');
  });
});

describe('0208 / 0209 本地模型探测', () => {
  it('只认本机 / 局域网地址', () => {
    for (const h of ['localhost', '127.0.0.1', '192.168.1.23', '10.0.0.5', '172.16.3.4', '172.31.0.1', 'my-pc.local', '::1']) expect(isLocalHost(h), h).toBe(true);
    for (const h of ['8.8.8.8', '172.32.0.1', '192.169.1.1', 'example.com', '300.1.1.1']) expect(isLocalHost(h), h).toBe(false);
  });
  it('地址规范化：补 http 和默认端口，公网拒绝', () => {
    expect(normalizeHost('192.168.1.23', 'lmstudio')?.origin).toBe('http://192.168.1.23:1234');
    expect(normalizeHost('192.168.1.23', 'ollama')?.origin).toBe('http://192.168.1.23:11434');
    expect(normalizeHost('http://pc.local:8080/v1', 'ollama')?.origin).toBe('http://pc.local:8080');
    expect(normalizeHost('example.com', 'lmstudio')).toBeNull();
    expect(normalizeHost('', 'lmstudio')).toBeNull();
    expect(isLocalBaseUrl('http://192.168.1.23:1234/v1')).toBe(true);
    expect(isLocalBaseUrl('https://open.bigmodel.cn/api/paas/v4')).toBe(false);
  });
  it('模型列表：OpenAI 兼容 / Ollama 原生都认；推荐对话 / 看图 / 向量模型', () => {
    const m = parseModels({ data: [{ id: 'qwen2.5-7b-instruct' }, { id: 'text-embedding-nomic-embed-text-v1.5' }, { id: 'qwen2.5-vl-7b' }] });
    expect(m).toHaveLength(3);
    expect(parseModels({ models: [{ name: 'llama3.1:8b' }, { model: 'bge-m3' }] })).toEqual(['llama3.1:8b', 'bge-m3']);
    expect(suggestModels(m)).toEqual({ chat: 'qwen2.5-7b-instruct', vision: 'qwen2.5-vl-7b', embed: 'text-embedding-nomic-embed-text-v1.5' });
    expect(suggestModels([])).toEqual({ chat: '', vision: '', embed: '' });
  });
  it('探测：LM Studio 读 /v1/models；Ollama /v1/models 不通时退到 /api/tags；连不上如实说', async () => {
    const urls: string[] = [];
    const f = async (u: string) => {
      urls.push(u);
      if (u === 'http://127.0.0.1:1234/v1/models') return new Response(JSON.stringify({ data: [{ id: 'gemma-3-4b' }] }), { status: 200 });
      if (u === 'http://127.0.0.1:11434/v1/models') return new Response('nope', { status: 404 });
      if (u === 'http://127.0.0.1:11434/api/tags') return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }), { status: 200 });
      throw new TypeError('connection refused');
    };
    const r = await probeLocal(['127.0.0.1'], { fetch: f as never });
    expect(r.map((x) => [x.kind, x.ok, x.models])).toEqual([
      ['lmstudio', true, ['gemma-3-4b']],
      ['ollama', true, ['qwen3:8b']],
    ]);
    expect(r[0].baseUrl).toBe('http://127.0.0.1:1234/v1');
    const off = await probeServer('http://192.168.1.9:1234', 'lmstudio', { fetch: f as never });
    expect(off.ok).toBe(false);
    expect(off.error).toContain('连不上');
    // 公网地址根本不发请求
    urls.length = 0;
    expect(await probeLocal(['example.com'], { fetch: f as never })).toEqual([]);
    expect(urls).toEqual([]);
  });
  it('本地预设不要密钥；向量同接口也能用；离线可用', () => {
    const s = withPreset(defaultSettings(), 'local');
    expect(s.chat.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(aiReady(s)).toBe(false); // 还没选模型
    s.chat.chatModel = 'qwen2.5-7b-instruct';
    expect(aiReady(s)).toBe(true);
    s.embed.model = 'nomic-embed';
    expect(embedConfig(s)).toEqual({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: 'nomic-embed' });
  });
});

describe('0242 私密穗', () => {
  it('云端永远不发；本地模型且允许时才发', () => {
    const cloud = defaultSettings();
    const local = { ...withPreset(defaultSettings(), 'local'), privateLocal: true };
    const p = { private: 1 as const };
    expect(aiVisible({}, cloud)).toBe(true);
    expect(aiVisible(p, cloud)).toBe(false);
    expect(aiVisible(p, { ...cloud, privateLocal: true })).toBe(false);
    expect(aiVisible(p, local)).toBe(true);
    expect(aiVisible(p, { ...local, privateLocal: false })).toBe(false);
    expect(allowPrivate(local, 'https://api.siliconflow.cn/v1')).toBe(false);
  });
});

describe('三枝不撞车', () => {
  const pool = () => TRANSFORMS.map((t, i) => idea(`替补${i}`, `第${i}种完全不同的做法：${'甲乙丙丁戊己庚辛'[i]}${'子丑寅卯辰巳午未'[i]}的${t.hint}`, t.id));
  it('人为构造两根几乎相同的新枝：后一根被换掉，换后两两相似度低于阈值', () => {
    const a = idea('雨里的公交站', '一分钟短片：雨夜公交站，两个陌生人共用一把伞，一直等到末班车开走也没上车。', 'invert');
    const b = idea('雨里的公交站台', '一分钟短片：雨夜公交站台，两个陌生人共用一把伞，一直等到末班车开走都没上车。', 'medium');
    const c = idea('小票情书', '用便利店小票装订的小书，商品名连起来读是一封信。', 'material');
    expect(textSim(a, b)).toBeGreaterThan(0.6);
    const r = enforceDistinct([a, b, c], pool, { threshold: 0.45 });
    expect(r.report.replaced).toBe(1);
    expect(r.branches[0]).toBe(a);
    expect(r.branches[1].distinct).toBe('replaced');
    expect(r.branches[1].title).not.toBe(b.title);
    expect(maxPairSim(r.branches, { threshold: 0.45 })).toBeLessThan(0.45);
    expect(r.report.maxSim).toBeLessThan(0.45);
    // 变形法仍两两不同
    expect(new Set(r.branches.map((x) => x.transform)).size).toBe(3);
  });
  it('阈值可调：阈值放宽到 0.95 就不换', () => {
    const a = idea('A', '一模一样的正文，一模一样的结尾', 'invert');
    const b = idea('A', '一模一样的正文，一模一样的结尾。', 'medium');
    expect(enforceDistinct([a, b], pool, { threshold: 0.95 }).report.replaced).toBe(1); // 完全一样（=1）仍算撞车
    const c = idea('雨夜', '雨夜的公交站，两个人共用一把伞，等末班车', 'invert');
    const d = idea('雨天', '雨天的公交站，两个人共用一把伞，等头班车', 'medium');
    const sim = textSim(c, d);
    expect(enforceDistinct([c, d], pool, { threshold: Math.min(0.99, sim + 0.01) }).report.replaced).toBe(0);
    expect(enforceDistinct([c, d], pool, { threshold: sim - 0.01 }).report.replaced).toBe(1);
  });
  it('比较时去掉素材名和离线固定句式（离线三根不会因为模板一样被误判）', () => {
    expect(branchCore(idea('t', '把《重庆森林》翻成歌。做成一张海报：取《A》的结构、《B》的情绪。约束：只用一种颜色。'))).toBe('t。把翻成歌。');
    const off = graftOffline(three, { rand: mulberry32(7) });
    expect(off.distinct?.method).toBe('text');
    expect(off.distinct!.maxSim).toBeLessThan(0.45);
    expect(off.branches).toHaveLength(3);
  });
  it('有向量时用余弦；向量失败退回字面', async () => {
    const a = idea('一', '甲甲甲', 'invert');
    const b = idea('二', '乙乙乙', 'medium');
    const c = idea('三', '丙丙丙', 'material');
    // a 和 b 的向量几乎一样
    const vec: Record<string, number[]> = { 一: [1, 0, 0], 二: [0.99, 0.05, 0], 三: [0, 0, 1] };
    let calls = 0;
    const embed = async (texts: string[]) => {
      calls++;
      return texts.map((t) => vec[t.split('。')[0]] || [0, 1, 0]);
    };
    const r = await distinctBranches([a, b, c], () => [idea('四', '丁丁丁', 'scale')], { text: 0.45, vector: 0.9, embed });
    expect(r.report.method).toBe('vector');
    expect(r.report.replaced).toBe(1);
    expect(r.branches[1].title).toBe('四');
    expect(calls).toBe(2);
    const r2 = await distinctBranches([a, b, c], () => [], { text: 0.45, vector: 0.9, embed: async () => Promise.reject(new Error('x')) });
    expect(r2.report.method).toBe('text');
  });
  it('设置：阈值夹在合理范围', () => {
    expect(distinctOf({})).toEqual({ text: 0.45, vector: 0.9 });
    expect(distinctOf({ distinct: { text: 2, vector: 0 } })).toEqual({ text: 0.95, vector: 0.5 });
  });
});

describe('0241 新颖度', () => {
  it('和穗仓里已有新枝的最大相似度（越低越新），附最像的那根', () => {
    const b = idea('雨里的公交站', '雨夜公交站，两个陌生人共用一把伞');
    expect(nearestOld(b, [])).toEqual({ sim: 0, title: undefined });
    const n = nearestOld(b, [idea('别的', '完全无关的一段话'), idea('旧的公交站', '雨夜公交站，两个陌生人共用一把伞，末班车')]);
    expect(n.title).toBe('旧的公交站');
    expect(n.sim).toBeGreaterThan(0.5);
    expect(noveltyLabel(0.05)).toContain('很新');
    expect(noveltyLabel(0.6)).toContain('有点眼熟');
  });
});

describe('0234 去 AI 腔', () => {
  it('内置 40 条句式', () => expect(DEAI_RULES.length).toBeGreaterThanOrEqual(40));
  it('结构改直说、填充语删掉', () => {
    expect(deai('它不仅是一首歌，更是一封信。').text).toBe('它是一首歌，也是一封信。');
    expect(deai('在等车的同时，他数着雨点。').text).toBe('等车，他数着雨点。');
    expect(deai('值得一提的是，结尾没有对白。').text).toBe('结尾没有对白。');
    expect(deai('总而言之，这是一部片。').text).toBe('这是一部片。');
    expect(deai('这部片引发观众深刻思考。').text).toBe('这部片让人停一下。');
    expect(deai('普通的一句话。').hits).toEqual([]);
  });
  it('书名号 / 引号里的原话不改', () => {
    const r = deai('取《不仅是你，更是我》的结构，值得一提的是「在雨里的同时」。');
    expect(r.text).toBe('取《不仅是你，更是我》的结构，「在雨里的同时」。');
  });
  it('新枝几段字都过一遍，记改了几处', () => {
    const x = deaiIdea(idea('标题', '值得一提的是，这是正文。总之，就这样。'));
    expect(x.idea).toBe('这是正文。就这样。');
    expect(x.deai).toBe(2);
    expect(deaiIdea(idea('t', '干净的')).deai).toBeUndefined();
  });
});

describe('0203 为什么优先 / 0202 主干 / 0206 反口味 / 0210 文风', () => {
  const it0: Item = { id: 7, type: 'film', title: '重庆森林', creator: '王家卫', year: '1994', caption: '霓虹', why: '凤梨罐头的过期日期', tags: ['香港'], createdAt: 1, updatedAt: 1 };
  it('素材块：ID 和标题在头，块内先「为什么打动我」再画面再作者', () => {
    const t = describeForGraft(it0, 0);
    const lines = t.split('\n');
    expect(lines[0]).toBe('[#7 | 电影 | 标签：香港] 重庆森林');
    expect(lines[1]).toBe('为什么打动我：凤梨罐头的过期日期');
    expect(lines[2]).toBe('画面：霓虹');
    expect(t.indexOf('为什么')).toBeLessThan(t.indexOf('作者'));
    expect(buildMapPrompt(three, { oblique: 'o' }).system).toContain('「为什么打动我」比标题重要');
  });
  it('主干：方括号里标「主干」，系统提示要求每根都以它为主体', () => {
    const p = buildMapPrompt(three, { oblique: 'o', anchorId: three[1].id });
    expect(p.user).toMatch(new RegExp(`\\[#${three[1].id} \\| [^\\]]*主干`));
    expect(p.user).not.toMatch(new RegExp(`\\[#${three[0].id} \\| [^\\]]*主干`));
    expect(p.system).toContain(`素材 #${three[1].id} 是主干`);
    // 离线：每根新枝都带主干
    const off = graftOffline([three[1], three[0], three[2]], { rand: mulberry32(3), anchorId: three[1].id });
    for (const b of off.branches) expect(b.refs![0]).toBe(1);
  });
  it('反口味：AVOID 段不带素材 ID，只列讨厌的', () => {
    const bad: Item = { ...it0, id: 99, polarity: -1, title: '烂俗鸡汤' };
    expect(avoidBlock([it0])).toBe('');
    const a = avoidBlock([bad, it0]);
    expect(a).toContain('AVOID');
    expect(a).toContain('《烂俗鸡汤》');
    expect(a).not.toContain('[#99');
    const p = buildMapPrompt(three, { oblique: 'o', avoid: [bad] });
    expect(p.user).toContain('AVOID');
    expect(p.system).toContain('AVOID 段是我讨厌的东西');
  });
  it('文风：开着且有内容才带，最多 3 段每段 300 字', () => {
    expect(styleSamples({ style: { on: false, samples: ['a'] } })).toEqual([]);
    expect(styleSamples({ style: { on: true, samples: ['', 'x'.repeat(400), 'b', 'c', 'd'] } }).map((x) => x.length)).toEqual([300, 1, 1]);
    expect(styleBlock([])).toBe('');
    const p = buildMapPrompt(three, { oblique: 'o', style: ['我写的一段话'] });
    expect(p.user).toContain('样本 1：我写的一段话');
    expect(p.system).toContain('STYLE 段');
  });
});

describe('graftWithAI：两根几乎一样时换掉一根、去 AI 腔、带上反馈', () => {
  let sys: string[] = [];
  let users: string[] = [];
  const reply = (obj: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), { status: 200 });
  beforeAll(() => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sys.push(String(body.messages[0].content));
      const user = String(body.messages[1].content);
      users.push(user);
      const ids = [...new Set([...user.matchAll(/\[#(\d+) \|/g)].map((m) => Number(m[1])))];
      if (String(body.messages[0].content).includes('PHASE A')) return reply({ tensions: [{ text: 't', refs: ids.slice(0, 2) }], seeds: TRANSFORMS.map((t, i) => ({ t: t.id, text: `种子${i}：第${i}种做法，${t.hint}`, refs: ids.slice(0, 3) })) });
      const same = '一分钟短片：雨夜公交站，两个陌生人共用一把伞，一直等到末班车开走也没上车。值得一提的是，没有对白。';
      return reply({
        pattern: 'p',
        replaced: [],
        branches: [
          { seed: 1, title: '雨里的公交站', idea: same, form: '短片', refs: ids.slice(0, 3) },
          { seed: 2, title: '雨里的公交站台', idea: same.replace('也没', '都没'), form: '短片', refs: ids.slice(0, 3) },
          { seed: 6, title: '小票情书', idea: '用便利店小票装订的小书，商品名连起来读是一封信。', form: '小书', refs: ids.slice(0, 3) },
        ],
        cliches: [],
      });
    });
  });
  afterAll(() => vi.unstubAllGlobals());
  it('换掉一根太像的，三根两两低于阈值；去 AI 腔；FEEDBACK / AVOID / STYLE / 主干都进了提示词', async () => {
    const s = defaultSettings();
    s.chat.apiKey = 'k';
    s.chat.baseUrl = 'http://x/v1';
    sys = [];
    users = [];
    const bad: Item = { ...items[5], polarity: -1 };
    const r = await graftWithAI(s, three, {
      rand: mulberry32(4),
      sleep: () => Promise.resolve(),
      anchorId: three[0].id,
      avoid: [bad],
      feedback: feedbackBlock([{ reason: 'cliche', title: '旧枝', createdAt: 1 }]),
      style: ['短句。'],
      distinct: { text: 0.45, vector: 0.9 },
    });
    expect(r.distinct?.replaced).toBe(1);
    expect(r.branches.filter((b) => b.distinct === 'replaced')).toHaveLength(1);
    expect(maxPairSim(r.branches, { threshold: 0.45 })).toBeLessThan(0.45);
    expect(r.deai).toBeGreaterThan(0);
    expect(r.branches[0].idea).not.toContain('值得一提的是');
    for (const u of users) {
      expect(u).toContain('FEEDBACK');
      expect(u).toContain('AVOID');
      expect(u).toContain('STYLE');
      expect(u).toMatch(/\| 主干/);
      // 讨厌的穗不是素材：不带 ID
      expect(u).not.toContain(`[#${bad.id} |`);
    }
    expect(sys.every((x) => x.includes(`素材 #${three[0].id} 是主干`))).toBe(true);
  });
});

describe('Dexie v10：rejects 表', () => {
  it('新库有 rejects 表，清空全部时一起清', async () => {
    const d = fresh();
    await d.open();
    expect(d.verno).toBe(11); // v0.29 起是 11（作品）
    await d.rejects.add({ reason: 'far', title: 't', createdAt: 1 });
    const { clearAll } = await import('../lib/db');
    await clearAll(d);
    expect(await d.rejects.count()).toBe(0);
  });
});
