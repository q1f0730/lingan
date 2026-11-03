// v0.30 嫁接 · 人在环里（0201 0204 0205 0207 0211 0216 0237 0244 0904 0906 + ROADMAP v0.23 / v0.24 / v0.25）+ 冷启动 prime
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addMyCard, ALL_CONSTRAINTS, CONSTRAINT_GROUPS, constraintPool, dailyConstraint, drawCard, myCards, rollConstraint, WILD_LINE, WILD_TEMP } from '../lib/constraints';
import { clearLog, countImages, gateOutbound, monthSummary, previewText, readLog, recordOutbound, setPreviewer, setPreviewMode, stripImages, type OutRecord } from '../lib/outbound';
import { awayFromMainstream, buildConvergePrompt, buildMapPrompt, graftOffline, graftWithAI, normalizeMap, tagConstraints, TRANSFORMS } from '../lib/graft';
import { branchTree, buildRegraftPrompt, childDevelopment, nextForm, normalizeFollowup, normalizeRegraft, offlineFollowup, offlineRegraft, resultItem, statusCounts, statusOf, withFollowup, FOLLOWUP_MAX } from '../lib/branchplus';
import { addAtom, atomsPrompt, cleanAtom, editAtom, normalizeAtoms, offlineAtoms, removeAtom, topAtoms, type AtomStore } from '../lib/atoms';
import { answerItem, askLibrary, askRetrieve, askTerms, normalizeAsk } from '../lib/ask';
import { defaultSettings } from '../lib/settings';
import { mulberry32 } from '../lib/similarity';
import type { Development, Idea, Item } from '../lib/types';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
beforeAll(() => {
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});

const U = (n: number) => '01HZZZZZZZZZZZZZZZZZZZZZ' + String(n).padStart(2, '0');
const mk = (id: number, title: string, why = '', tags: string[] = [], extra: Partial<Item> = {}): Item => ({ id, uid: U(id), type: 'text', title, why, tags, createdAt: 1000 + id, updatedAt: 1000 + id, ...extra });
const three = [mk(1, '花样年华', '旗袍和楼梯，慢镜头'), mk(2, '梦二', '一直重复的大提琴'), mk(3, '楼梯间的灯', '灯一直坏着，楼梯')];

describe('0216 约束骰子 + 斜策略卡', () => {
  it('60 条硬约束、分五组；方向写了形式就优先那组', () => {
    expect(ALL_CONSTRAINTS.length).toBe(60);
    expect(CONSTRAINT_GROUPS.map((g) => g.list.length)).toEqual([12, 12, 12, 12, 12]);
    expect(constraintPool('一首歌的 MV')).toContain('全片一个镜头，不剪');
    expect(constraintPool('一首歌')).toContain('只用人声，不用乐器');
    expect(constraintPool('').length).toBe(60);
  });
  it('同一天第一次掷到同一条，重掷不重复上一条', () => {
    const d = new Date(2026, 10, 3);
    expect(dailyConstraint('', d)).toBe(dailyConstraint('', d));
    const a = rollConstraint('', undefined, () => 0);
    expect(rollConstraint('', a, () => 0)).not.toBe(a);
  });
  it('自己写的卡进牌堆、可抽到、不重复上一张、撞墙的跳过', () => {
    addMyCard('  只用夜里的声音  ');
    expect(myCards()[0]).toBe('只用夜里的声音');
    expect(drawCard(undefined, () => 0)).toBe('只用夜里的声音');
    expect(drawCard('只用夜里的声音', () => 0)).not.toBe('只用夜里的声音');
    expect(drawCard(undefined, () => 0, ['只用夜里的声音'], (c) => c.includes('夜里'))).not.toContain('夜里');
  });
});

describe('ROADMAP v0.23 野一点 / 钉住的卡 / 0201 0207 进 prompt', () => {
  it('钉住的卡、硬约束、口味原子、野一点都写进第一步 prompt；第一步要大众版', () => {
    const p = buildMapPrompt(three, { oblique: '把时间倒过来', constraint: '没有对白', wild: true, atoms: ['留白', '楼梯'] });
    expect(p.user).toContain('斜策略（作为额外约束）：把时间倒过来');
    expect(p.user).toContain('硬约束（每根新枝都必须满足');
    expect(p.user).toContain('留白、楼梯');
    expect(p.system).toContain(WILD_LINE);
    expect(p.system).toContain('MAINSTREAM');
    expect(normalizeMap({ mainstream: '一部怀旧 MV', tensions: [], seeds: TRANSFORMS.map((t) => ({ t: t.id, text: t.name, refs: [1, 2, 3] })) }, [1, 2, 3]).mainstream).toBe('一部怀旧 MV');
  });
  it('挑的张力和大众版进第二步 prompt', () => {
    const t = [{ text: '慢和快', refs: [1, 2] }];
    const p = buildConvergePrompt(three, { oblique: 'x', focus: t, mainstream: '怀旧 MV' }, t, [{ text: 's', transform: 'invert', refs: [1, 2, 3] }]);
    expect(p.system).toContain('亲手挑了 1 条张力');
    expect(p.system).toContain('大众版是「怀旧 MV」');
    expect(p.user).toContain('我挑的张力：\n- 慢和快');
  });
  it('离大众版太近的新枝被换掉；记上约束', () => {
    const b = (t: string, transform: string, idea: string): Idea => ({ title: t, bridge: '', idea, cliches: [], transform });
    const branches = [b('一', 'invert', '一部怀旧 MV，旗袍和楼梯慢镜头'), b('二', 'scale', '把楼梯缩小成一个盒子'), b('三', 'medium', '大提琴变成灯的明灭')];
    const pool = () => [b('替', 'invert', '完全不同的东西：一张只写动词的清单')];
    const r = awayFromMainstream(branches, '一部怀旧 MV，旗袍和楼梯慢镜头', pool);
    expect(r.report!.replaced).toBe(1);
    expect(r.branches[0].mainstream).toBe('replaced');
    expect(r.branches[0].title).toBe('替');
    const tagged = tagConstraints(r.branches, { constraint: '没有对白', wild: true, focus: [{ text: '慢和快', refs: [] }] });
    expect(tagged.every((x) => x.constraint === '没有对白' && x.wild === 1 && x.focus?.[0] === '慢和快')).toBe(true);
  });
  it('离线：钉住的卡就是新枝的斜策略，硬约束 / 野一点写进正文', () => {
    const r = graftOffline(three, { rand: mulberry32(3), oblique: '只保留错误的部分', constraint: '没有对白', wild: true });
    expect(r.branches.every((b) => b.oblique === '只保留错误的部分' && b.constraint === '没有对白' && b.wild === 1)).toBe(true);
    expect(r.branches.every((b) => b.idea.includes('硬约束：没有对白') && b.idea.includes('野一点：'))).toBe(true);
  });
});

describe('graftWithAI：野一点温度 1.5、挑张力暂停、大众版', () => {
  const temps: number[] = [];
  const systems: string[] = [];
  const users: string[] = [];
  const MAP = { mainstream: '一部怀旧的 MV', tensions: [{ text: '慢和快', refs: [1, 2] }, { text: '坏掉的灯', refs: [2, 3] }, { text: '重复', refs: [1, 3] }], seeds: TRANSFORMS.map((t, i) => ({ t: t.id, text: `种子${i}`, refs: [1, 2, 3] })) };
  const CONV = { pattern: 'p', branches: [1, 4, 7].map((n, i) => ({ seed: n, title: `枝${i}`, idea: `第${i}根，具体到画面${'甲乙丙'[i]}`, form: '短片', refs: [1, 2, 3], experiment: 'e' })), cliches: [] };
  beforeAll(() => {
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      temps.push(body.temperature);
      systems.push(String(body.messages[0].content));
      users.push(String(body.messages[1].content));
      const a = String(body.messages[0].content).includes('PHASE A');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(a ? MAP : CONV) } }] }), { status: 200 });
    });
  });
  afterEach(() => {
    temps.length = 0;
    systems.length = 0;
    users.length = 0;
  });
  const s = () => {
    const x = defaultSettings();
    x.chat.apiKey = 'k';
    x.chat.baseUrl = 'http://x/v1';
    x.temperature = 0.9;
    return x;
  };
  it('野一点：第一步请求温度 1.5，关掉回到设置值', async () => {
    const r = await graftWithAI(s(), three, { wild: true, oblique: '把时间倒过来', sleep: () => Promise.resolve() });
    expect(temps[0]).toBe(WILD_TEMP);
    expect(r.temps?.[0]).toBe(1.5);
    expect(r.branches.every((b) => b.oblique === '把时间倒过来' && b.wild === 1)).toBe(true);
    temps.length = 0;
    await graftWithAI(s(), three, { sleep: () => Promise.resolve() });
    expect(temps[0]).toBe(0.9);
    expect(temps[1]).toBe(0.8);
  });
  it('0201：停在挑张力，挑完第二步只沿这几条；0207 大众版进第二步', async () => {
    const stages: string[] = [];
    const r = await graftWithAI(s(), three, { sleep: () => Promise.resolve(), onProgress: (p) => stages.push(p.stage), pickTensions: async (t) => (expect(t).toHaveLength(3), [1]) });
    expect(stages).toEqual(['map', 'pick', 'defix', 'done']);
    expect(users[1]).toContain('我挑的张力：\n- 坏掉的灯');
    expect(systems[1]).toContain('大众版是「一部怀旧的 MV」');
    expect(r.mainstream?.text).toBe('一部怀旧的 MV');
    expect(r.branches.every((b) => b.focus?.[0] === '坏掉的灯')).toBe(true);
  });
  it('「都要」= 不加张力限制', async () => {
    await graftWithAI(s(), three, { sleep: () => Promise.resolve(), pickTensions: async () => null });
    expect(users[1]).not.toContain('我挑的张力');
  });
});

describe('ROADMAP v0.25 发出去前看一眼 + 0906 出站记录', () => {
  const body = { model: 'm', temperature: 0.4, messages: [{ role: 'system', content: '系统' }, { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(4000) } }] }] };
  afterEach(() => {
    setPreviewer(null);
    setPreviewMode('off');
  });
  it('预览文字就是请求体原文，图片只显示占位', () => {
    const t = previewText(body);
    expect(t).toContain('【系统说明】\n系统');
    expect(t).toContain('看图');
    expect(t).toMatch(/［图片 \d+KB］/);
    expect(t).not.toContain('base64');
    expect(countImages(body)).toBe(1);
    expect(countImages(stripImages(body))).toBe(0);
  });
  it('关着：原样发；每次：没勾图片 → 请求体里没有图片；取消 → 不发', async () => {
    expect((await gateOutbound('https://api.x.com/v1/chat', body, 'chat')).body).toBe(body);
    setPreviewMode('always');
    let seen = '';
    setPreviewer(async (r) => ((seen = r.text), { ok: true, images: false }));
    const g = await gateOutbound('https://api.x.com/v1/chat', body, 'chat');
    expect(seen).toBe(previewText(body));
    expect(countImages(g.body)).toBe(0);
    expect(g.stripped).toBe(1);
    setPreviewer(async () => ({ ok: true, images: true }));
    expect(countImages((await gateOutbound('https://api.x.com/v1/chat', body, 'chat')).body)).toBe(1);
    setPreviewer(async () => ({ ok: false, images: false }));
    await expect(gateOutbound('https://api.x.com/v1/chat', body, 'chat')).rejects.toThrow('没发出去');
    setPreviewer(async () => ({ ok: true, images: false }));
    await expect(gateOutbound('https://api.x.com/v1/chat', body, 'vision')).rejects.toThrow('不看图');
  });
  it('只看一次：看过一次之后不再弹', async () => {
    setPreviewMode('once');
    let n = 0;
    setPreviewer(async () => (n++, { ok: true, images: true }));
    await gateOutbound('https://a/v1', { messages: [] }, 'chat');
    await gateOutbound('https://a/v1', { messages: [] }, 'chat');
    expect(n).toBe(1);
  });
  it('出站记录：只记域名 / 种类 / 字段类别 / 字节；本月按域名汇总', () => {
    const now = new Date(2026, 10, 15).getTime();
    const recs: OutRecord[] = [
      { at: now - 1000, host: 'open.bigmodel.cn', kind: 'chat', fields: ['文字'], bytes: 1200, ok: true },
      { at: now - 2000, host: 'open.bigmodel.cn', kind: 'vision', fields: ['文字', '图片'], bytes: 90000, ok: false },
      { at: now - 3000, host: 'music.163.com', kind: 'link', fields: ['链接'], bytes: 40, ok: true },
      { at: new Date(2026, 9, 30).getTime(), host: 'old.example', kind: 'chat', fields: ['文字'], bytes: 1, ok: true },
    ];
    clearLog();
    recs.forEach(recordOutbound);
    const log = readLog();
    expect(log).toHaveLength(4);
    expect(JSON.stringify(log)).not.toMatch(/key|Bearer|看图/);
    const sum = monthSummary(log, now);
    expect(sum.map((g) => g.host)).toEqual(['open.bigmodel.cn', 'music.163.com']);
    expect(sum[0]).toMatchObject({ n: 2, fail: 1, bytes: 91200 });
    expect(sum[0].fields.sort()).toEqual(['图片', '文字'].sort());
  });
});

describe('ROADMAP v0.24 再嫁接 + 0204 追问 + 0904 落地', () => {
  const parent: Development = { id: 9, uid: U(90), itemIds: [1, 2, 3], jump: 0.8, idea: { title: '楼梯慢', bridge: 'b', idea: '旗袍上楼梯的慢镜头，配大提琴', form: '短片', cliches: [], refs: [1, 2, 3], experiment: '拍 3 个楼梯镜头' }, source: 'ai', createdAt: 1 };
  it('换一种形式按 歌→短片→海报… 走', () => {
    expect(nextForm('一首歌的副歌')).toBe('短片');
    expect(nextForm('一分钟短片')).toBe('海报');
    expect(nextForm('一组照片')).toBe('歌');
    expect(nextForm(undefined)).toBe('歌');
  });
  it('prompt 带原枝和素材；回答按真实素材 ID 校验', () => {
    const p = buildRegraftPrompt(parent.idea, three, 'grounded');
    expect(p.system).toContain('更能落地');
    expect(p.user).toContain('旗袍上楼梯的慢镜头');
    expect(p.temperature).toBe(0.6);
    const r = normalizeRegraft({ title: '今晚：楼梯', idea: '用手机拍三个楼梯', form: '短片', refs: [1, 3, 2], experiment: 'x' }, parent.idea, three, 'grounded')!;
    expect(r.refs).toEqual([1, 3, 2]);
    expect(r.bridge).toContain('更能落地');
    expect(normalizeRegraft({}, parent.idea, three, 'wilder')).toBeNull();
  });
  it('离线子枝三种都有，子枝挂在父枝下（父枝 uid），素材少了按 id 换算溯源', () => {
    for (const k of ['wilder', 'grounded', 'reform'] as const) {
      const c = offlineRegraft(parent.idea, k, () => 0);
      expect(c.idea).toContain(parent.idea.idea);
      if (k === 'reform') expect(c.form).toBe('海报');
    }
    const kid = childDevelopment(parent, offlineRegraft(parent.idea, 'reform'), 'reform', 'offline', 5, [1, 3]);
    expect(kid.parentUid).toBe(U(90));
    expect(kid.regraft).toBe('reform');
    expect(kid.itemIds).toEqual([1, 3]);
    expect(kid.idea.refs).toEqual([1, 2]);
    expect(kid.batch).toBeUndefined();
  });
  it('新枝页的树：子枝不当根；父枝没了的子枝当根', () => {
    const a: Development = { ...parent, id: 1, uid: U(81) };
    const b: Development = { ...parent, id: 2, uid: U(82), parentUid: U(81), createdAt: 3 };
    const c: Development = { ...parent, id: 3, uid: U(83), parentUid: U(82), createdAt: 4 };
    const orphan: Development = { ...parent, id: 4, uid: U(84), parentUid: U(99) };
    const t = branchTree([a, b, c, orphan]);
    expect(t.roots.map((d) => d.id)).toEqual([1, 4]);
    expect(t.children.get(U(81))!.map((d) => d.id)).toEqual([2]);
    expect(t.children.get(U(82))!.map((d) => d.id)).toEqual([3]);
  });
  it('追问：[#ID] 换成标题，引用只认这批的；离线也给能动手的回答；最多 20 条', () => {
    const r = normalizeFollowup({ answer: '先拍[#3]的灯，再接[#1]的楼梯，[#99]不算', refs: [2] }, '', three)!;
    expect(r.a).toBe('先拍《楼梯间的灯》的灯，再接《花样年华》的楼梯，不算');
    expect(r.refs.sort()).toEqual([1, 2, 3]);
    const off = offlineFollowup(parent, three, '开头怎么写');
    expect(off.source).toBe('offline');
    expect(off.a).toContain('《花样年华》');
    let list = undefined as ReturnType<typeof withFollowup> | undefined;
    for (let i = 0; i < 25; i++) list = withFollowup(list, { ...off, q: String(i) });
    expect(list).toHaveLength(FOLLOWUP_MAX);
    expect(list![0].q).toBe('5');
  });
  it('落地：没有状态 = 种子；计数；结果穗带标签和来历', () => {
    expect(statusOf({})).toBe('seed');
    expect(statusCounts([{}, { status: 'done' }, { status: 'tried' }, { status: 'done' }])).toEqual({ seed: 1, tried: 1, done: 2, dropped: 0 });
    const it = resultItem(parent, 'data:image/jpeg;base64,xx', '');
    expect(it).toMatchObject({ type: 'image', tags: ['新枝结果'], source: '新枝' });
    expect(it.why).toContain('楼梯慢');
    expect(resultItem(parent, undefined, '做了一版').type).toBe('idea');
  });
});

describe('0205 口味原子 + 0244 导出卡', () => {
  const lib = [
    mk(1, '一一', '手写感，留白很多', ['留白']),
    mk(2, '海报 A', '留白和手写感', ['手写']),
    mk(3, '磁带', '低保真的底噪', ['低保真']),
    mk(4, '梦二', '低保真的录音，留白', []),
    mk(5, '私密那穗', '留白', [], { private: 1 }),
  ];
  it('离线：为什么里反复出现的短语（≥2 穗）', () => {
    const a = offlineAtoms(lib);
    const names = a.map((x) => x.atom);
    expect(names).toContain('留白');
    expect(names).toContain('手写感');
    expect(names).toContain('低保真');
    expect(a.find((x) => x.atom === '留白')!.uids.length).toBeGreaterThanOrEqual(3);
  });
  it('AI 结果：引用只认真实 ID，换成 uid；空泛 / 重复去掉', () => {
    const r = normalizeAtoms({ atoms: [{ atom: '「留白」', refs: [1, 2, 77], w: 9 }, { atom: '留白', refs: [3] }, { atom: 'x', refs: [1] }] }, lib);
    expect(r).toEqual([{ atom: '留白', uids: [U(1), U(2)], weight: 5 }]);
    expect(cleanAtom('  手写 感！ ')).toBe('手写感');
  });
  it('改 / 删 / 加；自己加的排前面进 top8', () => {
    let st: AtomStore = { at: 1, source: 'ai', atoms: [{ atom: '留白', uids: [U(1)], weight: 3 }, { atom: '夜车', uids: [], weight: 5 }] };
    st = editAtom(st, 0, '大片留白');
    expect(st.atoms[0]).toMatchObject({ atom: '大片留白', mine: 1 });
    st = addAtom(st, '低保真');
    expect(topAtoms(st, 2)).toEqual(['低保真', '大片留白']);
    st = removeAtom(st, 0);
    expect(st.atoms.map((a) => a.atom)).toEqual(['大片留白', '夜车']);
  });
  it('导出卡 ≤300 字、署 Q1f730、不含私密穗、不含为什么原文', () => {
    const st: AtomStore = { at: 1, source: 'offline', atoms: offlineAtoms(lib) };
    const t = atomsPrompt(st, lib);
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t).toContain('Q1f730');
    expect(t).toContain('我在意：');
    expect(t).not.toContain('私密那穗');
    expect(t).not.toContain('底噪');
  });
});

describe('0211 穗仓对话 + 0237 收成穗', () => {
  const lib = [mk(1, '雨夜的便利店', '下雨天的灯', ['雨']), mk(2, '晴天', '夏天跑步时燃', ['夏天']), mk(3, '屋檐', '听雨声睡觉', [])];
  it('问句去掉套话只剩要搜的词', () => {
    expect(askTerms('我收过哪些关于雨的东西？')).toEqual(['雨']);
    expect(askTerms('有没有讲夏天跑步的歌')).toEqual(['夏天跑步', '歌']);
  });
  it('本地检索 OR + 长词拆二字；没命中不调模型直说没有', async () => {
    expect(askRetrieve(lib, '关于雨的').map((x) => x.item.id).sort()).toEqual([1, 3]);
    expect(askRetrieve(lib, '夏天跑完步').map((x) => x.item.id)).toEqual([2]);
    const none = await askLibrary(null, lib, '关于火山的东西');
    expect(none.source).toBe('none');
    expect(none.text).toContain('没有');
    const off = await askLibrary(null, lib, '雨');
    expect(off.source).toBe('offline');
    expect(off.refs.sort()).toEqual([1, 3]);
  });
  it('回答里的 [#ID] 换成标题，只认检索到的', () => {
    const r = normalizeAsk({ answer: '有两穗：[#1] 和 [#3]，还有[#9]', refs: [2] }, '', [lib[0], lib[2]]);
    expect(r.text).toBe('有两穗：《雨夜的便利店》 和 《屋檐》，还有');
    expect(r.refs).toEqual([1, 3]);
  });
  it('收成穗：想法穗、来源穗仓对话、内容是问答', () => {
    const it = answerItem({ q: '雨', text: '有两穗', refs: [], hits: [], source: 'ai' });
    expect(it).toMatchObject({ type: 'idea', source: '穗仓对话', tags: ['穗仓对话'] });
    expect(it.content).toBe('问：雨\n答：有两穗');
  });
});

describe('v0.30 冷启动：穗仓全部穗先查（prime）', () => {
  it('prime 之后第一份结果到了；没人订阅到时放掉', async () => {
    const { db } = await import('../lib/db');
    await db.items.bulkAdd([mk(1, 'a'), mk(2, 'b'), { ...mk(3, 'c'), deletedAt: 5 }].map(({ id: _i, ...x }) => (void _i, x)));
    const li = await import('../lib/libitems');
    li.primeLibraryItems(5000);
    expect(li._libState().subscribed).toBe(true);
    await li.firstLibraryItems(3000);
    expect(li._libState().hasValue).toBe(true);
    const v = await li.libraryQuery();
    expect(v.map((x) => x.title)).toEqual(['b', 'a']);
  });
});
