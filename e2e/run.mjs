// e2e smoke test: node e2e/run.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || '/tmp/shots';
import fs from 'node:fs';
import crypto from 'node:crypto';
fs.mkdirSync(out, { recursive: true });
const errs = [];
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
// v0.16 引导只在第一次打开时出现：其余用例都当作「走过引导」的老用户（onboard: true 的上下文才看引导）
const _newContext = b.newContext.bind(b);
// v0.23 待理：默认开着（速记 / 分享来的穗先进待理）。老用例测的是「收了就在穗仓里」，上下文里先把待理关掉；inbox: true 的上下文（inbox() 用例）保持默认开
b.newContext = async (opts = {}) => {
  const { onboard, inbox, ...o } = opts;
  const c = await _newContext(o);
  if (!onboard) await c.addInitScript(() => { try { localStorage.setItem('glean.onboarded', '1'); } catch { /* svg doc */ } });
  if (!inbox) await c.addInitScript(() => { try { if (!sessionStorage.getItem('e2e.inbox.set')) { localStorage.setItem('glean.inbox', 'off'); sessionStorage.setItem('e2e.inbox.set', '1'); } } catch { /* svg doc */ } });
  return c;
};
// v0.20 Rewamp：旧的暖纸 / 麦田 / ASCII / 衬线 / 暗房一律不该再出现；卡片、按钮、弹层是 Rewamp 的圆角浮起语言；导航带图标
async function studio(pg, tag) {
  const r = await pg.evaluate(() => {
    const out = { canvas: document.querySelectorAll('canvas').length, old: [], theme: document.documentElement.dataset.theme };
    for (const sel of ['.field-canvas', '.wheatfield', '.ascii-wrap', '.paper', '.whisper', '.grow-wheat', '.seed-burst', '.ripple']) if (document.querySelector(sel)) out.old.push(sel);
    // 圆角：卡片 / 弹层 / toast / 主按钮 / 速记胶囊 都必须是圆角（Studio 的 0 圆角已作废）
    const square = [];
    for (const el of document.querySelectorAll('.card, .sheet, .confirm, .toast, .btn.primary, .quick-bar, .chip')) {
      if (!(parseFloat(getComputedStyle(el).borderTopLeftRadius) >= 8)) square.push(el.className);
    }
    out.square = square.slice(0, 3);
    // 导航：每一项都有图标（svg）+ 中文
    out.navNoIcon = [...document.querySelectorAll('.nav-btn')].filter((b) => !b.querySelector('svg') || !b.textContent.trim()).length;
    const ff = getComputedStyle(document.body).fontFamily;
    out.font = /Glean Inter/.test(ff) && /Glean Sans/.test(ff) && !/Serif|Cormorant|Mono/.test(ff);
    return out;
  });
  if (r.canvas) errs.push(`[${tag}] canvas still on page (${r.canvas})`);
  if (r.old.length) errs.push(`[${tag}] old-style elements: ${r.old.join(',')}`);
  if (r.square.length) errs.push(`[${tag}] square corners on ${r.square.join(' | ')}`);
  if (r.navNoIcon) errs.push(`[${tag}] ${r.navNoIcon} nav items without icon/label`);
  if (!r.font) errs.push(`[${tag}] body font is not Inter + 思源黑体`);
  if (!['light', 'dark'].includes(r.theme)) errs.push(`[${tag}] data-theme missing ${r.theme}`);
}
// v0.10 改名：每页都不该再出现旧暗房用语，标题是「拾穗 Glean」
async function brand(pg, name) {
  const r = await pg.evaluate(() => {
    const t = document.body.innerText;
    const bad = ['暗房', '显影', '底片', '灵感库', '胶片', 'ROLL', 'EXP ', '№'].filter((w) => t.includes(w));
    return { title: document.title, bad, view: document.querySelector('.page-title')?.textContent };
  });
  if (r.title !== '拾穗 Glean') errs.push(`[${name}] title ${r.title}`);
  if (r.bad.length) errs.push(`[${name}] old words on ${r.view}: ${r.bad.join(',')}`);
}

// v0.11 一次三枝：模拟模型（同源 /mock-ai/v1，免 CORS）。第 1 次调用含 PHASE A，第 2 次含 PHASE C。
const MOCK_MAP = {
  tensions: [
    { text: '一个慢得像等人，一个快得像赶车', refs: [1, 2] },
    { text: '都在讲一样东西过期以前的那几天', refs: [1, 2] },
    { text: '一边全是颜色，一边几乎没有画面', refs: [2, 1] },
    { text: '重复本身变成了情绪', refs: [1, 2] },
  ],
  seeds: [
    { t: 'invert', text: '让被等的那个人来讲等待', refs: [1, 2] },
    { t: '换媒介', text: '把旋律改成一张只有门牌号的地图', refs: [2, 1] },
    { t: 'eras', text: '把这场相遇搬到没有手机的年代', refs: [1, 2] },
    { t: 'remove', text: '拿掉所有对白，只留下脚步声', refs: [1, 2] },
    { t: 'scale', text: '缩到一个罐头那么大的房间', refs: [1, 2] },
    { t: 'material', text: '只用便利店的小票做一本书', refs: [2, 1] },
    { t: 'viewpoint', text: '从那台旧收音机的角度看一整晚', refs: [1, 2] },
    { t: 'flaw', text: '留着录音里那一声咳嗽当副歌', refs: [2, 1] },
  ],
};
const MOCK_CONV = {
  pattern: '好几粒都落在「夜里的小房间」',
  replaced: [
    { n: 5, text: '放大到整条街，每扇窗都在放同一首歌', refs: [1, 2] },
    { n: 7, text: '从楼下修鞋师傅的角度看他们路过一百次', refs: [1, 2] },
    { n: 3, text: '搬到一九二〇年的早市，用吆喝声代替旋律', refs: [1, 2] },
  ],
  branches: [
    { seed: 6, title: '小票上的情书', idea: '一本用便利店小票装订的小书：每张小票记录一次路过，商品名连起来读是一封没寄出的信。最后一张小票上的日期，正好是罐头过期的那天。', form: '手作小书', refs: [1, 2], unlike: '它是能拿在手里的物件，另外两根都要靠声音', experiment: '收集你今天的三张小票，把商品名改写成三行诗。' },
    { seed: 6, title: '撞了变形的那根', idea: '这根和第一根用的是同一种变形，应该被拿掉。', form: '海报', refs: [1, 2], unlike: '无', experiment: '无' },
    { seed: 8, title: '咳嗽副歌', idea: '一首歌把录音里那声咳嗽循环成节拍，主歌是两个人轮流念购物清单，副歌只有那一声咳嗽和楼下的车声，越唱越像在笑。', form: '一首歌', refs: [2, 1], unlike: '它保留了失误，另外两根都在找新东西', experiment: '用手机录 30 秒房间声，找出最不想要的那一秒，循环它。' },
    { seed: 7, title: '修鞋师傅的一百次', idea: '一分钟短片，镜头钉在修鞋摊的高度，只拍路过的鞋。同一双鞋路过一百次，从匆忙到停下，最后一次两双鞋并排停住。', form: '一分钟短片', refs: [1, 2], unlike: '它换了讲述的人，全程不出现主角的脸', experiment: '在窗边拍 20 分钟路人的鞋，挑出三双编一个故事。' },
  ],
  cliches: ['雨夜霓虹的孤独', '遗憾的错过', '城市里的陌生人'],
};
// v0.12 溯源：模拟模型从 prompt 里读出真实素材 ID（[#12 | …] 标题），refs 一律换成真实 ID；
// evidence = 'ok' 正常引用 3 件；'recheck' 第一次不带 ID、重来一次后正常；'weak' 重来后仍有两根不带 / 编造 ID
function withIds(obj, ids, titles, cMode) {
  const o = JSON.parse(JSON.stringify(obj));
  const real = (refs) => {
    const out = refs.map((r) => ids[(r - 1) % ids.length]);
    for (const x of ids) if (out.length < Math.min(3, ids.length) && !out.includes(x)) out.push(x);
    return [...new Set(out)];
  };
  for (const t of o.tensions || []) t.refs = real(t.refs);
  for (const t of o.seeds || []) t.refs = real(t.refs);
  for (const t of o.replaced || []) t.refs = real(t.refs);
  (o.branches || []).forEach((b, i) => {
    b.refs = real(b.refs);
    if (i === 0 && titles.length >= 2) b.idea = `取《${titles[0]}》里的停顿和${titles[1]}的手感：` + b.idea;
    if (cMode === 'noid') delete b.refs;
    if (cMode === 'weak' && i === 2) delete b.refs;
    if (cMode === 'weak' && i === 3) b.refs = [ids[0], 987654];
  });
  return o;
}
async function mockAI(pg, { fail429 = 0, delay = 500, evidence = 'ok', conv = null, pattern = '**/mock-ai/v1/chat/completions' } = {}) {
  const log = { calls: 0, phases: [], users: [], systems: [] };
  let left = fail429;
  let cCalls = 0;
  await pg.route(pattern, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const sys = String(body.messages?.[0]?.content || '');
    log.calls++;
    if (left-- > 0) return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'retry-after': '1' }, body: JSON.stringify({ error: { message: 'rate limited' } }) });
    await new Promise((r) => setTimeout(r, delay));
    const a = sys.includes('PHASE A');
    log.phases.push(a ? 'A' : sys.includes('PHASE C') ? 'C' : '?');
    const user = String(body.messages?.[1]?.content || '');
    log.users.push(user);
    log.systems.push(sys);
    const found = [...user.matchAll(/\[#(\d+) \|[^\]]*\] ([^\n]+)/g)];
    const ids = [...new Set(found.map((m) => Number(m[1])))];
    const titles = found.map((m) => m[2].trim());
    log.ids = ids;
    const mm = user.match(/这次的接法：([^（\n]+)（/);
    (log.modes ||= []).push(mm ? mm[1] : '');
    if (!a) cCalls++;
    if (!a && sys.includes('上一次的回答里')) log.recheckPrompt = true;
    const cMode = a ? 'ok' : evidence === 'recheck' && cCalls === 1 ? 'noid' : evidence === 'weak' ? (cCalls === 1 ? 'noid' : 'weak') : 'ok';
    const payload = withIds(a ? MOCK_MAP : conv || MOCK_CONV, ids, titles, cMode);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(payload) + '\n```' } }] }) });
  });
  return log;
}
const MOCK_SETTINGS = (origin, extra = {}) => JSON.stringify({ chat: { baseUrl: origin + '/mock-ai/v1', apiKey: 'e2e-mock', chatModel: 'mock-model', visionModel: '', extraBody: '' }, autoCaption: false, autoEmbed: false, ...extra });
// v0.14 示例是从约 80 条里随机抽的：断言不再写死某几条，而是读库里实际抽到的
async function dbItems(pg) {
  return pg.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('lingan');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const q = r.result.transaction('items').objectStore('items').getAll();
      q.onsuccess = () => { r.result.close(); res(q.result.filter((x) => !x.deletedAt).map((x) => ({ id: x.id, type: x.type, title: x.title, content: x.content || '', creator: x.creator || '', tags: x.tags, sample: x.sample || 0, createdAt: x.createdAt }))); };
      q.onerror = () => rej(q.error);
    };
  }));
}
async function dbItemsFull(pg) {
  return pg.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('lingan');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const q = r.result.transaction('items').objectStore('items').getAll();
      q.onsuccess = () => { r.result.close(); res(q.result.filter((x) => !x.deletedAt).map((x) => ({ id: x.id, title: x.title, why: x.why || '', tags: x.tags }))); };
      q.onerror = () => rej(q.error);
    };
  }));
}
/** 挑一件「好认」的示例：不是摘抄（卡片标题显示原文），标题里没有引号 */
const plainSample = (list, not = []) => list.find((x) => x.sample && x.type !== 'text' && !/["'「」]/.test(x.title) && !not.includes(x.id));
const cardSel = (id) => `.card[data-item-id="${id}"]`;
async function dailyState(pg) {
  return pg.evaluate(() => {
    const el = document.querySelector('.daily-ear');
    if (!el) return null;
    return { day: el.dataset.day, folded: el.classList.contains('folded'), old: [...el.querySelectorAll('.daily-old button[data-item-id]')].map((b) => Number(b.dataset.itemId)), combo: [...el.querySelectorAll('.daily-combo button[data-item-id]')].map((b) => Number(b.dataset.itemId)), comboText: [...el.querySelectorAll('.daily-combo button')].map((b) => b.textContent), untouched: [...el.querySelectorAll('.daily-old li')].map((li) => li.textContent) };
  });
}
const localKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// v0.17 秒搜：e2e 按同一套规则自己数一遍（中文连续出现、英文按词首前缀、多个词都要中），和界面上的计数对账
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+|[a-z0-9\u00c0-\u024f]+/g;
const isCjkWord = (w) => /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(w);
function e2eTerms(q) { return [...new Set([...(q || '').normalize('NFKC').toLowerCase().matchAll(CJK_RE)].map((m) => m[0]))]; }
function e2eMatch(text, terms) {
  const t = (text || '').normalize('NFKC').toLowerCase();
  return terms.length > 0 && terms.every((w) => (isCjkWord(w) ? t.includes(w) : new RegExp('(^|[^a-z0-9\\u00c0-\\u024f])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t)));
}
const itemSearchText = (x) => [x.title, x.creator, x.year, x.content && x.content !== x.title ? x.content : '', x.why, (x.tags || []).join(' · '), x.caption, x.url].filter(Boolean).join('\n');
const devSearchText = (d) => [(d.idea?.title || '').replace(/^《|》$/g, ''), d.idea?.idea, d.idea?.bridge, d.idea?.form, d.idea?.firstStep, d.idea?.experiment, d.theme].filter(Boolean).join('\n');
// v0.21 墓碑：默认只看活着的（不在回收站里的）穗 / 新枝；withTrash = true 连回收站一起
async function dbRaw(pg, store, withTrash = false) {
  return pg.evaluate(({ store, withTrash }) => new Promise((res, rej) => {
    const r = indexedDB.open('lingan');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); return res([]); }
      const q = db.transaction(store).objectStore(store).getAll();
      q.onsuccess = () => { db.close(); res(q.result.filter((x) => withTrash || !x.deletedAt).map((x) => { const { thumb, image, ...rest } = x; void thumb; void image; return rest; })); };
      q.onerror = () => rej(q.error);
    };
  }), { store, withTrash });
}
async function sqType(pg, q) {
  await pg.fill('.sq-input', q);
  await pg.waitForFunction((q) => document.querySelector('.sq-count')?.dataset.q === q, q, { timeout: 3000 });
}
async function sqHeads(pg) {
  return pg.evaluate(() => {
    const n = (sel) => { const m = document.querySelector(sel)?.textContent?.match(/\((\d+)\)/); return m ? Number(m[1]) : 0; };
    return { items: n('.sq-items .sq-sec-head'), branches: n('.sq-branches .sq-sec-head'), total: Number(document.querySelector('.sq-count')?.dataset.n) };
  });
}
/** 输入 → 结果（含高亮）画到屏幕上的耗时：在页面里量，清空后再输入，等计数对上且有黑底命中字，再等一帧绘制 */
async function sqTime(pg, q) {
  return pg.evaluate(async (q) => {
    const inp = document.querySelector('.sq-input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t0 = performance.now();
    set.call(inp, q);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((res) => { const chk = () => (document.querySelector('.sq-count')?.dataset.q === q && document.querySelector('.sq-results mark.hit') ? res() : requestAnimationFrame(chk)); chk(); });
    await new Promise((r) => requestAnimationFrame(r));
    const ms = performance.now() - t0;
    const hit = document.querySelector('.sq-results mark.hit');
    return { q, ms: +ms.toFixed(1), n: Number(document.querySelector('.sq-count').dataset.n), marks: document.querySelectorAll('.sq-results mark.hit').length, markText: hit?.textContent, markBg: hit ? getComputedStyle(hit).backgroundColor : '', core: window.__gleanSearch?.lastMs };
  }, q);
}

async function run(name, viewport) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${name}] pageerror ${e.message}`));
  // 模拟限流时浏览器会打一条 429 的资源错误，那是故意的
  pg.on('console', (m) => m.type() === 'error' && !m.text().includes('status of 429') && errs.push(`[${name}] console ${m.text()}`));
  pg.on('dialog', (d) => d.accept());
  await pg.goto(base);
  await pg.waitForSelector('text=穗仓还是空的');
  await brand(pg, name);
  await studio(pg, name);
  // v0.20 布局：桌面 ≥1024 左侧栏导航 + 顶栏速记胶囊、没有底部固定栏；手机底部 速记胶囊 + 图标导航胶囊、没有侧栏
  const lay = await pg.evaluate(() => ({ sideNav: document.querySelectorAll('.sidebar .nav-btn').length, topQuick: !!document.querySelector('.topbar .quick-input'), dock: !!document.querySelector('.dock'), dockNav: document.querySelectorAll('.dock .nav-btn').length, dockQuick: !!document.querySelector('.dock .quick-input'), navIcons: document.querySelectorAll('.nav-btn svg').length }));
  if (viewport.width >= 1024 ? !(lay.sideNav === 5 && lay.topQuick && !lay.dock) : !(lay.dock && lay.dockNav === 5 && lay.dockQuick && !lay.sideNav)) errs.push(`[${name}] layout wrong ${JSON.stringify(lay)}`);
  if (lay.navIcons !== 5) errs.push(`[${name}] nav should have 5 icons, got ${lay.navIcons}`);
  const title0 = await pg.locator('.page-title').innerText();
  if (title0.replace(/\s+/g, '') !== '穗仓(0)') errs.push(`[${name}] empty title should be 穗仓 (0), got ${title0}`);
  // 字体自托管：不从任何外部域名拉字体
  const ext = await pg.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /\.(woff2?|ttf|otf)/.test(u) && !u.startsWith(location.origin)));
  if (ext.length) errs.push(`[${name}] external fonts ${ext.join(',')}`);
  const fontsOk = await pg.evaluate(async () => {
    await Promise.all([document.fonts.load('600 56px "Glean Sans"', '穗仓'), document.fonts.load('16px "Glean Sans"', '《一一》'), document.fonts.load('600 20px "Glean Inter"', 'GLEAN (10)')]);
    return [['600 56px "Glean Sans"', '穗仓'], ['16px "Glean Sans"', '《一一》'], ['600 20px "Glean Inter"', 'GLEAN']].map(([f, t]) => [f, document.fonts.check(f, t)]);
  });
  for (const [f, ok] of fontsOk) if (!ok) errs.push(`[${name}] font not loaded: ${f}`);
  if ((await pg.locator('.empty .steps3 li').count()) !== 3) errs.push(`[${name}] empty state should list 3 ways to add`);
  await pg.screenshot({ path: `${out}/${name}-0-empty.png`, fullPage: true });
  // capture one manually
  await pg.click('.empty button:has-text("拾第一穗")');
  await pg.fill('.capture .field.big input', '重庆森林');
  await pg.click('.capture .chip:has-text("电影")');
  await pg.fill('.capture input[maxlength="80"]', '王家卫');
  await pg.click('.capture .more-toggle');
  await pg.fill('.capture .field.why input', '凤梨罐头的过期日期像一份情书');
  await pg.fill('.capture input[placeholder="雨 克制 慢镜头"]', '香港 罐头 霓虹');
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.card:has-text("重庆森林")');
  // validation: empty save
  await pg.click('.quick-more');
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.error');
  await pg.click('.capture button:has-text("取消")');
  // samples via settings import? use samples button not visible now; add via db through UI: delete flow test later
  await pg.evaluate(async () => {});
  // load samples: wipe then samples
  await pg.click('.nav-btn:has-text("设置")');
  await pg.click('button:has-text("清空")');
  // v0.16 确认弹层替代系统 confirm：清空要确认两次
  await pg.waitForSelector('.confirm:has-text("清空所有穗和新枝")');
  await studio(pg, name + '-confirm');
  await pg.click('.confirm-ok');
  // v0.26 0622：先导出备份，存好了才问第二次
  await pg.waitForSelector('.confirm:has-text("备份存好了")');
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("已清空")');
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  await pg.waitForTimeout(400);
  // v0.14 示例：随机 10 条、标着「示例」、六种类型都有
  const sm = (await dbItems(pg)).filter((x) => x.sample);
  if (sm.length !== 10) errs.push(`[${name}] expected 10 samples got ${sm.length}`);
  if (new Set(sm.map((x) => x.type)).size !== 6) errs.push(`[${name}] samples should cover 6 types: ${sm.map((x) => x.type)}`);
  if ((await pg.locator('.card[data-sample="1"] .sample-badge:has-text("示例")').count()) !== 10) errs.push(`[${name}] sample badge missing`);
  if (!(await pg.locator('.samples-bar .samples-clear').count())) errs.push(`[${name}] clear-samples button missing`);
  const A = plainSample(sm);
  const B = plainSample(sm, [A?.id]);
  if (!A || !B) throw new Error('no plain samples to test with ' + JSON.stringify(sm.map((x) => x.title)));
  // 每日一穗在示例上也出现（只有示例时示例也算）
  await pg.waitForSelector('.daily-ear', { timeout: 4000 }).catch(() => errs.push(`[${name}] daily card missing after samples`));
  // v0.3 quick bar: type + Enter saves, time shown, optional why after save
  await pg.fill('.quick-input', '速记测试一句 #速记');
  await pg.press('.quick-input', 'Enter');
  await pg.waitForSelector('.quick-ok:has-text("已拾")', { timeout: 1500 }).catch(() => errs.push(`[${name}] 已拾 hint missing`));
  await pg.waitForSelector('.card:has-text("速记测试一句")');
  const when = await pg.locator('.card:has-text("速记测试一句") .card-when').innerText();
  if (!when.startsWith('今天')) errs.push(`[${name}] card time expected 今天 got ${when}`);
  // v0.16 网格图块不再印标签和「为什么」：改读库核对
  if (!(await dbItemsFull(pg)).some((x) => x.title.startsWith('速记测试一句') && x.tags.includes('速记'))) errs.push(`[${name}] quick tag missing`);
  await pg.fill('.quick-why', '因为很安静 #夜');
  await pg.press('.quick-why', 'Enter');
  await pg.waitForSelector('.toast:has-text("已补上")');
  if (!(await dbItemsFull(pg)).some((x) => x.why === '因为很安静' && x.tags.includes('夜'))) errs.push(`[${name}] quick why not saved`);
  if (await pg.locator('.quick-after').count()) errs.push(`[${name}] quick-after should close`);
  // clipboard offer
  const clipText = `剪贴板里的一句话 ${name}`;
  await pg.evaluate((t) => navigator.clipboard.writeText(t), clipText);
  await pg.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pg.waitForSelector('.clip-offer', { timeout: 5000 });
  await pg.screenshot({ path: `${out}/${name}-1b-clip.png` });
  await pg.click('.clip-offer .clip-take');
  await pg.waitForSelector(`.card:has-text("${clipText}")`);
  await pg.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pg.waitForTimeout(700);
  if (await pg.locator('.clip-offer').count()) errs.push(`[${name}] clip offered twice`);
  await pg.evaluate(() => navigator.clipboard.writeText(''));
  // android share bridge
  await pg.evaluate(() => { let n = 1; window.LinganShare = { take: () => (n-- > 0 ? JSON.stringify({ text: 'https://example.com/shared', subject: '分享来的文章' }) : '') }; window.dispatchEvent(new Event('focus')); });
  await pg.waitForSelector('.card:has-text("分享来的文章")', { timeout: 5000 }).catch(() => errs.push(`[${name}] share intake failed`));
  await pg.screenshot({ path: `${out}/${name}-1-library.png`, fullPage: true });
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.waitForTimeout(900);
  await pg.screenshot({ path: `${out}/${name}-shot-library.png` });
  await noOverlap(pg, name);
  // v0.17 秒搜：输入即出结果、命中字黑底白字；类型 / 标签 / 日期 筛选可叠加；结果与按同一规则数出来的完全一致
  await pg.click('.search-toggle');
  await pg.waitForSelector('.search-view .sq-input');
  if (!(await pg.evaluate(() => document.activeElement?.classList.contains('sq-input')))) errs.push(`[${name}] search input not focused`);
  await studio(pg, name + '-search');
  const all = await dbItems(pg);
  const rawItems = await dbRaw(pg, 'items');
  const kw = A.title;
  const expectItems = (q, pred = () => true) => rawItems.filter((x) => pred(x) && e2eMatch(itemSearchText(x), e2eTerms(q))).length;
  await sqType(pg, kw);
  const h1 = await sqHeads(pg);
  if (h1.items !== expectItems(kw)) errs.push(`[${name}] search ${kw}: 穗 (${h1.items}) expected ${expectItems(kw)}`);
  if (!(await pg.locator(`.sq-items .sq-row[data-item-id="${A.id}"] mark.hit`).count())) errs.push(`[${name}] search hit not highlighted for #${A.id}`);
  if (h1.branches !== 0) errs.push(`[${name}] 新枝 (n) section wrong ${h1.branches}`);
  const markBg = await pg.locator('.sq-results mark.hit').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  if (markBg !== 'rgb(212, 203, 229)') errs.push(`[${name}] hit should be highlighted with the lilac accent, got ${markBg}`);
  await pg.screenshot({ path: `${out}/${name}-1c-search.png` });
  // 刚用速记存的那一穗已经进了索引（增量）：搜得到、而且索引表里有它的行
  await sqType(pg, '速记测试');
  if ((await sqHeads(pg)).items !== 1) errs.push(`[${name}] freshly captured item not searchable`);
  const quickRow = rawItems.find((x) => x.title.startsWith('速记测试一句'));
  await pg.waitForFunction(() => window.__gleanSearch?.ready, null, { timeout: 8000 }).catch(() => errs.push(`[${name}] search index never ready`));
  const ftRows = await dbRaw(pg, 'ftidx');
  const qr = ftRows.find((r) => r.key === `i:${quickRow?.id}`);
  if (!qr || !qr.tok.includes('速记') || !qr.tok.includes('记测')) errs.push(`[${name}] quick item not in ftidx ${JSON.stringify(qr?.tok?.slice(0, 6))}`);
  // 英文按词首前缀（示例里有拉丁字母的作者 / 标题就用它测）
  const latin = rawItems.map((x) => (`${x.creator || ''} ${x.title}`.match(/[A-Za-z]{4,}/) || [])[0]).find(Boolean);
  if (latin) {
    const pre = latin.slice(0, 3).toLowerCase();
    await sqType(pg, pre);
    const hl = await sqHeads(pg);
    if (hl.items !== expectItems(pre) || hl.items < 1) errs.push(`[${name}] prefix "${pre}" 穗 (${hl.items}) expected ${expectItems(pre)}`);
  }
  // 两个字 + 类型 / 日期 / 标签叠加：挑一个出现在 ≥2 穗里的中文二字词
  const bi = (() => {
    const m = new Map();
    for (const x of rawItems) { const seen = new Set(); for (const r of itemSearchText(x).match(/[\u4e00-\u9fff]{2,}/g) || []) for (let i = 0; i + 1 < r.length; i++) seen.add(r.slice(i, i + 2)); for (const k of seen) m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '速记';
  })();
  await sqType(pg, bi);
  const h2 = await sqHeads(pg);
  if (h2.items !== expectItems(bi)) errs.push(`[${name}] search ${bi}: 穗 (${h2.items}) expected ${expectItems(bi)}`);
  const ty = await pg.locator('.sq-type').first().getAttribute('data-type');
  if (ty && ty !== 'branch') {
    await pg.click(`.sq-type[data-type="${ty}"]`);
    const ht = await sqHeads(pg);
    if (ht.items !== expectItems(bi, (x) => x.type === ty)) errs.push(`[${name}] ${bi} + type ${ty}: ${ht.items} expected ${expectItems(bi, (x) => x.type === ty)}`);
    await pg.click(`.sq-type[data-type="${ty}"]`);
  }
  const startToday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
  await pg.click('.sq-range[data-range="7d"]');
  const h7 = await sqHeads(pg);
  if (h7.items !== expectItems(bi, (x) => x.createdAt >= startToday - 6 * 864e5)) errs.push(`[${name}] ${bi} + 近 7 天: ${h7.items} expected ${expectItems(bi, (x) => x.createdAt >= startToday - 6 * 864e5)}`);
  await pg.click('.sq-range[data-range="custom"]');
  const d0 = localKey(Date.now() - 30 * 864e5);
  const d1 = localKey(Date.now() - 2 * 864e5);
  await pg.fill('.sq-from', d0);
  await pg.fill('.sq-to', d1);
  const lo = new Date(d0 + 'T00:00').getTime();
  const hi = new Date(d1 + 'T00:00').getTime() + 864e5;
  const hcu = await sqHeads(pg);
  if (hcu.items !== expectItems(bi, (x) => x.createdAt >= lo && x.createdAt < hi)) errs.push(`[${name}] ${bi} + ${d0}~${d1}: ${hcu.items} expected ${expectItems(bi, (x) => x.createdAt >= lo && x.createdAt < hi)}`);
  await pg.click('.sq-range[data-range="all"]');
  const tg = await pg.locator('.sq-tag').first().getAttribute('data-tag').catch(() => null);
  if (tg) {
    await pg.click(`.sq-tag[data-tag="${tg}"]`);
    const hg = await sqHeads(pg);
    if (hg.items !== expectItems(bi, (x) => x.tags.includes(tg))) errs.push(`[${name}] ${bi} + #${tg}: ${hg.items} expected ${expectItems(bi, (x) => x.tags.includes(tg))}`);
    await pg.screenshot({ path: `${out}/${name}-1d-search-filters.png` });
    await pg.click(`.sq-tag[data-tag="${tg}"]`);
  }
  // 断网照样搜
  await ctx.setOffline(true);
  await sqType(pg, kw);
  if ((await sqHeads(pg)).items !== expectItems(kw)) errs.push(`[${name}] offline search broken`);
  await ctx.setOffline(false);
  // 没找到：给出可点的提示
  await sqType(pg, '琥珀色的猫头鹰');
  if ((await sqHeads(pg)).total !== 0 || !(await pg.locator('.sq-none').count())) errs.push(`[${name}] no-result state missing`);
  // 点结果 → 详情；「最近搜过」记下了刚才的词
  await sqType(pg, kw);
  await pg.click(`.sq-row[data-item-id="${A.id}"]`);
  await pg.waitForSelector('.detail');
  await pg.click('.sheet .icon-btn[aria-label="关闭"]');
  await pg.fill('.sq-input', '');
  await pg.waitForSelector('.sq-recent-q', { timeout: 3000 }).catch(() => errs.push(`[${name}] 最近搜过 missing`));
  if (!(await pg.locator(`.sq-recent-q:has-text("${kw}")`).count())) errs.push(`[${name}] recent search not recorded`);
  await pg.click('.sq-cancel');
  await pg.waitForSelector('.masonry .card');
  await pg.click('.chips.scroll .chip:has-text("音乐")');
  const m = await pg.locator('.masonry .card').count();
  const expM = all.filter((x) => x.type === 'music').length;
  if (m !== expM) errs.push(`[${name}] filter music expected ${expM} got ${m}`);
  await pg.click('.chips.scroll .chip:has-text("全部")');
  // detail
  await pg.click(cardSel(A.id));
  if (!(await pg.locator('.sheet:has-text("示例 · ")').count())) errs.push(`[${name}] sample detail not labelled 示例`);
  await pg.waitForSelector('.detail');
  await pg.fill('.when-input', '2025-10-19T08:30');
  await pg.waitForSelector('.toast:has-text("时间已改")');
  await pg.screenshot({ path: `${out}/${name}-2-detail.png` });
  await studio(pg, name + '-detail');
  await pg.click('.detail-graft');
  await pg.waitForSelector('.graft');
  await pg.click('.graft-btn');
  await pg.waitForSelector('.idea', { timeout: 10000 });
  await pg.waitForTimeout(1300);
  await pg.screenshot({ path: `${out}/${name}-3-develop.png`, fullPage: true });
  await pg.waitForFunction(() => !document.querySelector('.idea .tw-rest'), null, { timeout: 9000 }).catch(() => {});
  await pg.evaluate(() => { const el = document.querySelector('.graft'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${out}/${name}-shot-graft.png` });
  // v0.16 动效只有淡入：新枝块用 g-fade 进场（减少动效时为 none），标题直接是完整文字（不再解码 / 逐字浮现）
  const mv = await pg.evaluate(() => document.documentElement.dataset.motion);
  if (!['full', 'lite', 'off'].includes(mv)) errs.push(`[${name}] data-motion missing: ${mv}`);
  const fade = await pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => ({ anim: getComputedStyle(e).animationName, title: e.querySelector('.idea-title')?.textContent || '', n: e.querySelector('.numeral')?.textContent })));
  if (fade.length !== 3 || fade.some((f) => !f.title || /《《|》》/.test(f.title))) errs.push(`[${name}] branch titles wrong ${JSON.stringify(fade)}`);
  if (fade.map((f) => f.n).join(',') !== '01,02,03') errs.push(`[${name}] branch numerals should be 01 02 03, got ${fade.map((f) => f.n)}`);
  if (mv !== 'off' && fade.some((f) => f.anim !== 'g-fade')) errs.push(`[${name}] branch fade-in missing ${fade.map((f) => f.anim)}`);
  await studio(pg, name + '-graft');
  // v0.12 从一穗出发也会凑够 3 穗；离线新枝同样能点回 ≥3 穗
  const offPicked = await pg.locator('.graft .pair-item').count();
  if (offPicked !== 3) errs.push(`[${name}] graft from one item should pick 3, got ${offPicked}`);
  await pg.waitForSelector('.three .idea .sprig', { timeout: 5000 }).catch(() => errs.push(`[${name}] offline sprigs missing`));
  const offSpr = await pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => ({ n: e.querySelectorAll('.sprig').length, ev: e.dataset.evidence })));
  if (offSpr.some((x) => x.n < 3 || x.ev !== 'ok')) errs.push(`[${name}] offline provenance wrong ${JSON.stringify(offSpr)}`);
  await pg.click('.idea .idea-keep');
  await pg.waitForSelector('.idea .idea-keep:has-text("已留下")');
  await pg.click('.controls .shuffle');
  await pg.click('.seg button:has-text("4")');
  await pg.click('.controls .shuffle');
  const negs = await pg.locator('.graft .pair-item').count();
  if (negs !== 4) errs.push(`[${name}] expected 4 picked got ${negs}`);
  await pg.click('.graft-btn');
  await pg.waitForSelector('.after-note');
  await brand(pg, name);
  // v0.10 新枝页
  await pg.click('.nav-btn:has-text("新枝")');
  await pg.waitForSelector('.hrow');
  await brand(pg, name);
  const hist = await pg.locator('.hrow').count();
  if (hist !== 6) errs.push(`[${name}] expected 6 branches (2×3) got ${hist}`);
  const nb = await pg.locator('.hbatch').count();
  if (nb !== 2) errs.push(`[${name}] expected 2 graft batches got ${nb}`);
  // v0.11 一次三枝 · 模拟模型：第 1 次 429 → 退避重试；2 次正式调用（A+B / C+D）；模型撞了变形也要修成三根两两不同
  await pg.evaluate((v) => localStorage.setItem('lingan.settings.v1', v), MOCK_SETTINGS(new URL(base).origin));
  const ai = await mockAI(pg, { fail429: 1, delay: 700, evidence: 'recheck' });
  await pg.reload();
  await pg.waitForSelector('.view');
  await pg.click('.nav-btn:has-text("嫁接")');
  await pg.click('.controls button:has-text("抽几穗")');
  await pg.click('.graft-btn');
  await pg.waitForSelector('.growing[data-stage="map"]', { timeout: 3000 }).catch(() => errs.push(`[${name}] growing progress missing`));
  await pg.waitForSelector('.growing .grow-line:has-text("秒后再试")', { timeout: 4000 }).catch(() => errs.push(`[${name}] retry notice missing`));
  if ((await pg.locator('.grow-steps li').count()) !== 4) errs.push(`[${name}] expected 4 grow steps`);
  await pg.waitForSelector('.growing[data-stage="defix"]', { timeout: 8000 }).catch(() => errs.push(`[${name}] stage defix never shown`));
  // v0.12 第一次回答没带素材 ID → 界面提示重长一次
  await pg.waitForSelector('.growing[data-recheck="1"]', { timeout: 8000 }).catch(() => errs.push(`[${name}] evidence recheck notice missing`));
  await pg.waitForSelector('.three .idea', { timeout: 15000 });
  const three = await pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => ({ t: e.dataset.transform, src: e.querySelector('.idea-src')?.textContent, exp: !!e.querySelector('.idea-exp'), un: !!e.querySelector('.idea-unlike'), title: e.querySelector('.idea-title .decode')?.getAttribute('aria-label') || e.querySelector('.idea-title')?.textContent })));
  if (three.length !== 3) errs.push(`[${name}] AI graft expected 3 branches got ${three.length}`);
  if (new Set(three.map((x) => x.t)).size !== 3 || three.some((x) => !x.t)) errs.push(`[${name}] transforms not distinct ${JSON.stringify(three.map((x) => x.t))}`);
  if (three.some((x) => x.src !== 'AI 嫁接')) errs.push(`[${name}] AI branch source wrong ${three.map((x) => x.src)}`);
  if (three.some((x) => !x.exp || !x.un)) errs.push(`[${name}] branch missing experiment/unlike`);
  if (three.some((x) => (x.title || '').includes('撞了变形'))) errs.push(`[${name}] duplicate-transform branch not dropped`);
  if (ai.calls !== 4 || ai.phases.join('') !== 'ACC') errs.push(`[${name}] AI calls expected 4 (429+A+C+C recheck) got ${ai.calls} ${ai.phases.join('')}`);
  if (!ai.recheckPrompt) errs.push(`[${name}] recheck prompt did not tell the model what was wrong`);
  // v0.18 抽几穗按当前接法（默认远距）抽，两步调用都把接法写进 prompt
  if (!ai.modes || ai.modes.length < 3 || ai.modes.some((x) => x !== '远距')) errs.push(`[${name}] AI prompt should carry 接法 远距 got ${JSON.stringify(ai.modes)}`);
  if ((await pg.locator('.three-mode').innerText().catch(() => '')).indexOf('远距') < 0) errs.push(`[${name}] result head should say 远距`);
  // v0.12 溯源：每根 AI 新枝都能点回 ≥3 件自己的穗，且都在这次嫁接的素材里
  const picked = await pg.evaluate(() => [...document.querySelectorAll('.graft .pair-item .card-title')].map((e) => e.textContent));
  const prov = await pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => ({ ev: e.dataset.evidence, ids: [...e.querySelectorAll('.sprig[data-item-id]')].map((x) => Number(x.dataset.itemId)), titles: [...e.querySelectorAll('.sprig .sprig-title')].map((x) => x.textContent), weak: !!e.querySelector('.sprigs-weak') })));
  for (const [i, p] of prov.entries()) {
    if (p.ev !== 'ok' || p.weak) errs.push(`[${name}] AI branch ${i} evidence ${p.ev}`);
    if (new Set(p.ids).size < 3) errs.push(`[${name}] AI branch ${i} points back to ${p.ids.length} ears`);
    if (p.ids.some((x) => !ai.ids.includes(x))) errs.push(`[${name}] AI branch ${i} sprig not from this graft ${p.ids} vs ${ai.ids}`);
    // 摘抄类穗的卡片标题显示的是原文，小穗卡显示出处，没法按字面对上，这类只靠上面的 ID 校验
    // v0.16 摘抄卡显示原文时用弯引号 “…”（以前是「…」），同样跳过；电影标题带书名号，比对时去掉
    const bare = (q) => (q || '').replace(/^[「“《]|[」”》]$/g, '');
    if (!picked.some((q) => /^[「“]/.test(q || '')) && p.titles.some((t) => !picked.some((q) => bare(q).includes(t) || t.includes(bare(q))))) errs.push(`[${name}] sprig titles ${p.titles} not among picked ${picked}`);
  }
  // 正文里提到的穗：悬停（桌面）/ 点按（手机）时对应那一穗亮起
  await pg.waitForSelector('.three .idea .mention', { timeout: 9000 }).catch(() => errs.push(`[${name}] mention not marked in body`));
  if (await pg.locator('.three .idea .mention').count()) {
    const m0 = pg.locator('.three .idea .mention').first();
    const mid = await m0.getAttribute('data-item-id');
    if (viewport.width < 760) await m0.click();
    else await m0.hover();
    const lit = await pg.locator(`.three .idea:has(.mention[data-item-id="${mid}"]) .sprig.on[data-item-id="${mid}"]`).count();
    if (lit !== 1) errs.push(`[${name}] mention did not light up its sprig (${mid})`);
  }
  // 点穗卡 → 直达那件穗的详情
  const firstSprig = pg.locator('.three .idea').first().locator('.sprig[data-item-id]').first();
  const sprigTitle = await firstSprig.locator('.sprig-title').innerText();
  await firstSprig.click();
  await pg.waitForSelector('.detail', { timeout: 3000 }).catch(() => errs.push(`[${name}] sprig did not open detail`));
  const dtl = await pg.locator('.sheet').innerText().catch(() => '');
  if (!dtl.includes(sprigTitle)) errs.push(`[${name}] detail is not ${sprigTitle}`);
  await pg.screenshot({ path: `${out}/${name}-3c-sprig-detail.png` });
  await pg.click('.sheet .icon-btn[aria-label="关闭"]');
  await pg.click('.view > .trail summary');
  const trail = await pg.evaluate(() => ({ t: document.querySelectorAll('.view > .trail .trail-tensions li').length, s: document.querySelectorAll('.view > .trail .trail-seeds li').length, r: document.querySelectorAll('.view > .trail .trail-seeds li.replaced').length, c: document.querySelectorAll('.view > .trail .trail-seeds li.chosen').length }));
  if (trail.t !== 4 || trail.s !== 8 || trail.r !== 3 || trail.c !== 3) errs.push(`[${name}] trail wrong ${JSON.stringify(trail)}`);
  if (!(await pg.locator('.cliches-row s').count())) errs.push(`[${name}] cliches row missing`);
  await pg.screenshot({ path: `${out}/${name}-3b-three.png`, fullPage: true });
  await brand(pg, name);
  // v0.12 故意喂不带 / 编造 ID 的回答：重来一次仍不行 → 两根标「证据不足」，不假装正常
  await pg.unroute('**/mock-ai/v1/chat/completions');
  const bad = await mockAI(pg, { delay: 200, evidence: 'weak' });
  await pg.click('.controls .shuffle');
  await pg.click('.graft-btn');
  await pg.waitForSelector('.three .idea', { timeout: 15000 });
  await pg.waitForTimeout(300);
  const wk = await pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => ({ ev: e.dataset.evidence, badge: e.querySelector('.weak-badge')?.textContent, note: e.querySelector('.sprigs-weak')?.textContent || '' })));
  if (bad.calls !== 3 || bad.phases.join('') !== 'ACC') errs.push(`[${name}] weak run should retry exactly once, got ${bad.phases.join('')}`);
  if (wk.filter((x) => x.ev === 'weak').length !== 2) errs.push(`[${name}] expected 2 weak branches ${JSON.stringify(wk.map((x) => x.ev))}`);
  if (wk.filter((x) => x.ev === 'weak').some((x) => x.badge !== '证据不足' || !x.note.includes('证据不足'))) errs.push(`[${name}] weak branch not labelled 证据不足`);
  if (wk.filter((x) => x.ev === 'ok').length !== 1) errs.push(`[${name}] expected 1 ok branch in weak run`);
  await pg.waitForSelector('.toast:has-text("证据不足")', { timeout: 3000 }).catch(() => errs.push(`[${name}] weak toast missing`));
  await pg.screenshot({ path: `${out}/${name}-3d-weak.png`, fullPage: true });
  await pg.click('.nav-btn:has-text("新枝")');
  await pg.waitForSelector('.hbatch');
  if ((await pg.locator('.hbatch').count()) !== 4) errs.push(`[${name}] expected 4 batches after AI grafts`);
  if ((await pg.locator('.hrow .hrow-weak').count()) !== 2) errs.push(`[${name}] branches page should flag 2 weak rows`);
  // 新枝页里展开一根，同样能点回穗
  await pg.locator('.hbatch >> nth=1 >> .hrow-head').first().click();
  await pg.waitForFunction(() => document.querySelectorAll('.hrow.open .sprig[data-item-id]').length >= 3, null, { timeout: 4000 }).catch(async () => errs.push(`[${name}] history row sprigs < 3 (${await pg.locator('.hrow.open .sprig[data-item-id]').count()})`));
  await pg.locator('.hrow.open .hrow-head').click();
  await pg.click('.hbatch >> nth=0 >> .hbatch-star');
  await pg.waitForSelector('.toast:has-text("三根都留下了")', { timeout: 3000 }).catch(() => errs.push(`[${name}] star-all toast missing`));
  await pg.click('.chip:has-text("只看留下的")');
  const starredRows = await pg.locator('.hrow').count();
  if (starredRows !== 4) errs.push(`[${name}] starred rows expected 4 (1+3) got ${starredRows}`);
  await pg.click('.chip:has-text("只看留下的")');
  // v0.16 新枝 Manifesto：黑底大字，一次一根，提到的穗用细体
  await pg.click('.manifesto-toggle');
  await pg.waitForSelector('.manifesto .mf-text');
  const mf = await pg.evaluate(() => { const m = document.querySelector('.manifesto'); return { bg: getComputedStyle(m).backgroundColor, fg: getComputedStyle(m).color, text: m.querySelector('.mf-text').textContent, pages: m.querySelectorAll('.mf-pages button').length }; });
  // v0.20：宣言是一张深墨色大卡（#1f1c24 底、暖白字），页面其余部分保持当前主题
  const appTheme = await pg.evaluate(() => document.querySelector('.app')?.getAttribute('data-theme'));
  if (mf.bg !== 'rgb(31, 28, 36)' || mf.fg !== 'rgb(247, 245, 241)' || !mf.text || mf.pages < 1 || appTheme === 'dark') errs.push(`[${name}] manifesto wrong ${JSON.stringify(mf)} app=${appTheme}`);
  await pg.screenshot({ path: `${out}/${name}-3e-manifesto.png` });
  await pg.click('.view-switch button:has-text("列表")');
  // v0.17 搜索也覆盖新枝：搜新枝标题里的两个字 → 「新枝 (n)」与按规则数出来的一致 → 点开直达那一根
  const rawDevs = await dbRaw(pg, 'developments');
  const devT = (rawDevs.find((d) => /[\u4e00-\u9fff]{2}/.test(d.idea?.title || ''))?.idea.title || '').replace(/^《/, '').match(/[\u4e00-\u9fff]{2}/)?.[0];
  if (devT) {
    await pg.click('.nav-btn:has-text("穗仓")');
    await pg.click('.search-toggle');
    await sqType(pg, devT);
    const hb = await sqHeads(pg);
    const expB = rawDevs.filter((d) => e2eMatch(devSearchText(d), e2eTerms(devT))).length;
    if (hb.branches !== expB || expB < 1) errs.push(`[${name}] branch search ${devT}: 新枝 (${hb.branches}) expected ${expB}`);
    if (!(await pg.locator('.sq-branch mark.hit').count())) errs.push(`[${name}] branch hit not highlighted`);
    await pg.screenshot({ path: `${out}/${name}-3f-search-branch.png`, fullPage: true });
    const bid = await pg.locator('.sq-branch').first().getAttribute('data-dev-id');
    await pg.click('.sq-branch >> nth=0');
    await pg.waitForSelector(`.hrow.open.focus[data-dev-id="${bid}"]`, { timeout: 3000 }).catch(() => errs.push(`[${name}] branch result did not open that branch`));
  } else errs.push(`[${name}] no branch title to search`);
  await pg.unroute('**/mock-ai/v1/chat/completions');
  await pg.evaluate(() => localStorage.removeItem('lingan.settings.v1'));
  await pg.reload();
  await pg.waitForSelector('.view');
  // taste
  await pg.click('.nav-btn:has-text("口味")');
  await pg.waitForSelector('.stat-n');
  // v0.6 热力图：365 格，今天那格有素材，点它列出当天素材
  await pg.waitForSelector('.heat-grid');
  const hc = await pg.locator('.heat-cell[role=gridcell]').count();
  if (hc !== 365) errs.push(`[${name}] heat cells expected 365 got ${hc}`);
  const todayLv = await pg.locator('.heat-cell[role=gridcell]').last().getAttribute('class');
  if (/lv0/.test(todayLv || '')) errs.push(`[${name}] today heat cell empty`);
  await pg.locator('.heat-cell[role=gridcell]').last().click();
  await pg.waitForSelector('.heat-day .heat-list li');
  await brand(pg, name);
  await pg.screenshot({ path: `${out}/${name}-4-taste.png`, fullPage: true });
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${out}/${name}-shot-taste.png` });
  // v0.7 时间线（v0.16 按周成带）+ v0.16 列表 / 月历
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.click('.view-switch button:has-text("时间线")');
  await pg.waitForSelector('.tl-day .tl-frame');
  const nAll = (await dbItems(pg)).length;
  const tlN = await pg.locator('.tl-day .tl-frame').count();
  if (tlN !== nAll) errs.push(`[${name}] timeline rows ${tlN} != ${nAll}`);
  await pg.screenshot({ path: `${out}/${name}-4b-timeline.png`, fullPage: true });
  await pg.click('.view-switch button:has-text("列表")');
  await pg.waitForSelector('.list-view .trow');
  const lr = await pg.evaluate(() => ({ rows: document.querySelectorAll('.list-view .trow').length, head: getComputedStyle(document.querySelector('.list-view .thead')).borderBottomWidth, rowLine: getComputedStyle(document.querySelector('.list-view .trow')).borderBottomWidth }));
  if (lr.rows !== nAll || lr.head !== '1px' || lr.rowLine !== '0px') errs.push(`[${name}] list view wrong ${JSON.stringify(lr)} (n=${nAll})`);
  await pg.click('.view-switch button:has-text("月历")');
  await pg.waitForSelector('.cal-grid');
  const today = new Date();
  const todayKeyStr = localKey(today.getTime());
  const nToday = (await dbItems(pg)).filter((x) => localKey(x.createdAt) === todayKeyStr).length;
  await pg.click(`.cal-cell[aria-label^="${todayKeyStr}"]`);
  const calRows = await pg.locator('.cal-day .trow').count();
  if (calRows !== nToday || !(await pg.locator(`.cal-cell.has[aria-label^="${todayKeyStr}"]`).count())) errs.push(`[${name}] calendar today ${calRows} rows vs ${nToday}`);
  const calTitle = await pg.locator('.cal-title').innerText();
  const nMonth = (await dbItems(pg)).filter((x) => { const d = new Date(x.createdAt); return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(); }).length;
  if (!calTitle.includes(`(${nMonth})`)) errs.push(`[${name}] calendar count ${calTitle} vs ${nMonth}`);
  await pg.screenshot({ path: `${out}/${name}-4c-calendar.png`, fullPage: true });
  await pg.click('.view-switch button:has-text("网格")');
  await pg.click('.nav-btn:has-text("口味")');
  // settings + theme
  await pg.click('.nav-btn:has-text("设置")');
  await brand(pg, name);
  await pg.click('.theme-seg button:has-text("黑")');
  // 换主题要经过 设置 → effect → 写 dataset 两拍渲染，等它落定再读
  await pg.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 3000 }).catch(() => {});
  const sky = await pg.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  if (sky[0] !== 'dark' || sky[1] !== 'rgb(23, 22, 26)') errs.push(`[${name}] dark theme not applied: ${sky}`);
  await pg.screenshot({ path: `${out}/${name}-5-settings-dark.png`, fullPage: true });
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.screenshot({ path: `${out}/${name}-6-library-dark.png`, fullPage: true });
  const w2 = await pg.locator(`${cardSel(A.id)} .card-when`).innerText();
  if (w2 !== '2025/10/19') errs.push(`[${name}] edited time expected 2025/10/19 got ${w2}`);
  // edit + delete
  await pg.click(cardSel(B.id));
  await pg.click('.detail button:has-text("编辑")');
  await pg.fill('.capture .field.big input', `${B.title} (edited)`);
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.card:has-text("(edited)")');
  // v0.16 删除：确认弹层 → 撤销 toast（撤销后原样回来）→ 再删一次
  await pg.click('.card:has-text("(edited)")');
  await pg.click('.detail button:has-text("删除")');
  await pg.waitForSelector('.confirm .confirm-ok:has-text("删掉")');
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("已删掉 1 穗") .toast-act:has-text("撤销")');
  if (await pg.locator('.card:has-text("(edited)")').count()) errs.push(`[${name}] delete failed`);
  await pg.screenshot({ path: `${out}/${name}-6b-undo.png` });
  await pg.click('.toast-act:has-text("撤销")');
  await pg.waitForSelector('.card:has-text("(edited)")', { timeout: 3000 }).catch(() => errs.push(`[${name}] undo did not restore`));
  await pg.click('.card:has-text("(edited)")');
  await pg.click('.detail button:has-text("删除")');
  await pg.click('.confirm-ok');
  await pg.waitForTimeout(300);
  if (await pg.locator('.card:has-text("(edited)")').count()) errs.push(`[${name}] delete failed`);
  // reload persistence
  await pg.reload();
  await pg.waitForSelector(cardSel(A.id));
  const th = await pg.evaluate(() => document.documentElement.dataset.theme);
  if (th !== 'dark') errs.push(`[${name}] theme not persisted: ${th}`);
  // v0.4 ASCII 显影：塞一张图片素材（直接写 IndexedDB），刷新后应先出字符画再显影成照片
  await pg.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 200;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 320, 200);
    gr.addColorStop(0, '#222'); gr.addColorStop(0.5, '#e0452a'); gr.addColorStop(1, '#f5f0e7');
    g.fillStyle = gr; g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(160, 100, 50, 0, 7); g.fill();
    const url = c.toDataURL('image/jpeg', 0.8);
    await new Promise((res, rej) => {
      const r = indexedDB.open('lingan');
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction('items', 'readwrite');
        const now = Date.now();
        tx.objectStore('items').add({ type: 'image', title: '渐变测试图', image: url, tags: [], createdAt: now, updatedAt: now });
        tx.oncomplete = () => res(null);
        tx.onerror = () => rej(tx.error);
      };
    });
  });
  await pg.reload();
  await pg.waitForSelector('.card:has-text("渐变测试图")');
  // v0.14 穗仓顶部多了「今日一穗」和示例条，新卡片可能在首屏下面：滚到它（显影只在看得见时播）
  await pg.locator('.card:has-text("渐变测试图")').scrollIntoViewIfNeeded();
  // v0.16 不再 ASCII 显影：满铺照片解码好后淡入，底部压暗小字说明
  await pg.waitForSelector('.card:has-text("渐变测试图") img.card-img.loaded', { timeout: 5000 });
  const capColor = await pg.locator('.card:has-text("渐变测试图") .card-title').evaluate((e) => getComputedStyle(e).color);
  if (capColor !== 'rgb(255, 255, 255)') errs.push(`[${name}] photo caption should be white, got ${capColor}`);
  await pg.screenshot({ path: `${out}/${name}-7-photo.png` });
  const iw = await pg.locator('.card:has-text("渐变测试图") img.card-img').evaluate((i) => i.naturalWidth);
  if (iw < 10) errs.push(`[${name}] ascii image not loaded`);
  // v0.17 一整轮增删改（速记、编辑、删除、撤销、嫁接、直接写库）之后：索引表和穗 / 新枝一一对应，不多不少
  await pg.waitForFunction(() => window.__gleanSearch?.ready, null, { timeout: 8000 }).catch(() => {});
  await pg.waitForTimeout(400);
  const keysNow = [...(await dbRaw(pg, 'items')).map((x) => `i:${x.id}`), ...(await dbRaw(pg, 'developments')).map((x) => `b:${x.id}`)].sort();
  const ftNow = (await dbRaw(pg, 'ftidx')).map((r) => r.key).sort();
  if (JSON.stringify(keysNow) !== JSON.stringify(ftNow)) errs.push(`[${name}] ftidx out of sync: ${ftNow.length} rows vs ${keysNow.length} docs`);
  await pg.click('.search-toggle');
  await sqType(pg, '渐变测试');
  if ((await sqHeads(pg)).items !== 1) errs.push(`[${name}] item written straight to the db not searchable`);
  await ctx.close();
}

// v0.16 引导（只在第一次打开出现）+ 全局速记小窗
async function onboarding() {
  for (const [tag, viewport] of [['onboard-mobile', { width: 390, height: 844 }], ['onboard-desktop', { width: 1440, height: 900 }]]) {
    const ctx = await b.newContext({ viewport, onboard: true });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text()) && errs.push(`[${tag}] console ${m.text()}`));
    await pg.goto(base);
    await pg.waitForSelector('.onboard', { timeout: 5000 }).catch(() => errs.push(`[${tag}] onboarding not shown on first open`));
    if (!(await pg.locator('.onboard').count())) { await ctx.close(); continue; }
    await studio(pg, tag);
    await pg.screenshot({ path: `${out}/${tag}-1.png` });
    if (tag === 'onboard-desktop') {
      await pg.click('.onboard-skip');
      await pg.waitForSelector('text=穗仓还是空的');
    } else {
      await pg.click('.onboard-next');
      await pg.waitForSelector('.onboard:has-text("AI 只用你的素材")');
      if ((await pg.locator('.promise-list li').count()) !== 4) errs.push(`[${tag}] expected 4 promises`);
      await pg.click('.onboard-next');
      // v0.24 多了「本地模型（LM Studio / Ollama）」
      if ((await pg.locator('.radio-list .radio').count()) !== 5) errs.push(`[${tag}] expected 5 AI services`);
      await pg.click('.radio-list .radio:has-text("智谱")');
      await pg.fill('.radio-item input', 'e2e-onboard-key');
      await pg.screenshot({ path: `${out}/${tag}-3.png` });
      await pg.click('.onboard-done');
      await pg.waitForSelector('text=穗仓还是空的');
      const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('lingan.settings.v1') || '{}'));
      // v0.20：key 不再放进设置，进钥匙串（浏览器里降级为单独的 glean.vault.v1）
      const vault = await pg.evaluate(() => JSON.parse(localStorage.getItem('glean.vault.v1') || '{}'));
      if (st.preset !== 'zhipu' || vault['chat.apiKey'] !== 'e2e-onboard-key') errs.push(`[${tag}] onboarding AI choice not saved ${st.preset}`);
      if (st.chat?.apiKey) errs.push(`[${tag}] api key must not be stored in settings`);
    }
    await pg.reload();
    await pg.waitForSelector('text=穗仓还是空的');
    if (await pg.locator('.onboard').count()) errs.push(`[${tag}] onboarding shown twice`);
    // 全局速记小窗：托盘 / Ctrl+Shift+L 唤出（浏览器里用 glean:quick 事件模拟）
    await pg.evaluate(() => window.dispatchEvent(new Event('glean:quick')));
    await pg.waitForSelector('.quick-window input');
    const focused = await pg.evaluate(() => document.activeElement?.closest('.quick-window') != null);
    if (!focused) errs.push(`[${tag}] quick window input not focused`);
    await pg.fill('.quick-window input', '小窗里拾的一句 #小窗');
    if (!(await pg.locator('.qw-types .chip.on').count())) errs.push(`[${tag}] quick window type not recognised`);
    await pg.screenshot({ path: `${out}/${tag}-quickwin.png` });
    await pg.press('.quick-window input', 'Enter');
    await pg.waitForSelector('.card:has-text("小窗里拾的一句")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] quick window did not save`));
    if (await pg.locator('.quick-window').count()) errs.push(`[${tag}] quick window should close after saving`);
    await pg.evaluate(() => window.dispatchEvent(new Event('glean:quick')));
    await pg.waitForSelector('.quick-window');
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(200);
    if (await pg.locator('.quick-window').count()) errs.push(`[${tag}] Esc should close quick window`);
    await ctx.close();
  }
}

// v0.13 虚拟瀑布：同一列里卡片不能叠在一起（量高度出错时会叠）
async function noOverlap(pg, tag) {
  await pg.waitForTimeout(500);
  const bad = await pg.evaluate(() => {
    const cells = [...document.querySelectorAll('.masonry .masonry-cell')].map((c) => { const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: r.top, b: r.bottom, txt: c.textContent.slice(0, 12) }; });
    const out = [];
    for (const a of cells) for (const c of cells) if (a !== c && a.l === c.l && a.t < c.t && a.b > c.t + 1) out.push(`${a.txt}↔${c.txt} ${Math.round(a.b - c.t)}px`);
    return out;
  });
  if (bad.length) errs.push(`[${tag}] masonry cards overlap: ${bad.slice(0, 3).join('; ')}`);
}
// 发版截图：手机 390×844 @2x，白天配色（穗仓首页 / 图片显影中 / 嫁接结果 / 口味）
async function shots() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[shots] pageerror ${e.message}`));
  await pg.addInitScript((v) => { if (!localStorage.getItem('lingan.settings.v1')) localStorage.setItem('lingan.settings.v1', v); }, MOCK_SETTINGS(new URL(base).origin, { phase: 'day' }));
  await pg.goto(base);
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  // v0.14 截图：穗仓顶部的「今日一穗」
  await pg.waitForSelector('.daily-ear', { timeout: 4000 }).catch(() => errs.push('[shots] daily card missing'));
  await pg.evaluate(() => { const el = document.querySelector('.daily-ear'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${out}/shot-daily.png` });
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 320;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 320);
    sky.addColorStop(0, '#9cc3d9'); sky.addColorStop(0.55, '#f3e2b8'); sky.addColorStop(0.56, '#d9b25a'); sky.addColorStop(1, '#8a6a22');
    g.fillStyle = sky; g.fillRect(0, 0, 480, 320);
    g.fillStyle = '#fff4d6'; g.beginPath(); g.arc(360, 120, 34, 0, 7); g.fill();
    g.fillStyle = '#3b4a24'; g.beginPath(); g.ellipse(110, 160, 46, 30, 0, 0, 7); g.fill(); g.fillRect(104, 160, 10, 26);
    for (let x = 0; x < 480; x += 6) { g.strokeStyle = x % 12 ? '#b68a2e' : '#e7c46a'; g.beginPath(); g.moveTo(x, 320); g.lineTo(x + 6, 230 + (x % 30)); g.stroke(); }
    const url = c.toDataURL('image/jpeg', 0.85);
    await new Promise((res, rej) => {
      const r = indexedDB.open('lingan');
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction('items', 'readwrite');
        const now = Date.now();
        tx.objectStore('items').add({ type: 'image', title: '傍晚的麦田', creator: '随手拍', image: url, why: '风一吹，整片金色往一个方向倒', tags: ['麦田', '黄昏', '风'], createdAt: now, updatedAt: now });
        tx.oncomplete = () => res(null);
        tx.onerror = () => rej(tx.error);
      };
    });
  });
  await pg.reload();
  await pg.waitForSelector('.card:has-text("傍晚的麦田") img.card-img.loaded', { timeout: 6000 }).catch(() => errs.push('[shots] photo never loaded'));
  await pg.mouse.move(40, 760);
  await pg.mouse.move(360, 770, { steps: 10 });
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: `${out}/shot-library.png` });
  await noOverlap(pg, 'shots');
  // v0.17 截图：秒搜（m18）
  await pg.click('.search-toggle');
  await sqType(pg, '麦田');
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${out}/shot-search.png` });
  await pg.click('.sq-cancel');
  await pg.click('.nav-btn:has-text("嫁接")');
  await mockAI(pg, { delay: 2600 });
  await pg.click('text=嫁接今日三穗');
  await pg.waitForSelector('.growing');
  await pg.waitForTimeout(2000);
  await pg.evaluate(() => { const el = document.querySelector('.growing'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 220); });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${out}/shot-growing.png` });
  await pg.waitForSelector('.three .idea', { timeout: 15000 });
  await pg.waitForFunction(() => !document.querySelector('.idea .tw-rest'), null, { timeout: 12000 }).catch(() => {});
  await pg.waitForTimeout(400);
  await pg.evaluate(() => { const el = document.querySelector('.three-head'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 10); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${out}/shot-graft.png` });
  // v0.12 截图：第一根新枝的「因为这几穗」，正文里点一下提到的穗让它亮起来
  await pg.evaluate(() => { const el = document.querySelector('.three .idea .idea-body'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90); });
  await pg.locator('.three .idea').first().locator('.mention').first().click().catch(() => {});
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: `${out}/shot-provenance.png` });
  await pg.click('.nav-btn:has-text("口味")');
  await pg.waitForSelector('.heat-grid');
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: `${out}/shot-taste.png` });
  await ctx.close();
}

// v0.14 每日一穗：断网 + 没 key；同一天反复打开一致、第二天变化、回到今天还是原样；一键带进嫁接且 4 穗已选好；
// 「收起」只管当天；清掉示例只留自己的；换一批示例
async function daily() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[daily] pageerror ${e.message}`));
  pg.on('console', (m) => m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|net::ERR_FAILED/.test(m.text()) && errs.push(`[daily] console ${m.text()}`));
  pg.on('dialog', (d) => d.accept());
  const origin = new URL(base).origin;
  let outside = 0;
  // 断网：除了 App 自己，任何外部请求都掐掉（也没有 API key）
  await ctx.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : (outside++, r.abort())));
  const T0 = new Date();
  T0.setHours(10, 0, 0, 0);
  const DAYMS = 86400000;
  await pg.clock.setFixedTime(T0);
  await pg.goto(base);
  await pg.waitForSelector('text=穗仓还是空的');
  if (await pg.locator('.daily-ear').count()) errs.push('[daily] card shown on empty library');
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  // 自己再拾 5 穗：自己的够 4 穗时每日一穗只用自己的（第二天起生效）
  for (const t of ['地铁口卖烤红薯的炉子', '旧收音机调频时的沙沙声', '雨后操场的塑胶味', '把日历撕下来折纸飞机', '楼道感应灯一层层亮起来']) {
    await pg.fill('.quick-input', t);
    await pg.press('.quick-input', 'Enter');
    await pg.waitForSelector(`.card:has-text("${t}")`);
  }
  await pg.waitForSelector('.daily-ear');
  const d1 = await dailyState(pg);
  if (!d1 || d1.old.length !== 3 || d1.combo.length !== 4) errs.push(`[daily] expected 3 old + 4 combo ${JSON.stringify(d1)}`);
  if (d1 && d1.day !== localKey(T0)) errs.push(`[daily] day ${d1.day} != ${localKey(T0)}`);
  if (d1 && !d1.untouched.every((t) => /天没碰|今天碰过/.test(t))) errs.push(`[daily] untouched label missing ${d1.untouched}`);
  if (d1 && new Set([...d1.old, ...d1.combo]).size < 4) errs.push('[daily] combo ids not distinct');
  await pg.screenshot({ path: `${out}/daily-1.png`, fullPage: true });
  // 打开一件旧穗（会记「碰过」），再刷新：内容不变
  await pg.click(`.daily-old button[data-item-id="${d1.old[0]}"]`);
  await pg.waitForSelector('.detail');
  await pg.click('.sheet .icon-btn[aria-label="关闭"]');
  for (let i = 0; i < 2; i++) {
    await pg.reload();
    await pg.waitForSelector('.daily-ear');
    const again = await dailyState(pg);
    if (JSON.stringify(again.old) !== JSON.stringify(d1.old) || JSON.stringify(again.combo) !== JSON.stringify(d1.combo)) errs.push(`[daily] same day changed ${JSON.stringify(d1)} -> ${JSON.stringify(again)}`);
  }
  // 收起：当天刷新仍收着
  await pg.click('.daily-fold');
  await pg.reload();
  await pg.waitForSelector('.daily-ear');
  if (!(await dailyState(pg)).folded) errs.push('[daily] fold not kept for the day');
  // 第二天：内容变化、重新展开、昨天那三件旧穗不再出现、只用自己的穗
  await pg.clock.setFixedTime(new Date(T0.getTime() + DAYMS));
  await pg.reload();
  await pg.waitForSelector('.daily-ear');
  const d2 = await dailyState(pg);
  if (d2.folded) errs.push('[daily] fold leaked into next day');
  if (d2.day !== localKey(T0.getTime() + DAYMS)) errs.push(`[daily] next day key ${d2.day}`);
  if (JSON.stringify(d2.old) === JSON.stringify(d1.old) && JSON.stringify(d2.combo) === JSON.stringify(d1.combo)) errs.push('[daily] next day did not change');
  const items = await dbItems(pg);
  const own = new Set(items.filter((x) => !x.sample).map((x) => x.id));
  if (![...d2.old, ...d2.combo].every((id) => own.has(id))) errs.push(`[daily] next day should use own ears only ${JSON.stringify(d2)}`);
  await pg.screenshot({ path: `${out}/daily-2-nextday.png`, fullPage: true });
  // 回到今天：还是今天存下的那份
  await pg.clock.setFixedTime(T0);
  await pg.reload();
  await pg.waitForSelector('.daily-ear');
  let back = await dailyState(pg);
  if (!back.folded) errs.push('[daily] back to today: should still be folded');
  await pg.click('.daily-unfold');
  back = await dailyState(pg);
  if (JSON.stringify(back.old) !== JSON.stringify(d1.old) || JSON.stringify(back.combo) !== JSON.stringify(d1.combo)) errs.push('[daily] today record not stable');
  // 彻底断网（浏览器离线）后在 App 里来回切，卡片照样在；一键去嫁接 → 4 穗已选好，离线长出三根
  await ctx.setOffline(true);
  await pg.waitForSelector('.offline-bar:has-text("离线")', { timeout: 3000 }).catch(() => errs.push('[daily] offline bar missing'));
  await pg.click('.nav-btn:has-text("设置")');
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.waitForSelector('.daily-ear');
  const comboText = (await dailyState(pg)).comboText;
  await pg.click('.daily-go');
  await pg.waitForSelector('.graft .pair-item');
  const picked = await pg.locator('.graft .pair-item').count();
  if (picked !== 4) errs.push(`[daily] graft should have 4 picked got ${picked}`);
  const seg = await pg.locator('.controls .ctrl:has-text("几穗") .seg button.on').innerText().catch(() => '');
  if (seg.trim() !== '4') errs.push(`[daily] count segment should be 4 got ${seg}`);
  const pickedText = await pg.locator('.graft .pair-item').allInnerTexts();
  for (const t of comboText) {
    const core = t.replace(/[…「」]/g, '').slice(0, 6);
    if (!pickedText.some((p) => p.replace(/[「」]/g, '').includes(core))) errs.push(`[daily] combo item ${t} not in graft picks`);
  }
  await pg.screenshot({ path: `${out}/daily-3-graft.png`, fullPage: true });
  await pg.click('.graft-btn');
  await pg.waitForSelector('.three .idea', { timeout: 10000 }).catch(() => errs.push('[daily] offline graft from daily failed'));
  if ((await pg.locator('.three .idea').count()) !== 3) errs.push('[daily] expected 3 offline branches');
  await ctx.setOffline(false);
  // 换一批示例：仍是 10 条示例，自己的 5 穗不动
  await pg.click('.nav-btn:has-text("穗仓")');
  const before = (await dbItems(pg)).filter((x) => x.sample).map((x) => x.title + x.content).sort().join('|');
  await pg.click('.samples-again');
  await pg.waitForSelector('.toast:has-text("换了一批示例")');
  const afterList = await dbItems(pg);
  const after = afterList.filter((x) => x.sample).map((x) => x.title + x.content).sort().join('|');
  if (afterList.filter((x) => x.sample).length !== 10) errs.push('[daily] reshuffle should keep 10 samples');
  if (after === before) errs.push('[daily] reshuffle gave identical samples');
  if (afterList.filter((x) => !x.sample).length !== 5) errs.push('[daily] reshuffle touched own ears');
  // 清掉示例：只留自己的
  await pg.click('.samples-clear');
  await pg.waitForSelector('.toast:has-text("清掉了 10 穗示例")');
  await pg.waitForTimeout(300);
  if (await pg.locator('.card[data-sample="1"]').count()) errs.push('[daily] sample cards still shown');
  if (await pg.locator('.samples-bar').count()) errs.push('[daily] samples bar should hide');
  const left = await dbItems(pg);
  if (left.length !== 5 || left.some((x) => x.sample)) errs.push(`[daily] after clear expected own 5 got ${left.length}`);
  await pg.waitForSelector('.daily-ear', { timeout: 3000 }).catch(() => errs.push('[daily] card gone after clearing samples (5 own ears left)'));
  const d3 = await dailyState(pg);
  if (d3 && ![...d3.old, ...d3.combo].every((id) => left.some((x) => x.id === id))) errs.push('[daily] card still points at cleared samples');
  if (outside) console.log(`daily: blocked ${outside} outside requests`);
  await ctx.close();
}

// v0.15 搬去 Obsidian：设置里导出 ZIP → 解析包核对仓库结构、YAML 头、图片、双链；示例默认不导、勾选后导；安卓桥（模拟）走分块 + 分享
function readZipBuf(buf) {
  const u = new Uint8Array(buf);
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let e = -1;
  for (let i = u.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip: no EOCD');
  const n = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central dir');
    const flags = v.getUint16(p + 8, true);
    const size = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nl));
    if (!(flags & 0x800)) throw new Error('zip: name not flagged UTF-8 ' + name);
    const st = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    out.set(name, u.slice(st, st + size));
    p += 46 + nl + xl + cl;
  }
  return out;
}
function vaultCheck(tag, files, { ownIds, sampleIds, imageId, includeSamples, devTitle }) {
  const dec = new TextDecoder();
  const text = (p) => dec.decode(files.get(p));
  const paths = [...files.keys()];
  if (!files.has('拾穗索引.md')) errs.push(`[${tag}] index note missing`);
  if (!files.has('.obsidian/app.json')) errs.push(`[${tag}] .obsidian/app.json missing`);
  const notes = paths.filter((p) => p.endsWith('.md'));
  const ids = new Map();
  for (const p of notes) {
    const md = text(p);
    if (!md.startsWith('---\n')) { errs.push(`[${tag}] ${p} has no front matter`); continue; }
    const fm = md.slice(4, md.indexOf('\n---\n', 4));
    // v0.21 glean_id 改写全局 uid（ULID），本机编号在 glean_n
    const gid = fm.match(/^glean_n: (\d+)$/m);
    if (gid && !/^glean_id: "[0-9A-Z]{26}"$/m.test(fm)) errs.push(`[${tag}] ${p} glean_id should be a ULID`);
    const type = fm.match(/^类型: "(.+)"$/m)?.[1];
    if (!type) errs.push(`[${tag}] ${p} no 类型`);
    if (gid && type !== '新枝' && type !== '索引') {
      ids.set(Number(gid[1]), p);
      for (const k of ['类型', '作者', '年份', '标签', '来源', '记录时间']) if (!new RegExp(`^${k}:`, 'm').test(fm)) errs.push(`[${tag}] ${p} missing ${k}`);
      if (!p.startsWith(type + '/')) errs.push(`[${tag}] ${p} not in its type folder ${type}`);
      if (!/^记录时间: "\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d"$/m.test(fm)) errs.push(`[${tag}] ${p} bad 记录时间`);
    }
    // 每条双链 / 嵌入都落在真实文件上
    for (const m of md.matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) if (!files.has(m[1]) && !files.has(m[1] + '.md')) errs.push(`[${tag}] ${p} dangling [[${m[1]}]]`);
  }
  const want = includeSamples ? [...ownIds, ...sampleIds] : ownIds;
  const got = [...ids.keys()].sort((a, b) => a - b);
  if (JSON.stringify(got) !== JSON.stringify([...want].sort((a, b) => a - b))) errs.push(`[${tag}] exported ears ${got} != ${[...want].sort((a, b) => a - b)}`);
  const att = paths.find((p) => p.startsWith(`attachments/glean-${imageId}.`));
  if (!att) errs.push(`[${tag}] image attachment missing`);
  else {
    const bytes = files.get(att);
    const isImg = (bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x89 && bytes[1] === 0x50);
    if (!isImg || bytes.length < 200) errs.push(`[${tag}] attachment is not an image (${bytes.length} bytes)`);
    const imgNote = ids.get(imageId);
    if (imgNote && !text(imgNote).includes(`![[${att}]]`)) errs.push(`[${tag}] image note does not embed ${att}`);
  }
  const branch = notes.find((p) => p.startsWith('新枝/') && text(p).includes(`标题: ${JSON.stringify(devTitle)}`));
  if (!branch) errs.push(`[${tag}] branch note ${devTitle} missing`);
  else {
    const md = text(branch);
    const src = [...md.slice(0, md.indexOf('\n---\n', 4)).matchAll(/^ {2}- "\[\[([^\]|]+)\|/gm)].map((m) => m[1]);
    const ownNotes = ownIds.map((id) => ids.get(id)?.replace(/\.md$/, ''));
    if (src.filter((x) => ownNotes.includes(x)).length < 2) errs.push(`[${tag}] branch 来源穗 should link 2 own ears: ${src}`);
    if (!includeSamples && !md.includes('示例穗，未导出')) errs.push(`[${tag}] branch should name the unexported sample as text`);
    if (!md.includes('## 因为这几穗')) errs.push(`[${tag}] branch has no source section`);
  }
  return { notes: notes.length, ears: ids.size };
}
async function obsidian() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[obsidian] pageerror ${e.message}`));
  pg.on('dialog', (d) => d.accept());
  await pg.goto(base);
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  for (const t of ['外婆家的缝纫机声 #声音', '车窗上的雾气画', '凌晨四点的早餐铺 #城市']) {
    await pg.fill('.quick-input', t);
    await pg.press('.quick-input', 'Enter');
    await pg.waitForSelector(`.card:has-text("${t.replace(/ #.*/, '')}")`);
  }
  // 一张真图：走拾穗表单的选图
  const png = await pg.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#c9a227'; g.fillRect(0, 0, 240, 160);
    g.fillStyle = '#5b3a1e'; g.fillRect(30, 40, 180, 80);
    return c.toDataURL('image/png').split(',')[1];
  });
  await pg.click('.quick-more');
  await pg.setInputFiles('.capture input[type=file]', { name: 'field.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await pg.waitForTimeout(400);
  await pg.fill('.capture .field.big input', '麦田/傍晚: 一角');
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.card:has-text("麦田")');
  const items = await dbItems(pg);
  const own = items.filter((x) => !x.sample);
  const samples = items.filter((x) => x.sample);
  const imageItem = own.find((x) => x.type === 'image');
  if (own.length !== 4 || !imageItem) errs.push(`[obsidian] setup expected 4 own incl. image, got ${JSON.stringify(own)}`);
  // 一根混合来源的新枝（2 件自己的 + 1 件示例）直接写库
  const DEV = '缝纫机与雾气';
  await pg.evaluate(({ ids, title }) => new Promise((res, rej) => {
    const r = indexedDB.open('lingan');
    r.onsuccess = () => {
      const tx = r.result.transaction('developments', 'readwrite');
      tx.objectStore('developments').add({ itemIds: ids, jump: 0.6, source: 'offline', evidence: 'ok', createdAt: Date.now(), idea: { title, bridge: '同一种细小的重复', idea: '把缝纫机的节奏画在车窗雾气上', cliches: [], refs: [1, 2, 3], evidence: 'ok' } });
      tx.oncomplete = () => { r.result.close(); res(null); };
      tx.onerror = () => rej(tx.error);
    };
    r.onerror = () => rej(r.error);
  }), { ids: [own[0].id, own[1].id, samples[0].id], title: DEV });
  await pg.click('.nav-btn:has-text("设置")');
  await pg.waitForSelector('.obsidian-panel');
  await brand(pg, 'obsidian');
  if (await pg.locator('.obsidian-share').count()) errs.push('[obsidian] android buttons shown on web');
  if (await pg.locator('.obsidian-samples').isChecked()) errs.push('[obsidian] samples should be unchecked by default');
  await pg.locator('.obsidian-panel').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: `${out}/obsidian-settings.png` });
  const t0 = Date.now();
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('.obsidian-export')]);
  const ms = Date.now() - t0;
  if (!/^glean-obsidian-\d{4}-\d\d-\d\d\.zip$/.test(dl.suggestedFilename())) errs.push(`[obsidian] zip name ${dl.suggestedFilename()}`);
  await pg.waitForSelector('.toast:has-text("已导出 4 穗")', { timeout: 4000 }).catch(() => errs.push('[obsidian] toast missing'));
  const z1 = readZipBuf(fs.readFileSync(await dl.path()));
  const ctxIds = { ownIds: own.map((x) => x.id), sampleIds: samples.map((x) => x.id), imageId: imageItem?.id, devTitle: DEV };
  const r1 = vaultCheck('obsidian', z1, { ...ctxIds, includeSamples: false });
  fs.writeFileSync(`${out}/obsidian-vault.zip`, fs.readFileSync(await dl.path()));
  // 勾上「包含示例穗」：示例也在，且标着 示例: true
  await pg.check('.obsidian-samples');
  const [dl2] = await Promise.all([pg.waitForEvent('download'), pg.click('.obsidian-export')]);
  const z2 = readZipBuf(fs.readFileSync(await dl2.path()));
  const r2 = vaultCheck('obsidian+samples', z2, { ...ctxIds, includeSamples: true });
  const sampleNote = [...z2.keys()].find((p) => p.endsWith('.md') && new TextDecoder().decode(z2.get(p)).includes('示例: true'));
  if (!sampleNote) errs.push('[obsidian] sample notes not marked 示例: true');
  console.log(`obsidian: ${r1.ears} ears / ${r1.notes} notes (samples on: ${r2.ears} / ${r2.notes}), ${z1.size} files, export ${ms}ms`);
  await ctx.close();

  // 安卓：注入模拟的 LinganFiles 原生桥，界面换成「分享 / 存到下载」，ZIP 分块交给原生层
  const actx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await actx.addInitScript(() => {
    const log = { begin: [], chunks: [], share: [], save: [] };
    window.__files = log;
    window.LinganFiles = {
      begin: (n) => (log.begin.push(n), log.chunks = [], true),
      append: (c) => (log.chunks.push(c), true),
      share: (mime, title) => (log.share.push([mime, title]), true),
      saveDownloads: (mime) => (log.save.push(mime), '下载/' + log.begin[log.begin.length - 1]),
    };
  });
  const ap = await actx.newPage();
  ap.on('pageerror', (e) => errs.push(`[obsidian-android] pageerror ${e.message}`));
  await ap.goto(base);
  await ap.click('text=先放点示例');
  await ap.waitForSelector('.card[data-sample="1"]');
  await ap.fill('.quick-input', '安卓上拾的一穗');
  await ap.press('.quick-input', 'Enter');
  await ap.waitForSelector('.card:has-text("安卓上拾的一穗")');
  await ap.click('.nav-btn:has-text("设置")');
  if (await ap.locator('.obsidian-export').count()) errs.push('[obsidian-android] desktop button shown on android');
  await ap.click('.obsidian-share');
  await ap.waitForSelector('.toast:has-text("已导出 1 穗")', { timeout: 4000 }).catch(() => errs.push('[obsidian-android] share toast missing'));
  const a1 = await ap.evaluate(() => window.__files);
  if (a1.share.length !== 1 || a1.share[0][0] !== 'application/zip') errs.push(`[obsidian-android] share not called ${JSON.stringify(a1.share)}`);
  const az = readZipBuf(Buffer.concat(a1.chunks.map((c) => Buffer.from(c, 'base64'))));
  if (![...az.keys()].some((p) => p.startsWith('想法/') || p.startsWith('文案/') || p.startsWith('链接/'))) errs.push(`[obsidian-android] shared zip lacks the ear: ${[...az.keys()]}`);
  await ap.click('.obsidian-downloads');
  await ap.waitForSelector('.toast:has-text("下载/glean-obsidian-")', { timeout: 4000 }).catch(() => errs.push('[obsidian-android] downloads toast missing'));
  if ((await ap.evaluate(() => window.__files.save.length)) !== 1) errs.push('[obsidian-android] saveDownloads not called');
  await ap.screenshot({ path: `${out}/obsidian-android.png` });
  await actx.close();
}

// v0.21 数据地基：每行 uid（ULID）+ deviceId；删除进回收站（恢复 / 彻底删）；.glean 流式备份（manifest + data.jsonl + images/ 原图，
// 哈希核对）；导入按 uid 去重、先预览三种模式条数（合并 / 只补缺 / 替换）；新设备导入一样；旧 .json 备份照样导、再导不重复
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const sha256 = (u8) => crypto.createHash('sha256').update(u8).digest('hex');
async function importNote(pg, mode) {
  return pg.locator(`.import-note[data-mode="${mode}"]`).evaluate((e) => ({ add: +e.dataset.add, update: +e.dataset.update, skip: +e.dataset.skip, trash: +e.dataset.trash }));
}
async function openSettings(pg) {
  await pg.click('.nav-btn:has-text("设置")');
  await pg.waitForSelector('#set-data');
}
async function pickBackup(pg, file) {
  await pg.setInputFiles('.backup-file', file);
  await pg.waitForSelector('.import-preview', { timeout: 15000 });
}
async function datafound() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[datafound] pageerror ${e.message}`));
  await pg.goto(base);
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  for (const t of ['数据地基一穗 #地基', '数据地基二穗']) {
    await pg.fill('.quick-input', t);
    await pg.press('.quick-input', 'Enter');
    await pg.waitForSelector(`.card:has-text("${t.replace(/ #.*/, '')}")`);
  }
  const png = await pg.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, 200, 120);
    g.fillStyle = '#eee'; g.fillRect(20, 20, 160, 80);
    return c.toDataURL('image/png').split(',')[1];
  });
  await pg.click('.quick-more');
  await pg.setInputFiles('.capture input[type=file]', { name: 'base.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await pg.waitForTimeout(300);
  await pg.fill('.capture .field.big input', '地基里的图');
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.card:has-text("地基里的图")');
  // 每行都有 uid（ULID，唯一）和本机 deviceId
  const rows = await dbRaw(pg, 'items');
  const dev = await pg.evaluate(() => localStorage.getItem('glean.device.v1'));
  if (!ULID_RE.test(dev || '')) errs.push(`[datafound] device id ${dev}`);
  if (!rows.every((x) => ULID_RE.test(x.uid || '') && x.deviceId === dev)) errs.push(`[datafound] rows missing uid/deviceId ${JSON.stringify(rows.slice(0, 2))}`);
  if (new Set(rows.map((x) => x.uid)).size !== rows.length) errs.push('[datafound] uid not unique');
  const meta = await dbRaw(pg, 'meta');
  if (meta.find((m) => m.k === 'deviceId')?.v !== dev) errs.push(`[datafound] meta deviceId ${JSON.stringify(meta)}`);

  // 删除 → 回收站 → 恢复 → 再删 → 彻底删
  const two = rows.find((x) => x.title === '数据地基二穗');
  const del = async () => {
    await pg.click('.nav-btn:has-text("穗仓")');
    await pg.click(cardSel(two.id));
    await pg.click('.detail button:has-text("删除")');
    await pg.click('.confirm-ok');
    await pg.waitForSelector('.toast:has-text("在回收站")', { timeout: 3000 }).catch(() => errs.push('[datafound] delete toast should mention 回收站'));
    await pg.waitForTimeout(200);
    if (await pg.locator(cardSel(two.id)).count()) errs.push('[datafound] deleted card still in library');
  };
  await del();
  const tomb = (await dbRaw(pg, 'items', true)).find((x) => x.id === two.id);
  if (!tomb || !(tomb.deletedAt > 0) || tomb.uid !== two.uid) errs.push(`[datafound] tombstone missing ${JSON.stringify(tomb)}`);
  await openSettings(pg);
  await pg.locator('#set-trash').scrollIntoViewIfNeeded();
  if ((await pg.locator('.trash-row').count()) !== 1) errs.push(`[datafound] trash rows ${await pg.locator('.trash-row').count()}`);
  if (!(await pg.locator('.trash-row').first().innerText()).includes('数据地基二穗')) errs.push('[datafound] trash row title');
  if (!/30 天/.test(await pg.locator('.trash-row').first().innerText())) errs.push('[datafound] trash row should show 30 天 left');
  await pg.screenshot({ path: `${out}/datafound-trash.png` });
  await pg.click('.trash-restore');
  await pg.waitForSelector('.toast:has-text("已恢复")');
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.waitForSelector(cardSel(two.id), { timeout: 3000 }).catch(() => errs.push('[datafound] restore did not bring the card back'));
  await del();
  await openSettings(pg);
  await pg.click('.trash-purge');
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("已彻底删掉")');
  if ((await dbRaw(pg, 'items', true)).some((x) => x.id === two.id)) errs.push('[datafound] purge left the row');
  if (!(await pg.locator('.trash-none').count())) errs.push('[datafound] trash should be empty');

  // 导出 .glean：结构、哈希、条数
  const live = await dbRaw(pg, 'items');
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('.backup-export')]);
  const gname = dl.suggestedFilename();
  if (!/^glean-backup-\d{4}-\d\d-\d\d-\d{4}\.glean$/.test(gname)) errs.push(`[datafound] backup name ${gname}`);
  await pg.waitForSelector(`.toast:has-text("已导出 ${live.length} 穗")`, { timeout: 5000 }).catch(() => errs.push('[datafound] export toast'));
  const gbuf = fs.readFileSync(await dl.path());
  fs.writeFileSync(`${out}/datafound.glean`, gbuf);
  const z = readZipBuf(gbuf);
  const man = JSON.parse(new TextDecoder().decode(z.get('manifest.json')));
  const imgs = [...z.keys()].filter((k) => k.startsWith('images/'));
  if (man.format !== 'glean' || man.schema !== 10 || man.counts.items !== live.length || man.counts.images !== 1 || imgs.length !== 1) errs.push(`[datafound] manifest ${JSON.stringify(man.counts)} files ${[...z.keys()]}`);
  for (const [k, v] of z) if (k !== 'manifest.json' && man.files[k]?.sha256 !== sha256(v)) errs.push(`[datafound] sha256 mismatch ${k}`);
  if (imgs[0] && imgs[0] !== `images/${sha256(z.get(imgs[0]))}.png`) errs.push(`[datafound] image not named by content hash ${imgs[0]}`);
  const lines = new TextDecoder().decode(z.get('data.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
  const lu = lines.filter((l) => l.t === 'item').map((l) => l.uid).sort();
  if (JSON.stringify(lu) !== JSON.stringify(live.map((x) => x.uid).sort())) errs.push('[datafound] data.jsonl uids != db');
  // 导回同一台：合并预览「新增 0」
  await pickBackup(pg, { name: gname, mimeType: 'application/octet-stream', buffer: gbuf });
  const same = await importNote(pg, 'merge');
  if (same.add !== 0 || same.skip !== live.length) errs.push(`[datafound] reimport same device should add 0: ${JSON.stringify(same)}`);
  await pg.screenshot({ path: `${out}/datafound-preview.png` });
  await pg.click('.import-go');
  await pg.waitForSelector('.toast:has-text("已合并")');
  if ((await dbRaw(pg, 'items')).length !== live.length) errs.push('[datafound] reimport duplicated items');
  await ctx.close();

  // 新设备：空库导入 .glean → 条数、uid、原图都在
  const ctx2 = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errs.push(`[datafound-2] pageerror ${e.message}`));
  await p2.goto(base);
  await p2.waitForSelector('text=穗仓还是空的');
  await openSettings(p2);
  await pickBackup(p2, { name: gname, mimeType: 'application/octet-stream', buffer: gbuf });
  const fresh = await importNote(p2, 'merge');
  if (fresh.add !== live.length) errs.push(`[datafound] fresh device preview ${JSON.stringify(fresh)}`);
  await p2.screenshot({ path: `${out}/datafound-preview-desktop.png` });
  await p2.click('.import-go');
  await p2.waitForSelector('.toast:has-text("已合并")');
  const got = await dbRaw(p2, 'items');
  if (JSON.stringify(got.map((x) => x.uid).sort()) !== JSON.stringify(live.map((x) => x.uid).sort())) errs.push('[datafound] new device uids differ');
  const imgRow = got.find((x) => x.title === '地基里的图');
  if (!imgRow?.hasImage || (await dbRaw(p2, 'images')).length !== 1) errs.push('[datafound] image not restored on new device');
  // 旧版 .json（v0.20 及以前：原图是 data URL、没有 uid）：照样导，再导一次不重复
  const legacyJson = JSON.stringify({ app: 'lingan', version: 1, exportedAt: Date.now() - 86400000, items: [
    { id: 1, type: 'film', title: '旧备份里的片子', tags: ['旧'], createdAt: 1700000000000, updatedAt: 1700000000000 },
    { id: 2, type: 'image', title: '旧备份里的图', image: 'data:image/png;base64,' + png, tags: [], createdAt: 1700000100000, updatedAt: 1700000100000 },
  ], developments: [{ itemIds: [1, 2], jump: 0.5, idea: { title: '旧备份的新枝', bridge: '', idea: '旧片子接旧图', cliches: ['旧备份套路'] }, source: 'offline', createdAt: 1700000200000 }] });
  await pickBackup(p2, { name: 'glean-backup-old.json', mimeType: 'application/json', buffer: Buffer.from(legacyJson) });
  const lj = await importNote(p2, 'merge');
  if (lj.add !== 2 || (await p2.locator('.import-preview').getAttribute('data-format')) !== 'json') errs.push(`[datafound] legacy json preview ${JSON.stringify(lj)}`);
  await p2.click('.import-go');
  // v0.26 导入前先拍快照，导入稍慢：等这次导入自己的提示（上一次的「已合并」可能还在屏幕上）
  await p2.waitForSelector('.toast:has-text("已合并：新增 2 穗")');
  const afterOld = await dbRaw(p2, 'items');
  const oldImg = afterOld.find((x) => x.title === '旧备份里的图');
  if (afterOld.length !== live.length + 2 || !oldImg?.hasImage || !ULID_RE.test(oldImg.uid || '')) errs.push(`[datafound] legacy import ${afterOld.length}`);
  const odev = (await dbRaw(p2, 'developments')).find((d) => d.idea?.title === '旧备份的新枝');
  const oldFilm = afterOld.find((x) => x.title === '旧备份里的片子');
  if (!odev || JSON.stringify(odev.itemIds) !== JSON.stringify([oldFilm?.id, oldImg?.id])) errs.push(`[datafound] legacy dev sources ${JSON.stringify(odev?.itemIds)}`);
  await pickBackup(p2, { name: 'glean-backup-old.json', mimeType: 'application/json', buffer: Buffer.from(legacyJson) });
  const lj2 = await importNote(p2, 'merge');
  if (lj2.add !== 0 || lj2.skip !== 2) errs.push(`[datafound] legacy reimport should add 0: ${JSON.stringify(lj2)}`);
  await p2.click('.import-cancel');
  // 只补缺 / 替换：本机多出来的（旧 json 那两穗）替换后进回收站，可恢复
  await pickBackup(p2, { name: gname, mimeType: 'application/octet-stream', buffer: gbuf });
  const rp = await importNote(p2, 'replace');
  const ms = await importNote(p2, 'missing');
  if (rp.trash !== 2 || rp.add !== 0 || ms.add !== 0) errs.push(`[datafound] replace/missing preview ${JSON.stringify({ rp, ms })}`);
  await p2.click('.import-mode[data-mode="replace"]');
  await p2.click('.import-go');
  await p2.waitForSelector('.confirm:has-text("替换")');
  await p2.click('.confirm-ok');
  await p2.waitForSelector('.toast:has-text("已替换")');
  const trashed = (await dbRaw(p2, 'items', true)).filter((x) => x.deletedAt).map((x) => x.title).sort();
  if (JSON.stringify(trashed) !== JSON.stringify(['旧备份里的图', '旧备份里的片子'].sort())) errs.push(`[datafound] replace should trash the 2 local-only ${JSON.stringify(trashed)}`);
  await p2.locator('#set-trash').scrollIntoViewIfNeeded();
  if ((await p2.locator('.trash-row').count()) !== 3) errs.push(`[datafound] trash rows after replace ${await p2.locator('.trash-row').count()}`); // 2 穗 + 只由它们长出的那根新枝
  await p2.screenshot({ path: `${out}/datafound-trash-desktop.png` });
  await p2.click('.trash-restore-all');
  await p2.waitForSelector('.toast:has-text("已恢复")');
  if ((await dbRaw(p2, 'items')).length !== live.length + 2) errs.push('[datafound] restore all failed');
  // 搜索里看不到回收站里的
  await ctx2.close();
  console.log(`datafound: ${live.length} items, glean ${gbuf.length}B (${z.size} files), legacy json ok`);
}

// v0.21 大库备份：1000 穗（300 张各不相同的原图）流式导出 .glean，量 JS 堆峰值；再在新设备导入，量峰值和条数
// v0.22 极速采集：安卓原生收件箱（半屏面板 / 选字菜单 / 磁贴 / 通知写进来的穗）、正在播放、常驻通知权限、快捷方式跳页、草稿永不丢
function e2eUlid(t) {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let x = t, time = '';
  for (let i = 0; i < 10; i++) { time = A[x % 32] + time; x = Math.floor(x / 32); }
  let r = '';
  for (let i = 0; i < 16; i++) r += A[crypto.randomInt(32)];
  return time + r;
}
async function capture() {
  const tag = 'capture';
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const T = Date.now() - 3600_000;
  const quote = { v: 1, uid: e2eUlid(T), createdAt: T, kind: 'quote', text: '人是为了活着本身而活着的，而不是为了活着之外的任何事物。', tags: ['夜读'], source: '微信读书', sourcePkg: 'com.tencent.weread' };
  const song = { v: 1, uid: e2eUlid(T + 60_000), createdAt: T + 60_000, kind: 'music', title: '后来', artist: '刘若英', album: '我等你', source: '网易云音乐', why: '副歌那一下', image: true, mime: 'image/png' };
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await ctx.addInitScript(({ quote, song, png }) => {
    const w = window;
    w.__inbox = [quote, song];
    w.__imgs = { [song.uid]: png };
    w.__acks = [];
    w.__hints = '';
    w.LinganInbox = {
      list: () => JSON.stringify(w.__inbox),
      image: (u) => w.__imgs[u] || '',
      ack: (u) => { w.__acks.push(u); w.__inbox = w.__inbox.filter((e) => e.uid !== u); return true; },
      setHints: (j) => { w.__hints = j; },
    };
    w.__np = { status: 'no-access', opened: 0, song: { title: '晴天', artist: '周杰伦', album: '叶惠美', pkg: 'com.tencent.qqmusic', app: '', image: png } };
    w.LinganNowPlaying = {
      status: () => w.__np.status,
      read: () => (w.__np.status === 'ok' ? JSON.stringify(w.__np.song) : '{"error":"no-access"}'),
      openAccess: () => { w.__np.opened++; return true; },
    };
    w.__nt = { perm: 'ask', on: false, last: '', req: 0, settings: 0 };
    w.LinganNotify = {
      status: () => JSON.stringify({ perm: w.__nt.perm, on: w.__nt.on, last: w.__nt.last }),
      request: () => { w.__nt.req++; w.__nt.last = ''; setTimeout(() => { w.__nt.perm = 'granted'; w.__nt.last = 'granted'; }, 300); return true; },
      setOn: (v) => { w.__nt.on = v; return true; },
      openSettings: () => { w.__nt.settings++; return true; },
    };
    w.__go = '';
    w.LinganShare = { take: () => '', go: () => { const g = w.__go; w.__go = ''; return g; } };
  }, { quote, song, png });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  await pg.goto(base);
  await pg.waitForSelector('.view');
  // 1) 打开即收：两条都进库，保留原生 uid 与按「存」的时间，来源 / 为什么 / 面板标签都在，收完 ack
  await pg.waitForSelector('.toast:has-text("极速拾")', { timeout: 6000 }).catch(() => errs.push(`[${tag}] no intake toast`));
  await pg.waitForTimeout(400);
  let rows = await dbRaw(pg, 'items');
  const rq = rows.find((x) => x.uid === quote.uid), rs = rows.find((x) => x.uid === song.uid);
  if (!rq || !rs) errs.push(`[${tag}] inbox rows missing ${JSON.stringify(rows.map((x) => x.uid))}`);
  else {
    if (rq.createdAt !== quote.createdAt || rs.createdAt !== song.createdAt) errs.push(`[${tag}] createdAt not kept ${rq.createdAt} ${rs.createdAt}`);
    if (rq.type !== 'text' || !rq.tags.includes('摘抄') || !rq.tags.includes('夜读') || rq.source !== '微信读书' || rq.creator) errs.push(`[${tag}] quote row wrong ${JSON.stringify({ t: rq.type, tags: rq.tags, s: rq.source, c: rq.creator })}`);
    if (rs.type !== 'music' || rs.creator !== '刘若英' || rs.why !== '副歌那一下' || rs.source !== '网易云音乐' || rs.hasImage !== 1) errs.push(`[${tag}] song row wrong ${JSON.stringify({ t: rs.type, c: rs.creator, w: rs.why, s: rs.source, img: rs.hasImage })}`);
    if (!ULID_RE.test(rq.uid) || !rq.deviceId || !(rq.updatedAt >= rq.createdAt)) errs.push(`[${tag}] v0.21 stamps missing`);
  }
  const st = await pg.evaluate(() => ({ inbox: window.__inbox.length, acks: window.__acks.length, hints: window.__hints }));
  if (st.inbox !== 0 || st.acks !== 2) errs.push(`[${tag}] inbox not acked ${JSON.stringify(st)}`);
  if (!/夜读/.test(st.hints)) errs.push(`[${tag}] hints not pushed ${st.hints}`);
  // 2) 回到前台再收：重复 uid 不重复入库，新的一条进来
  const note = { v: 1, uid: e2eUlid(Date.now() - 1000), createdAt: Date.now() - 1000, kind: 'note', text: '通知栏里打的一句 #通知' };
  await pg.evaluate(({ quote, note }) => { window.__inbox.push(quote, note); window.dispatchEvent(new Event('focus')); }, { quote, note });
  await pg.waitForSelector('.card:has-text("通知栏里打的一句")', { timeout: 6000 }).catch(() => errs.push(`[${tag}] second intake failed`));
  rows = await dbRaw(pg, 'items');
  if (rows.filter((x) => x.uid === quote.uid).length !== 1) errs.push(`[${tag}] duplicate uid ingested twice`);
  if (await pg.evaluate(() => window.__inbox.length)) errs.push(`[${tag}] dup not acked`);
  // 3) 详情：来自 微信读书、作者待补
  await pg.click(cardSel(rq.id));
  await pg.waitForSelector('.detail');
  const det = await pg.evaluate(() => ({ src: document.querySelector('.kv-source dd')?.textContent, todo: !!document.querySelector('.kv-todo .todo'), line: document.querySelector('.detail-src')?.textContent }));
  if (det.src !== '微信读书' || !det.todo || !/微信读书/.test(det.line || '')) errs.push(`[${tag}] detail source ${JSON.stringify(det)}`);
  await pg.screenshot({ path: `${out}/${tag}-1-detail.png` });
  await pg.click('.kv-todo .todo');
  await pg.waitForSelector('.capture.editing');
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(400);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(500);
  // 4) 正在播放：没给通知使用权 → 先说明（不直接跳设置），点「去打开」才跳；给了以后一键填进表单
  await pg.click('.quick-more');
  await pg.waitForSelector('.capture .np-btn');
  await pg.click('.capture .np-btn');
  await pg.waitForSelector('.confirm:has-text("通知使用权")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] np: no explanation before asking`));
  if ((await pg.evaluate(() => window.__np.opened)) !== 0) errs.push(`[${tag}] np: opened settings before explaining`);
  await pg.click('.confirm-ok');
  await pg.waitForTimeout(200);
  if ((await pg.evaluate(() => window.__np.opened)) !== 1) errs.push(`[${tag}] np: 去打开 did not open access settings`);
  await pg.evaluate(() => { window.__np.status = 'ok'; });
  await pg.click('.capture .np-btn');
  await pg.waitForFunction(() => document.querySelector('.capture .field.big input')?.value === '晴天', null, { timeout: 4000 }).catch(() => errs.push(`[${tag}] np: form not filled`));
  await pg.screenshot({ path: `${out}/${tag}-2-np.png` });
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.card:has-text("晴天")', { timeout: 5000 }).catch(() => errs.push(`[${tag}] np: song not saved`));
  rows = await dbRaw(pg, 'items');
  const np = rows.find((x) => x.title === '晴天');
  if (!np || np.type !== 'music' || np.creator !== '周杰伦' || np.source !== 'QQ 音乐' || !np.tags.includes('正在听') || np.hasImage !== 1) errs.push(`[${tag}] np row ${JSON.stringify(np && { t: np.type, c: np.creator, s: np.source, tags: np.tags, img: np.hasImage })}`);
  // 5) 设置 → 极速采集：常驻通知开关先说明再请求权限（0556），授权后打开；再点关掉
  await openSettings(pg);
  await pg.waitForSelector('#set-capture .cap-notify');
  await studio(pg, tag + '-settings');
  if (!(await pg.textContent('#set-capture .cap-notify .tc-date')).includes('关')) errs.push(`[${tag}] notify should start off`);
  await pg.click('#set-capture .cap-notify');
  await pg.waitForSelector('.confirm:has-text("常驻通知")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] notify: no explanation`));
  if ((await pg.evaluate(() => window.__nt.req)) !== 0) errs.push(`[${tag}] notify: permission requested before explaining`);
  await pg.click('.confirm-ok');
  await pg.waitForFunction(() => window.__nt.on === true, null, { timeout: 6000 }).catch(() => errs.push(`[${tag}] notify: not turned on`));
  await pg.waitForTimeout(200);
  const nt = await pg.evaluate(() => ({ ...window.__nt, label: document.querySelector('#set-capture .cap-notify .tc-date')?.textContent }));
  if (nt.req !== 1 || nt.label !== '开') errs.push(`[${tag}] notify state ${JSON.stringify(nt)}`);
  await pg.locator('#set-capture').screenshot({ path: `${out}/${tag}-3-settings.png` });
  await pg.click('#set-capture .cap-notify');
  await pg.waitForFunction(() => window.__nt.on === false, null, { timeout: 3000 }).catch(() => errs.push(`[${tag}] notify: not turned off`));
  // 已授权后再开：不再弹说明
  await pg.click('#set-capture .cap-notify');
  await pg.waitForFunction(() => window.__nt.on === true, null, { timeout: 3000 }).catch(() => errs.push(`[${tag}] notify: re-enable failed`));
  if (await pg.locator('.confirm').count()) errs.push(`[${tag}] notify: explained again after granted`);
  // 通知使用权状态跟着系统变
  if ((await pg.textContent('#set-capture .cap-access .tc-date')) !== '已允许') errs.push(`[${tag}] access label should be 已允许`);
  await pg.evaluate(() => { window.__np.status = 'no-access'; window.dispatchEvent(new Event('focus')); });
  await pg.waitForFunction(() => document.querySelector('#set-capture .cap-access .tc-date')?.textContent === '未允许', null, { timeout: 3000 }).catch(() => errs.push(`[${tag}] access label not refreshed`));
  // 6) 长按图标快捷方式：带 glean_go 回来 → 跳到对应页
  await pg.evaluate(() => { window.__go = 'library'; window.dispatchEvent(new Event('focus')); });
  await pg.waitForFunction(() => !document.querySelector('.view.settings'), null, { timeout: 4000 }).catch(() => errs.push(`[${tag}] shortcut go=library ignored`));
  // 7) 草稿永不丢：速记打一半刷新（模拟 App 被杀）→ 接着写；清掉后不再出现
  await pg.fill('.quick-input', '写到一半的草稿 #未存');
  await pg.waitForTimeout(800);
  await pg.reload();
  await pg.waitForSelector('.view');
  const qv = await pg.inputValue('.quick-input');
  if (qv !== '写到一半的草稿 #未存') errs.push(`[${tag}] quick draft not restored: ${qv}`);
  if (!(await pg.locator('.quick-draft').count())) errs.push(`[${tag}] draft banner missing`);
  await pg.screenshot({ path: `${out}/${tag}-4-draft.png` });
  await pg.click('.quick-draft-clear');
  await pg.waitForTimeout(700);
  await pg.reload();
  await pg.waitForSelector('.view');
  if (await pg.inputValue('.quick-input')) errs.push(`[${tag}] cleared draft came back`);
  // 速记表单也一样；存了以后不再恢复
  await pg.click('.quick-more');
  await pg.fill('.capture .field.big input', '表单草稿一穗');
  await pg.waitForTimeout(800);
  await pg.reload();
  await pg.waitForSelector('.view');
  await pg.click('.quick-more');
  await pg.waitForSelector('.capture');
  const fv = await pg.inputValue('.capture .field.big input');
  if (fv !== '表单草稿一穗' || !(await pg.locator('.capture-restored').count())) errs.push(`[${tag}] form draft not restored: ${fv}`);
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.card:has-text("表单草稿一穗")');
  await pg.click('.quick-more');
  await pg.waitForSelector('.capture');
  if (await pg.inputValue('.capture .field.big input')) errs.push(`[${tag}] form draft survived save`);
  // 速记栏存了也清草稿
  await pg.keyboard.press('Escape');
  await pg.reload();
  await pg.waitForSelector('.view');
  await pg.fill('.quick-input', '存了就不留草稿');
  await pg.press('.quick-input', 'Enter');
  await pg.waitForSelector('.card:has-text("存了就不留草稿")');
  await pg.waitForTimeout(700);
  await pg.reload();
  await pg.waitForSelector('.view');
  if (await pg.inputValue('.quick-input')) errs.push(`[${tag}] saved quick text restored as draft`);
  const n = (await dbRaw(pg, 'items')).length;
  console.log(`capture: ${n} items, inbox+np+notify+shortcut+drafts checked`);
  await ctx.close();
}

// v0.23 待理与补为什么：待理收件箱（0101）+ 三秒整理（0115）、缺为什么（0102/0146）、这穗收过了（ROADMAP v0.31）、
// 一次整理一把（ROADMAP v0.40/0159）、标签合并（0103/0147）、搜索语法（0111）、详情上一穗/下一穗（0113）、整理度（0160）
async function inboxCount(pg) {
  return (await dbRaw(pg, 'items')).filter((x) => x.inbox === 1).length;
}
async function quickSave(pg, text) {
  await pg.fill('.quick-input', text);
  await pg.press('.quick-input', 'Enter');
  await pg.waitForFunction(() => !document.querySelector('.quick-input')?.value, null, { timeout: 3000 });
  await pg.waitForTimeout(250);
}
async function inbox() {
  const tag = 'inbox';
  const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, inbox: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  // 链接补标题会去抓 example.com（离线 / 跨域时失败是预期的，穗照样存）
  pg.on('console', (m) => m.type() === 'error' && !/CORS policy|Failed to load resource|ERR_/.test(m.text()) && errs.push(`[${tag}] console ${m.text()}`));
  await pg.goto(base);
  await pg.waitForSelector('text=穗仓还是空的');
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  // 1) 速记收进来的先进待理：穗仓网格里没有，顶上「待理 (3)」
  await quickSave(pg, '待理一号 #雨');
  await quickSave(pg, '待理二号的一句话');
  await quickSave(pg, 'https://example.com/post/9?utm_source=wechat 一篇文章');
  await pg.waitForSelector('.inbox-bar:has-text("待理 (3)")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] inbox bar (3) missing`));
  if (await pg.locator('.masonry .card:has-text("待理一号")').count()) errs.push(`[${tag}] inbox item should not be on the shelf`);
  if ((await inboxCount(pg)) !== 3) errs.push(`[${tag}] expected 3 inbox rows got ${await inboxCount(pg)}`);
  const title = await pg.locator('.page-title').innerText();
  if (title.replace(/\s+/g, '') !== '穗仓(0)') errs.push(`[${tag}] shelf count should not include inbox (示例不计数): ${title}`);
  // 分享桥进来的也进待理
  await pg.evaluate(() => { let n = 1; window.LinganShare = { take: () => (n-- > 0 ? JSON.stringify({ text: 'https://example.com/shared-inbox', subject: '分享进待理' }) : '') }; window.dispatchEvent(new Event('focus')); });
  await pg.waitForSelector('.inbox-bar:has-text("待理 (4)")', { timeout: 5000 }).catch(() => errs.push(`[${tag}] share should go to inbox`));
  // 2) 这穗收过了：同一个链接带不同追踪参数 → 提示 → 合并（撤销可回）
  await quickSave(pg, 'https://example.com/post/9/?spm_id_from=333&from=timeline 又看到这篇');
  await pg.waitForSelector('.toast:has-text("收过了（同一个链接）")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] dup toast (same link) missing`));
  await pg.click('.toast:has-text("收过了") .toast-act:has-text("合并")').catch(() => errs.push(`[${tag}] merge action missing`));
  await pg.waitForSelector('.toast:has-text("已合并进")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] merged toast missing`));
  let rows = await dbRaw(pg, 'items');
  if (rows.filter((x) => /example\.com\/post\/9/.test(x.url || '')).length !== 1) errs.push(`[${tag}] merge should leave one post/9 row: ${rows.filter((x) => /post\/9/.test(x.url || '')).length}`);
  // 3) 待理页：列表 → 三秒整理（键盘 1 留下 / 3 丢掉 / 2 补一句）
  await pg.click('.inbox-open');
  await pg.waitForSelector('.inbox-view .sort-card');
  await studio(pg, tag + '-list');
  await pg.screenshot({ path: `${out}/inbox-1-list.png` });
  const nList = await pg.locator('.inbox-view .sort-card').count();
  if (nList !== 4) errs.push(`[${tag}] inbox list should have 4 cards, got ${nList}`);
  await pg.click('.inbox-focus');
  await pg.waitForSelector('.sort-focus .sort-card.big');
  await pg.screenshot({ path: `${out}/inbox-2-focus.png` });
  const firstId = Number(await pg.locator('.sort-focus .sort-card').getAttribute('data-item-id'));
  await pg.keyboard.press('1');
  await pg.waitForSelector('.toast:has-text("进了穗仓")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] key 1 keep failed`));
  rows = await dbRaw(pg, 'items');
  if (rows.find((x) => x.id === firstId)?.inbox) errs.push(`[${tag}] kept item still in inbox`);
  const secondId = Number(await pg.locator('.sort-focus .sort-card').getAttribute('data-item-id'));
  if (secondId === firstId) errs.push(`[${tag}] focus did not advance`);
  await pg.keyboard.press('3');
  await pg.waitForSelector('.toast:has-text("丢掉了 1 穗")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] key 3 drop failed`));
  if (!(await dbRaw(pg, 'items', true)).find((x) => x.id === secondId)?.deletedAt) errs.push(`[${tag}] dropped item not in trash`);
  await pg.click('.toast:has-text("丢掉了") .toast-act:has-text("撤销")');
  await pg.waitForTimeout(300);
  if ((await dbRaw(pg, 'items', true)).find((x) => x.id === secondId)?.deletedAt) errs.push(`[${tag}] undo drop failed`);
  // 2 = 补一句：焦点进输入框，回车存，出待理
  await pg.waitForSelector('.sort-focus .sort-card');
  const thirdId = Number(await pg.locator('.sort-focus .sort-card').getAttribute('data-item-id'));
  await pg.keyboard.press('2');
  if (!(await pg.evaluate(() => document.activeElement?.classList.contains('sort-why-input')))) errs.push(`[${tag}] key 2 should focus why input`);
  await pg.keyboard.type('因为那天下雨');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(400);
  const r3 = (await dbRaw(pg, 'items')).find((x) => x.id === thirdId);
  if (r3?.why !== '因为那天下雨' || r3?.inbox) errs.push(`[${tag}] why via key 2 not saved / still in inbox ${JSON.stringify({ why: r3?.why, inbox: r3?.inbox })}`);
  if (!/今天理了 [23] 穗/.test(await pg.locator('.inbox-view .page-sub').innerText())) errs.push(`[${tag}] 今天理了 n 穗 missing`);
  // 一键全部入仓（可撤销）
  await pg.click('.inbox-keepall');
  await pg.waitForSelector('.toast:has-text("全部进了穗仓")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] keep all toast missing`));
  if ((await inboxCount(pg)) !== 0) errs.push(`[${tag}] keep all left ${await inboxCount(pg)}`);
  await pg.waitForSelector('.inbox-empty', { timeout: 3000 }).catch(() => errs.push(`[${tag}] empty inbox state missing`));
  await pg.click('.inbox-back');
  await pg.waitForSelector('.masonry .card:has-text("待理一号")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] kept item not on shelf`));
  if (await pg.locator('.inbox-bar').count()) errs.push(`[${tag}] inbox bar should hide when empty`);
  // 超过 7 天的待理穗：穗仓里也看得到
  await pg.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingan'); r.onsuccess = () => { const tx = r.result.transaction('items', 'readwrite'); const st = tx.objectStore('items'); st.add({ type: 'idea', title: '八天前的待理', tags: [], inbox: 1, createdAt: Date.now() - 8 * 864e5, updatedAt: Date.now() - 8 * 864e5, graftCount: 0, dup: [] }); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
  await pg.reload();
  await pg.waitForSelector('.masonry .card:has-text("八天前的待理")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] >7d inbox item should show on shelf`));
  await pg.waitForSelector('.inbox-bar:has-text("待理 (1)")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] >7d inbox item should still count in 待理`));

  // 4) 缺为什么：一次 5 条，补一条、跳过一条
  const noWhy0 = (await dbRaw(pg, 'items')).filter((x) => !x.sample && !(x.why || '').trim()).length;
  await pg.waitForSelector('.why-bar', { timeout: 3000 }).catch(() => errs.push(`[${tag}] why bar missing`));
  const whyBar = await pg.locator('.why-bar .label').innerText().catch(() => '');
  if (!whyBar.includes(`(${noWhy0})`)) errs.push(`[${tag}] why bar count ${whyBar} expected ${noWhy0}`);
  await pg.click('.why-open');
  await pg.waitForSelector('.why-view .why-row');
  const nRows = await pg.locator('.why-row').count();
  if (nRows !== Math.min(5, noWhy0)) errs.push(`[${tag}] why batch should be ${Math.min(5, noWhy0)} got ${nRows}`);
  if (!(await pg.locator('.why-row .why-prompt').count())) errs.push(`[${tag}] why prompts missing`);
  await pg.screenshot({ path: `${out}/inbox-3-why.png` });
  const w1 = Number(await pg.locator('.why-row').first().getAttribute('data-item-id'));
  await pg.locator('.why-row').first().locator('.why-prompt').first().click();
  const pre = await pg.locator('.why-row').first().locator('.why-input').inputValue();
  await pg.locator('.why-row').first().locator('.why-input').fill(pre + '记得那个下雨的镜头');
  await pg.locator('.why-row').first().locator('.why-input').press('Enter');
  await pg.waitForSelector('.toast:has-text("补上了")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] why save toast missing`));
  if (!((await dbRaw(pg, 'items')).find((x) => x.id === w1)?.why || '').endsWith('记得那个下雨的镜头')) errs.push(`[${tag}] why not saved for #${w1}`);
  const w2 = Number(await pg.locator('.why-row').first().getAttribute('data-item-id'));
  await pg.locator('.why-row').first().locator('.why-skip').click();
  await pg.waitForTimeout(200);
  if (Number(await pg.locator('.why-row').first().getAttribute('data-item-id')) === w2 && noWhy0 > 2) errs.push(`[${tag}] skip did not move on`);
  const t2 = await pg.locator('.why-view .page-title').innerText();
  if (!t2.includes(`(${noWhy0 - 1})`)) errs.push(`[${tag}] why title count ${t2} expected ${noWhy0 - 1}`);
  await pg.click('.why-back');

  // 5) 一次整理一把：选 → Shift 连选 → 加标签 → 改类型撤销 → 删除撤销
  await pg.waitForSelector('.masonry .card');
  await pg.click('.select-toggle');
  const cards = pg.locator('.masonry .card');
  const nCards = await cards.count();
  await cards.nth(0).click();
  await pg.keyboard.down('Shift');
  await cards.nth(Math.min(4, nCards - 1)).click();
  await pg.keyboard.up('Shift');
  const nSel = await pg.locator('.masonry .card.selected').count();
  if (nSel !== Math.min(5, nCards)) errs.push(`[${tag}] shift range select expected ${Math.min(5, nCards)} got ${nSel}`);
  if (!(await pg.locator(`.select-bar .sb-n:has-text("${nSel}")`).count())) errs.push(`[${tag}] select bar count wrong`);
  await pg.screenshot({ path: `${out}/inbox-4-select.png` });
  const selIds = await pg.$$eval('.masonry .card.selected', (els) => els.map((e) => Number(e.dataset.itemId)));
  await pg.click('.sb-tag');
  await pg.fill('.sb-tag-input', '毕设参考');
  await pg.press('.sb-tag-input', 'Enter');
  await pg.waitForSelector('.toast:has-text("加上了 #毕设参考")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] batch tag toast missing`));
  rows = await dbRaw(pg, 'items');
  if (!selIds.every((id) => rows.find((x) => x.id === id)?.tags.includes('毕设参考'))) errs.push(`[${tag}] batch tag not on all selected`);
  await pg.click('.sb-type');
  await pg.click('.sb-type-opt[data-type="film"]');
  await pg.waitForSelector('.toast:has-text("改成了电影")', { timeout: 3000 });
  await pg.click('.toast:has-text("改成了电影") .toast-act:has-text("撤销")');
  await pg.click('.sb-del');
  await pg.waitForSelector(`.toast:has-text("删掉了 ${nSel} 穗")`, { timeout: 3000 }).catch(() => errs.push(`[${tag}] batch delete toast missing`));
  if ((await dbRaw(pg, 'items')).some((x) => selIds.includes(x.id))) errs.push(`[${tag}] batch delete left rows`);
  await pg.click(`.toast:has-text("删掉了 ${nSel} 穗") .toast-act:has-text("撤销")`);
  await pg.waitForTimeout(400);
  if ((await dbRaw(pg, 'items')).filter((x) => selIds.includes(x.id)).length !== selIds.length) errs.push(`[${tag}] batch delete undo failed`);
  // Ctrl+A 全选当前筛选结果，Esc 退出
  await pg.keyboard.press('Control+a');
  await pg.waitForTimeout(150);
  const shelfN = Number((await pg.locator('.chips.scroll .chip').first().innerText()).match(/\((\d+)\)/)?.[1]);
  if (!(await pg.locator(`.select-bar .sb-n:has-text("${shelfN}")`).count())) errs.push(`[${tag}] Ctrl+A should select all ${shelfN}`);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  if (await pg.locator('.select-bar').count()) errs.push(`[${tag}] Esc should exit select`);

  // 6) 详情 上一穗 / 下一穗：→ 键与按钮
  await cards.nth(1).click();
  await pg.waitForSelector('.detail .detail-step');
  const pos0 = await pg.locator('.detail-step .meta-text').innerText();
  await pg.keyboard.press('ArrowRight');
  await pg.waitForTimeout(250);
  const pos1 = await pg.locator('.detail-step .meta-text').innerText();
  if (pos0.replace(/\s/g, '') !== `2/${shelfN}` || pos1.replace(/\s/g, '') !== `3/${shelfN}`) errs.push(`[${tag}] detail prev/next ${pos0} → ${pos1}`);
  await pg.click('.detail-prev');
  await pg.waitForTimeout(250);
  if ((await pg.locator('.detail-step .meta-text').innerText()).replace(/\s/g, '') !== `2/${shelfN}`) errs.push(`[${tag}] detail prev button failed`);
  await pg.click('.sheet .icon-btn[aria-label="关闭"]');

  // 7) 搜索语法：tag: + type: + why:，补全
  await pg.click('.search-toggle');
  await pg.waitForSelector('.sq-input');
  if (!(await pg.locator('.sq-syn').count())) errs.push(`[${tag}] syntax help chips missing`);
  await pg.fill('.sq-input', 'tag:毕设');
  await pg.waitForSelector('.sq-comp:has-text("tag:毕设参考")', { timeout: 2000 }).catch(() => errs.push(`[${tag}] syntax completion missing`));
  await pg.click('.sq-comp:has-text("tag:毕设参考")');
  await pg.waitForFunction(() => document.querySelector('.sq-count')?.dataset.q === 'tag:毕设参考 ', null, { timeout: 2000 }).catch(() => {});
  let h = await sqHeads(pg);
  if (h.items !== selIds.length) errs.push(`[${tag}] tag:毕设参考 expected ${selIds.length} got ${h.items}`);
  rows = await dbRaw(pg, 'items');
  const film = rows.filter((x) => x.type === 'film').length;
  await sqType(pg, 'type:电影');
  h = await sqHeads(pg);
  if (h.items !== film) errs.push(`[${tag}] type:电影 expected ${film} got ${h.items}`);
  const noWhy = rows.filter((x) => !(x.why || '').trim()).length;
  await sqType(pg, 'why:空');
  if ((await sqHeads(pg)).items !== noWhy) errs.push(`[${tag}] why:空 expected ${noWhy} got ${(await sqHeads(pg)).items}`);
  await sqType(pg, '-type:电影 why:空');
  const notFilmNoWhy = rows.filter((x) => x.type !== 'film' && !(x.why || '').trim()).length;
  if ((await sqHeads(pg)).items !== notFilmNoWhy) errs.push(`[${tag}] -type:电影 why:空 expected ${notFilmNoWhy}`);
  await pg.screenshot({ path: `${out}/inbox-5-syntax.png` });
  await pg.click('.sq-cancel');

  // 8) 设置 → 待理与标签：合并标签 + 以后自动用别名；关掉待理
  await pg.click('.nav-btn:has-text("设置")');
  await pg.waitForSelector('#set-tags .tp-tag');
  await pg.click('#set-tags .tp-tag[data-tag="毕设参考"]');
  await pg.fill('#set-tags .tp-target', '毕设');
  await pg.click('#set-tags .tp-merge-ok');
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("合并好了")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] tag merge toast missing`));
  rows = await dbRaw(pg, 'items');
  if (rows.some((x) => x.tags.includes('毕设参考')) || rows.filter((x) => x.tags.includes('毕设')).length !== selIds.length) errs.push(`[${tag}] tag merge rewrite failed`);
  if (!(await pg.locator('#set-tags .tp-al:has-text("毕设参考 → 毕设")').count())) errs.push(`[${tag}] alias not listed`);
  await pg.locator('#set-tags').screenshot({ path: `${out}/inbox-6-tags.png` });
  await pg.click('.nav-btn:has-text("穗仓")');
  await quickSave(pg, '别名测试 #毕设参考');
  rows = await dbRaw(pg, 'items');
  const al = rows.find((x) => x.title.startsWith('别名测试'));
  if (!al || !al.tags.includes('毕设') || al.tags.includes('毕设参考')) errs.push(`[${tag}] alias not applied on input ${JSON.stringify(al?.tags)}`);
  // 口味页：整理度（真实计数）
  await pg.click('.nav-btn:has-text("口味")');
  await pg.waitForSelector('.organize-sec', { timeout: 4000 }).catch(() => errs.push(`[${tag}] 整理度 missing on taste`));
  const own = rows.filter((x) => !x.sample);
  const want = `${own.filter((x) => (x.why || '').trim()).length}/${own.length}`;
  const got = (await pg.locator('.organize-sec .org-why .tc-date').innerText().catch(() => '')).replace(/\s/g, '');
  if (got !== want) errs.push(`[${tag}] 整理度 有为什么 ${got} expected ${want}`);
  await pg.click('.organize-sec .org-why');
  await pg.waitForSelector('.why-view', { timeout: 3000 }).catch(() => errs.push(`[${tag}] 整理度 → 缺为什么 jump failed`));
  // 关掉待理：新穗直接进穗仓
  await pg.click('.nav-btn:has-text("设置")');
  await pg.click('#set-tags .inbox-switch');
  await pg.click('.confirm-ok').catch(() => {});
  await pg.waitForSelector('.toast:has-text("待理已关")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] inbox off toast missing`));
  if ((await inboxCount(pg)) !== 0) errs.push(`[${tag}] turning off should move inbox to shelf`);
  await pg.click('.nav-btn:has-text("穗仓")');
  await quickSave(pg, '关掉待理以后的一穗');
  await pg.waitForSelector('.masonry .card:has-text("关掉待理以后的一穗")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] with inbox off quick item should be on shelf`));
  if ((await inboxCount(pg)) !== 0) errs.push(`[${tag}] inbox off but row flagged`);
  await noOverlap(pg, tag);
  await ctx.close();
}

// 手机：待理三秒整理右滑留下、左滑丢掉；同一张图收两次提示；详情左右滑翻穗
async function inboxMobile() {
  const tag = 'inbox-m';
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, inbox: true, hasTouch: true, isMobile: true });
  // 原生收件箱桥（空的）：后面模拟「App 在后台时半屏面板存了一穗」
  await ctx.addInitScript(() => {
    const w = window;
    w.__inbox = [];
    w.LinganInbox = { list: () => JSON.stringify(w.__inbox), image: () => '', ack: (u) => { w.__inbox = w.__inbox.filter((e) => e.uid !== u); return true; }, setHints: () => {} };
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  await pg.goto(base);
  await pg.waitForSelector('text=穗仓还是空的');
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  // v0.23 后台同步：原生写进收件箱后发 glean:inbox（不是回到前台的 focus / visibilitychange），JS 立刻收进来，进待理
  const bgUid = e2eUlid(Date.now() - 5000);
  await pg.evaluate((uid) => { window.__inbox.push({ v: 1, uid, createdAt: Date.now() - 5000, kind: 'note', text: '后台收进来的一穗' }); window.dispatchEvent(new Event('glean:inbox')); }, bgUid);
  await pg.waitForFunction(() => window.__inbox.length === 0, null, { timeout: 4000 }).catch(() => errs.push(`[${tag}] glean:inbox did not drain`));
  await pg.waitForTimeout(300);
  const bgRow = (await dbRaw(pg, 'items')).find((x) => x.uid === bgUid);
  if (!bgRow || bgRow.inbox !== 1) errs.push(`[${tag}] background-drained item should be in 待理 ${JSON.stringify(bgRow && { inbox: bgRow.inbox })}`);
  // 同一张图收两次（安卓分享桥带图），第二次出「收过了（同一张图）」
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  for (const subj of ['第一次的图', '第二次的同一张图']) {
    await pg.evaluate(({ png, subj }) => { let n = 1; window.LinganShare = { take: () => (n-- > 0 ? JSON.stringify({ image: png, subject: subj }) : '') }; window.dispatchEvent(new Event('focus')); }, { png, subj });
    await pg.waitForTimeout(900);
  }
  await pg.waitForSelector('.toast:has-text("收过了（同一张图）")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] same image dup toast missing`));
  await quickSave(pg, '手机待理一');
  await quickSave(pg, '手机待理二');
  const n0 = await inboxCount(pg);
  if (n0 < 3) errs.push(`[${tag}] expected ≥3 inbox rows got ${n0}`);
  await pg.click('.inbox-open');
  await pg.waitForSelector('.inbox-view .sort-card');
  await pg.screenshot({ path: `${out}/inbox-m-1-list.png`, fullPage: true });
  await pg.click('.inbox-focus');
  await pg.waitForSelector('.sort-stage .sort-card');
  const swipe = async (dx) => {
    const box = await pg.locator('.sort-stage').boundingBox();
    const y = box.y + 30;
    const x = box.x + box.width / 2;
    await pg.locator('.sort-stage').dispatchEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, pointerId: 1 });
    for (let k = 1; k <= 6; k++) await pg.locator('.sort-stage').dispatchEvent('pointermove', { clientX: x + (dx * k) / 6, clientY: y + 2, pointerType: 'touch', isPrimary: true, pointerId: 1 });
    await pg.locator('.sort-stage').dispatchEvent('pointerup', { clientX: x + dx, clientY: y + 2, pointerType: 'touch', isPrimary: true, pointerId: 1 });
    await pg.waitForTimeout(400);
  };
  const a = Number(await pg.locator('.sort-stage .sort-card').getAttribute('data-item-id'));
  await pg.screenshot({ path: `${out}/inbox-m-2-focus.png` });
  await swipe(160);
  let rows = await dbRaw(pg, 'items');
  if (rows.find((x) => x.id === a)?.inbox) errs.push(`[${tag}] swipe right should keep`);
  const c = Number(await pg.locator('.sort-stage .sort-card').getAttribute('data-item-id'));
  await swipe(-160);
  if (!(await dbRaw(pg, 'items', true)).find((x) => x.id === c)?.deletedAt) errs.push(`[${tag}] swipe left should drop`);
  await pg.click('.inbox-back');
  // 详情左滑 = 下一穗
  await pg.locator('.masonry .card').first().click();
  await pg.waitForSelector('.detail .detail-step');
  const p0 = await pg.locator('.detail-step .meta-text').innerText();
  const det = pg.locator('.detail');
  const bb = await det.boundingBox();
  await det.dispatchEvent('pointerdown', { clientX: bb.x + 300, clientY: bb.y + 200, pointerType: 'touch', pointerId: 2 });
  await det.dispatchEvent('pointerup', { clientX: bb.x + 100, clientY: bb.y + 205, pointerType: 'touch', pointerId: 2 });
  await pg.waitForTimeout(300);
  const p1 = await pg.locator('.detail-step .meta-text').innerText();
  if (p0.replace(/\s/g, '').split('/')[0] !== '1' || p1.replace(/\s/g, '').split('/')[0] !== '2') errs.push(`[${tag}] detail swipe ${p0} → ${p1}`);
  await pg.screenshot({ path: `${out}/inbox-m-3-detail.png` });
  await pg.click('.sheet .icon-btn[aria-label="关闭"]');
  await pg.click('.why-open');
  await pg.waitForSelector('.why-row');
  await pg.screenshot({ path: `${out}/inbox-m-4-why.png`, fullPage: true });
  await noOverlap(pg, tag);
  await ctx.close();
}
async function heapStart(pg) {
  return pg.evaluate(() => {
    if (window.gc) window.gc();
    const s = { base: performance.memory.usedJSHeapSize, peak: performance.memory.usedJSHeapSize };
    window.__heap = s;
    window.__heapT = setInterval(() => { const u = performance.memory.usedJSHeapSize; if (u > s.peak) s.peak = u; }, 15);
    return s.base;
  });
}
async function heapStop(pg) {
  return pg.evaluate(() => { clearInterval(window.__heapT); const s = window.__heap; const u = performance.memory.usedJSHeapSize; if (u > s.peak) s.peak = u; return { baseMB: +(s.base / 1048576).toFixed(1), peakMB: +(s.peak / 1048576).toFixed(1), deltaMB: +((s.peak - s.base) / 1048576).toFixed(1) }; });
}
async function perfBackup(ctx) {
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[perf-backup] pageerror ${e.message}`));
  await pg.goto(base);
  await pg.waitForFunction(() => window.__gleanReady && document.querySelectorAll('.masonry .card').length > 0, null, { timeout: 30000 });
  await openSettings(pg);
  await pg.waitForSelector('.backup-counts:has-text("1000 穗")');
  // v0.26：堆峰值取决于 GC 什么时候来（同一构建 34–64MB 都见过），单次判定会误报：
  // 同一页连续导出 3 次，每次前强制 GC 并等后台空闲，取中位数和阈值比（阈值不变），三次都记进 perf.json
  const runs = [];
  let dl = null;
  for (let i = 0; i < 3; i++) {
    await pg.waitForTimeout(400);
    await heapStart(pg);
    const t0 = Date.now();
    const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 150000 }), pg.click('.backup-export')]);
    await pg.waitForSelector('.toast:has-text("已导出 1000 穗")', { timeout: 150000 }).catch(() => errs.push('[perf-backup] export toast'));
    const h = await heapStop(pg);
    runs.push({ ms: Date.now() - t0, ...h });
    if (!dl) dl = d;
    await pg.locator('.toast').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
  }
  const mid = (k) => [...runs].sort((a, b) => a[k] - b[k])[1][k];
  const heap = { baseMB: mid('baseMB'), peakMB: mid('peakMB'), deltaMB: mid('deltaMB'), runs: runs.map((r) => r.deltaMB) };
  const ms = mid('ms');
  const file = await dl.path();
  const buf = fs.readFileSync(file);
  const z = readZipBuf(buf);
  const man = JSON.parse(new TextDecoder().decode(z.get('manifest.json')));
  const imgs = [...z.keys()].filter((k) => k.startsWith('images/'));
  const imageBytes = imgs.reduce((a, k) => a + z.get(k).length, 0);
  let bad = 0;
  for (const k of imgs) if (man.files[k].sha256 !== sha256(z.get(k))) bad++;
  PERF.backup = { ms, bytes: buf.length, items: man.counts.items, images: imgs.length, imageMB: +(imageBytes / 1048576).toFixed(1), heap, badHashes: bad };
  if (man.counts.items !== 1000 || imgs.length !== 300 || bad) errs.push(`[perf-backup] backup content ${JSON.stringify(PERF.backup)}`);
  // 旧做法（整库 JSON + base64）光字符串就要 ≥ 原图 × 1.33 × 2；流式导出堆峰值必须远小于原图总量
  if (heap.deltaMB > Math.max(48, imageBytes / 1048576 / 2)) errs.push(`[perf-backup] export heap grew ${heap.deltaMB}MB for ${PERF.backup.imageMB}MB of images`);
  await pg.close();
  // 新设备导入这份大备份
  const ictx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ictx.addInitScript(() => { if (!localStorage.getItem('lingan.settings.v1')) localStorage.setItem('lingan.settings.v1', JSON.stringify({ phase: 'day', autoCaption: false, autoEmbed: false })); });
  const ip = await ictx.newPage();
  ip.on('pageerror', (e) => errs.push(`[perf-import] pageerror ${e.message}`));
  await ip.goto(base);
  await ip.waitForSelector('.view');
  await openSettings(ip);
  await heapStart(ip);
  const t1 = Date.now();
  await pickBackup(ip, file);
  const pv = await importNote(ip, 'merge');
  if (pv.add !== 1000) errs.push(`[perf-import] preview ${JSON.stringify(pv)}`);
  await ip.click('.import-go');
  await ip.waitForSelector('.toast:has-text("已合并")', { timeout: 150000 }).catch(() => errs.push('[perf-import] import toast'));
  const iheap = await heapStop(ip);
  const ims = Date.now() - t1;
  const cnt = await ip.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingan'); r.onsuccess = () => { const tx = r.result.transaction(['items', 'images']); const o = {}; tx.objectStore('items').count().onsuccess = (e) => (o.items = e.target.result); tx.objectStore('images').count().onsuccess = (e) => (o.images = e.target.result); tx.oncomplete = () => { r.result.close(); res(o); }; }; }));
  PERF.restore = { ms: ims, heap: iheap, ...cnt };
  if (cnt.items !== 1000 || cnt.images !== 300) errs.push(`[perf-import] restored ${JSON.stringify(cnt)}`);
  if (iheap.deltaMB > Math.max(64, imageBytes / 1048576 / 2)) errs.push(`[perf-import] import heap grew ${iheap.deltaMB}MB`);
  await ictx.close();
}

// v0.12 兼容旧数据：先在同源页面用 v0.11 的库结构（Dexie version 1 = IndexedDB 10）写入旧新枝，再打开 App
// v0.18 五种嫁接：断网 + 没 key，五种接法各跑一次离线嫁接；核对每种抽样规则、接法写进新枝、嫁接次数 +1；
// 「被冷落」抽到的都是全库最低档；「跨媒介」每组至少 3 种类型（库里够时），不够时有提示
const MODE_NAMES = { near: '相近', far: '远距', neglected: '被冷落', cross: '跨媒介', anti: '反氛围' };
async function modes() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[modes] pageerror ${e.message}`));
  pg.on('console', (m) => m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|net::ERR_FAILED/.test(m.text()) && errs.push(`[modes] console ${m.text()}`));
  const origin = new URL(base).origin;
  await ctx.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
  await pg.goto(base);
  await pg.waitForSelector('text=穗仓还是空的');
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  for (const t of ['凌晨四点安静的雾', '夏天热闹的夜市人群', '外婆的旧收音机']) {
    await pg.fill('.quick-input', t);
    await pg.press('.quick-input', 'Enter');
    await pg.waitForSelector(`.card:has-text("${t}")`);
  }
  await ctx.setOffline(true);
  await pg.click('.nav-btn:has-text("嫁接")');
  await pg.waitForSelector('.modes .mode');
  const labels = await pg.locator('.modes .mode .mode-name').allInnerTexts();
  if (labels.join('/') !== '相近/远距/被冷落/跨媒介/反氛围') errs.push(`[modes] mode labels ${labels.join('/')}`);
  if (await pg.locator('.modes svg, .modes img').count()) errs.push('[modes] mode switch should be text only');
  await studio(pg, 'modes');
  for (const m of ['near', 'far', 'cross', 'anti', 'neglected', 'neglected']) {
    const before = await dbRaw(pg, 'items');
    await pg.click(`.modes .mode[data-mode="${m}"]`);
    await pg.waitForSelector('.graft .pair-item');
    const on = await pg.evaluate(() => [...document.querySelectorAll('.modes .mode.on')].map((e) => e.dataset.mode + ':' + e.getAttribute('aria-checked')));
    if (on.join() !== `${m}:true`) errs.push(`[modes] ${m} not selected ${on}`);
    const rule = await pg.locator('.modes .mode-rule').innerText();
    if (!rule.includes('怎么抽')) errs.push(`[modes] ${m} rule line missing`);
    const ids = await pg.evaluate(() => [...document.querySelectorAll('.graft .pair-item')].map((e) => Number(e.dataset.itemId)));
    const byId = new Map(before.map((x) => [x.id, x]));
    const picks = ids.map((id) => byId.get(id));
    const cnt = (x) => x.graftCount || 0;
    if (ids.length !== 3 || picks.some((x) => !x)) errs.push(`[modes] ${m} expected 3 picks got ${ids}`);
    if (m === 'neglected') {
      const sorted = before.map(cnt).sort((x, y) => x - y);
      const th = sorted[ids.length - 1];
      if (picks.some((x) => cnt(x) > th)) errs.push(`[modes] neglected picked above lowest tier ${picks.map(cnt)} th ${th}`);
      const below = before.filter((x) => cnt(x) < th).map((x) => x.id);
      if (below.some((id) => !ids.includes(id))) errs.push(`[modes] neglected skipped a lower-count item ${below} vs ${ids}`);
      if (!(await pg.locator('.graft .pick-count').count())) errs.push('[modes] neglected should show 接过 n 次');
    }
    if (m === 'cross') {
      const libTypes = new Set(before.map((x) => x.type)).size;
      const t = new Set(picks.map((x) => x.type)).size;
      if (libTypes >= 3 && t < 3) errs.push(`[modes] cross picked only ${t} types (lib ${libTypes})`);
      if (libTypes >= 3 && (await pg.locator('.modes .mode-warn').count())) errs.push('[modes] cross warned though library has enough types');
    }
    if ((await pg.locator('.graft-btn').innerText()).indexOf(MODE_NAMES[m]) < 0) errs.push(`[modes] graft button should name ${MODE_NAMES[m]}`);
    if (m === 'anti' || m === 'neglected') await pg.screenshot({ path: `${out}/modes-${m}-select.png`, fullPage: true });
    await pg.click('.graft-btn');
    await pg.waitForSelector('.three .idea', { timeout: 10000 }).catch(() => errs.push(`[modes] ${m} offline graft failed`));
    if ((await pg.locator('.three .idea').count()) !== 3) errs.push(`[modes] ${m} expected 3 branches`);
    const head = await pg.locator('.three-head .label').innerText();
    if (!head.includes(MODE_NAMES[m]) || !head.includes('离线嫁接')) errs.push(`[modes] ${m} result head ${head}`);
    const spr = await pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => ({ n: e.querySelectorAll('.sprig').length, ev: e.dataset.evidence })));
    if (spr.some((x) => x.n < 3 || x.ev !== 'ok')) errs.push(`[modes] ${m} provenance ${JSON.stringify(spr)}`);
    const devs = (await dbRaw(pg, 'developments')).sort((x, y) => y.createdAt - x.createdAt).slice(0, 3);
    if (devs.some((d) => d.mode !== m || JSON.stringify(d.itemIds) !== JSON.stringify(ids))) errs.push(`[modes] ${m} developments not tagged ${JSON.stringify(devs.map((d) => d.mode))}`);
    if (devs.some((d) => !d.idea.idea.includes(`接法「${MODE_NAMES[m]}」`))) errs.push(`[modes] ${m} offline branch text lacks 接法`);
    const after = new Map((await dbRaw(pg, 'items')).map((x) => [x.id, x]));
    for (const p of picks) {
      const a = after.get(p.id);
      if (!a || cnt(a) !== cnt(p) + 1 || !a.graftedAt) errs.push(`[modes] ${m} graftCount not bumped for ${p.id}: ${cnt(p)} -> ${a && cnt(a)}`);
    }
    const others = [...after.values()].filter((x) => !ids.includes(x.id) && cnt(x) !== cnt(byId.get(x.id) || {}));
    if (others.length) errs.push(`[modes] ${m} bumped items that were not grafted`);
    if (m === 'cross' || m === 'neglected') await pg.screenshot({ path: `${out}/modes-${m}-result.png`, fullPage: true });
  }
  // 详情能看到嫁接次数
  const top = (await dbRaw(pg, 'items')).sort((x, y) => (y.graftCount || 0) - (x.graftCount || 0))[0];
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.click(cardSel(top.id)).catch(() => {});
  const kv = await pg.locator('.kv-graft dd').innerText({ timeout: 3000 }).catch(() => '');
  if (!kv.includes(`${top.graftCount} 次`)) errs.push(`[modes] detail graft count ${kv} expected ${top.graftCount}`);
  await ctx.close();
  // 库里只有一种类型：选「跨媒介」给出提示
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errs.push(`[modes-cross] pageerror ${e.message}`));
  await p2.goto(base);
  await p2.waitForSelector('.quick-input');
  for (const t of ['第一个念头', '第二个念头', '第三个念头']) {
    await p2.fill('.quick-input', t);
    await p2.press('.quick-input', 'Enter');
    await p2.waitForSelector(`.card:has-text("${t}")`);
  }
  await p2.click('.nav-btn:has-text("嫁接")');
  await p2.click('.modes .mode[data-mode="cross"]');
  const warn = await p2.locator('.modes .mode-warn').innerText({ timeout: 3000 }).catch(() => '');
  if (!/只有 \d 种类型，跨媒介至少要 3 种/.test(warn)) errs.push(`[modes-cross] expected not-enough-types hint got "${warn}"`);
  await p2.screenshot({ path: `${out}/modes-cross-warn.png`, fullPage: true });
  await c2.close();
  // 桌面：接法横排
  const c3 = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const p3 = await c3.newPage();
  await p3.goto(base);
  await p3.click('text=先放点示例');
  await p3.waitForSelector('.card[data-sample="1"]');
  await p3.click('.nav-btn:has-text("嫁接")');
  await p3.click('.modes .mode[data-mode="cross"]');
  await p3.waitForSelector('.graft .pair-item');
  await p3.screenshot({ path: `${out}/modes-desktop-select.png` });
  await p3.click('.graft-btn');
  await p3.waitForSelector('.three .idea', { timeout: 10000 }).catch(() => errs.push('[modes-desktop] graft failed'));
  await p3.screenshot({ path: `${out}/modes-desktop-result.png` });
  await c3.close();
}

// v0.19 我的套路墙：口味页加词 → 嫁接（模拟模型故意写进墙上的词）→ 新枝里没有；模型列出的套路自动上墙；划掉 / 恢复；离线同样遵守
async function wallCount(pg) {
  const t = await pg.locator('.wall-title').innerText({ timeout: 4000 }).catch(() => '');
  const m = t.match(/\((\d+)\)/);
  return m ? Number(m[1]) : -1;
}
// 新枝本身的文字（不含「因为这几穗」里的穗名——穗名是用户自己的，不归新枝管）
const branchOwnText = (pg) => pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => [...e.querySelectorAll('.idea-title, .idea-body, .idea-form, .idea-bridge, .idea-unlike, .idea-exp, .idea-step, .idea-oblique')].map((x) => x.innerText).join('\n')).join('\n'));
async function wall() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[wall] pageerror ${e.message}`));
  const origin = new URL(base).origin;
  await pg.goto(base);
  await pg.evaluate((v) => localStorage.setItem('lingan.settings.v1', v), MOCK_SETTINGS(origin));
  const log = await mockAI(pg, { delay: 100 });
  // 记下每次第 2 步调用的 system prompt
  const sysC = [];
  pg.on('request', (r) => {
    if (!r.url().includes('/mock-ai/v1/chat/completions')) return;
    try { const sys = JSON.parse(r.postData() || '{}').messages?.[0]?.content || ''; if (sys.includes('PHASE C')) sysC.push(sys); } catch { /* */ }
  });
  await pg.reload();
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  await pg.click('.nav-btn:has-text("口味")');
  await pg.waitForSelector('.wall');
  if ((await wallCount(pg)) !== 0) errs.push(`[wall] fresh wall should be (0) got ${await wallCount(pg)}`);
  if (!(await pg.locator('.wall-empty').count())) errs.push('[wall] empty hint missing');
  await studio(pg, 'wall-taste');
  // 太短的拒绝
  await pg.fill('.wall-input', '雨');
  await pg.click('.wall-add-btn');
  await pg.waitForSelector('.toast:has-text("至少两个字")', { timeout: 3000 }).catch(() => errs.push('[wall] too-short word not refused'));
  // 加一个讨厌的词：模拟模型的第一根新枝标题 / 正文 / 小实验里都有「小票」
  await pg.fill('.wall-input', '小票');
  await pg.press('.wall-input', 'Enter');
  await pg.waitForSelector('.wall-row[data-key="小票"]', { timeout: 3000 }).catch(() => errs.push('[wall] added word not on wall'));
  if ((await wallCount(pg)) !== 1) errs.push(`[wall] wall count after add expected 1 got ${await wallCount(pg)}`);
  if (!(await pg.locator('.wall-row[data-key="小票"] .wall-src').innerText()).includes('我加的')) errs.push('[wall] user word should say 我加的');
  const rows0 = await dbRaw(pg, 'cliches');
  if (rows0.length !== 1 || rows0[0].source !== 'user') errs.push(`[wall] db cliches after add ${JSON.stringify(rows0)}`);
  // 嫁接（AI 模拟）
  await pg.click('.nav-btn:has-text("嫁接")');
  await pg.click('.controls button:has-text("抽几穗")');
  await pg.click('.graft-btn');
  await pg.waitForSelector('.three .idea', { timeout: 20000 }).catch(() => errs.push('[wall] graft did not finish'));
  const txt = await branchOwnText(pg).catch(() => '');
  if (txt.includes('小票')) errs.push('[wall] branch text still contains wall word 小票');
  if ((await pg.locator('.three .idea').count()) !== 3) errs.push('[wall] expected 3 branches');
  if (!sysC.length || !sysC.every((x) => x.includes('FORBIDDEN — 我的套路墙') && x.includes('「小票」'))) errs.push(`[wall] FORBIDDEN wall missing from prompt (${sysC.length} calls)`);
  if (log.phases.join('') !== 'ACC') errs.push(`[wall] expected one rewrite after hitting the wall, phases ${log.phases.join('')}`);
  const devs = (await dbRaw(pg, 'developments')).sort((x, y) => y.createdAt - x.createdAt).slice(0, 3);
  for (const d of devs) {
    const all = [d.idea.title, d.idea.idea, d.idea.bridge, d.idea.form, d.idea.unlike, d.idea.experiment, d.idea.firstStep].join('\n');
    if (all.includes('小票')) errs.push(`[wall] stored branch contains 小票: ${d.idea.title}`);
  }
  if (!devs.some((d) => d.idea.wall)) errs.push('[wall] no branch marked as replaced / scrubbed');
  if (!(await pg.locator('.three .wall-badge').count())) errs.push('[wall] replaced branch should carry a 撞墙 note');
  await pg.waitForSelector('.toast:has-text("撞了套路墙")', { timeout: 3000 }).catch(() => errs.push('[wall] wall toast missing'));
  const go = await pg.locator('.wall-go').innerText().catch(() => '');
  if (!go.includes('(4)')) errs.push(`[wall] result link should show 套路墙 (4) got "${go}"`);
  await pg.screenshot({ path: `${out}/wall-graft-result.png`, fullPage: true });
  // 模型列出的 3 个套路自动上墙
  await pg.click('.wall-go');
  await pg.waitForSelector('.wall');
  if ((await wallCount(pg)) !== 4) errs.push(`[wall] wall should be (4) after graft got ${await wallCount(pg)}`);
  const rows = await dbRaw(pg, 'cliches');
  for (const k of ['雨夜霓虹的孤独', '遗憾的错过', '城市里的陌生人']) if (!rows.some((r) => r.key === k && r.source === 'ai' && r.listed === 1)) errs.push(`[wall] model cliche ${k} not deposited`);
  const xp = rows.find((r) => r.key === '小票');
  if (!xp || !(xp.blocked >= 1)) errs.push(`[wall] 小票 should be counted as blocked ${JSON.stringify(xp)}`);
  if ((await pg.locator('.wall-table .wall-row').count()) !== 4) errs.push('[wall] wall table rows != 4');
  await pg.screenshot({ path: `${out}/wall-taste.png`, fullPage: true });
  // 划掉误伤的 → (3)，「划掉的 (1)」里能恢复
  await pg.click('.wall-row[data-key="遗憾的错过"] .wall-strike');
  await pg.waitForFunction(() => /\(3\)/.test(document.querySelector('.wall-title')?.textContent || ''), null, { timeout: 3000 }).catch(() => errs.push('[wall] strike did not drop count to 3'));
  await pg.click('.wall-struck-toggle');
  await pg.waitForSelector('.wall-row.struck[data-key="遗憾的错过"]', { timeout: 3000 }).catch(() => errs.push('[wall] struck row not listed'));
  await pg.screenshot({ path: `${out}/wall-struck.png`, fullPage: true });
  await pg.click('.wall-row.struck[data-key="遗憾的错过"] .wall-restore');
  await pg.waitForFunction(() => /\(4\)/.test(document.querySelector('.wall-title')?.textContent || ''), null, { timeout: 3000 }).catch(() => errs.push('[wall] restore did not bring count back to 4'));
  await pg.click('.wall-row[data-key="遗憾的错过"] .wall-strike');
  // 第二次嫁接：划掉的不进 FORBIDDEN，墙上的进
  sysC.length = 0;
  log.phases.length = 0;
  await pg.click('.nav-btn:has-text("嫁接")');
  await pg.click('.controls .shuffle');
  await pg.click('.graft-btn');
  await pg.waitForSelector('.three .idea', { timeout: 20000 });
  await pg.waitForTimeout(300);
  const last = sysC[sysC.length - 1] || '';
  if (!last.includes('「雨夜霓虹的孤独」') || last.includes('「遗憾的错过」')) errs.push('[wall] second graft FORBIDDEN should include wall and skip struck');
  if ((await branchOwnText(pg)).includes('小票')) errs.push('[wall] second graft contains 小票');
  await ctx.close();

  // 离线：加「做成」（离线句式每根都会写「做成…」），断网无 key 嫁接 → 三根都没有
  const c2 = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errs.push(`[wall-offline] pageerror ${e.message}`));
  await c2.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
  await p2.goto(base);
  await p2.click('text=先放点示例');
  await p2.waitForSelector('.card[data-sample="1"]');
  await c2.setOffline(true);
  await p2.click('.nav-btn:has-text("口味")');
  await p2.waitForSelector('.wall');
  await p2.fill('.wall-input', '做成');
  await p2.click('.wall-add-btn');
  await p2.waitForSelector('.wall-row[data-key="做成"]', { timeout: 3000 }).catch(() => errs.push('[wall-offline] word not added'));
  await p2.screenshot({ path: `${out}/wall-desktop-taste.png`, fullPage: true });
  for (let k = 0; k < 2; k++) {
    await p2.click('.nav-btn:has-text("嫁接")');
    await p2.click('.controls .shuffle');
    await p2.click('.graft-btn');
    await p2.waitForSelector('.three .idea', { timeout: 10000 }).catch(() => errs.push('[wall-offline] offline graft failed'));
    const t2 = await p2.locator('.three').innerText().catch(() => '');
    if ((await branchOwnText(p2)).includes('做成')) errs.push('[wall-offline] offline branch contains 做成');
    if (!t2.includes('离线嫁接')) errs.push('[wall-offline] expected offline graft');
    const spr = await p2.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => e.querySelectorAll('.sprig').length));
    if (spr.length !== 3 || spr.some((n) => n < 3)) errs.push(`[wall-offline] provenance ${spr}`);
  }
  await p2.screenshot({ path: `${out}/wall-desktop-offline.png` });
  await c2.close();
}

// v0.24 嫁接反馈与本地模型：三枝不撞车 / 新颖度 / 去 AI 腔 / 主干 / 讨厌 / 私密 / 文风 / 不要的理由 / 本地模型探测
const DUP_IDEA = '一分钟短片：雨夜的公交站，两个陌生人共用一把伞，一直等到末班车开走也没有上车，镜头只拍伞下的鞋。';
const MOCK_CONV_DUP = {
  pattern: '好几粒都落在「雨夜」',
  replaced: [],
  branches: [
    { seed: 1, title: '伞下的鞋', idea: DUP_IDEA, form: '一分钟短片', refs: [1, 2], unlike: '只拍鞋', experiment: '拍 20 分钟路人的鞋。' },
    { seed: 2, title: '伞下的鞋子', idea: DUP_IDEA.replace('也没有', '都没有'), form: '一分钟短片', refs: [2, 1], unlike: '也只拍鞋', experiment: '拍 20 分钟路人的鞋子。' },
    { seed: 6, title: '小票上的情书', idea: '值得一提的是，一本用便利店小票装订的小书：每张小票记录一次路过，商品名连起来读是一封没寄出的信。', form: '手作小书', refs: [1, 2], unlike: '能拿在手里', experiment: '收集今天的三张小票，改写成三行诗。' },
  ],
  cliches: [],
};
function e2eCore(t, idea) {
  return [t, idea].filter(Boolean).join('。').replace(/《[^》]{0,40}》/g, '').replace(/做成[^。]*?[：:][^。]*。/g, '').replace(/这一根的变形是「[^」]*」[^。]*。/g, '').replace(/接法「[^」]*」[^。]*。/g, '').replace(/约束[：:][^。]*。/g, '').replace(/方向[：:][^。]*。/g, '');
}
function e2eBig(s) {
  const t = s.replace(/[\s，。、《》「」『』“”"'：:；;！!？?,.\-—…·（）()[\]【】]/g, '').toLowerCase();
  const o = new Set();
  for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2));
  return o;
}
function e2eSim(a, b) {
  const A = e2eBig(e2eCore(a.title, a.idea));
  const B = e2eBig(e2eCore(b.title, b.idea));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}
async function quickCapture(pg, title, flag) {
  await pg.click('.quick-more');
  await pg.fill('.capture .field.big input', title);
  await pg.click('.capture .more-toggle');
  await pg.fill('.capture .field.why input', `${title}的理由`);
  await pg.click(`.capture .${flag}`);
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector(`.card:has-text("${title}")`, { timeout: 5000 }).catch(() => errs.push(`[graft24] captured ${title} not in library`));
}
async function graft24() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[graft24] pageerror ${e.message}`));
  const origin = new URL(base).origin;
  await pg.goto(base);
  await pg.evaluate((v) => localStorage.setItem('lingan.settings.v1', v), MOCK_SETTINGS(origin, { style: { on: true, samples: ['短句。不解释。只说看见的。'] } }));
  const log = await mockAI(pg, { delay: 80, conv: MOCK_CONV_DUP });
  await pg.reload();
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  // 0206 / 0242：速记里点「讨厌」「私密」
  await quickCapture(pg, '烂俗鸡汤语录', 'flag-dislike');
  await quickCapture(pg, '日记里的一句', 'flag-private');
  const rows = await dbRaw(pg, 'items');
  const bad = rows.find((x) => x.title === '烂俗鸡汤语录');
  const priv = rows.find((x) => x.title === '日记里的一句');
  if (bad?.polarity !== -1) errs.push(`[graft24] dislike flag not stored ${JSON.stringify(bad?.polarity)}`);
  if (priv?.private !== 1) errs.push(`[graft24] private flag not stored ${JSON.stringify(priv?.private)}`);
  if (!(await pg.locator('.card:has-text("烂俗鸡汤语录") .dislike-mark').count())) errs.push('[graft24] dislike mark missing on card');
  if (!(await pg.locator('.card:has-text("日记里的一句") .private-mark').count())) errs.push('[graft24] private mark missing on card');
  // 嫁接页：讨厌的 / 私密的（云端模型）都不会被抽到
  await pg.click('.nav-btn:has-text("嫁接")');
  await pg.click('.controls button:has-text("抽几穗")');
  for (let k = 0; k < 6; k++) {
    const names = await pg.locator('.pick-table .pair-item .card-title').allInnerTexts();
    if (names.some((n) => n.includes('烂俗鸡汤') || n.includes('日记里的一句'))) errs.push(`[graft24] drew a disliked / private item: ${names.join(' / ')}`);
    await pg.click('.controls .shuffle');
  }
  // 0203：没写为什么的提示（示例里有缺为什么的就出现；不强求）
  // 0202：钉住第一穗为主干
  const anchorTitle = (await pg.locator('.pick-table .pair-item .card-title').first().innerText()).trim();
  await pg.click('.pick-table .pair-item >> nth=0 >> .pin-anchor');
  await pg.waitForSelector('.pick-table .anchor-badge', { timeout: 3000 }).catch(() => errs.push('[graft24] anchor badge missing'));
  if (!(await pg.locator('.anchor-note').count())) errs.push('[graft24] anchor note missing');
  await pg.screenshot({ path: `${out}/graft24-picked.png`, fullPage: true });
  log.users.length = 0;
  log.systems.length = 0;
  await pg.click('.graft-btn');
  await pg.waitForSelector('.three .idea', { timeout: 20000 }).catch(() => errs.push('[graft24] graft did not finish'));
  await pg.waitForTimeout(300);
  if ((await pg.locator('.three .idea').count()) !== 3) errs.push('[graft24] expected 3 branches');
  // 三枝不撞车：模型给了两根几乎一样的 → 换掉一根，提示「换掉了一根太像的」，三根两两 < 阈值（默认 0.45）
  if ((await pg.locator('.three .distinct-badge').count()) !== 1) errs.push(`[graft24] expected exactly 1 「换掉了一根太像的」 badge, got ${await pg.locator('.three .distinct-badge').count()}`);
  if (!(await pg.locator('.three-head .distinct-note').count())) errs.push('[graft24] distinct note missing in three-head');
  await pg.waitForSelector('.toast:has-text("换掉了一根太像的")', { timeout: 3000 }).catch(() => errs.push('[graft24] distinct toast missing'));
  const devs = (await dbRaw(pg, 'developments')).sort((x, y) => y.createdAt - x.createdAt).slice(0, 3);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const sim = e2eSim(devs[i].idea, devs[j].idea);
    if (sim >= 0.45) errs.push(`[graft24] branches ${i}/${j} still too similar ${sim.toFixed(2)}`);
  }
  if (devs.filter((d) => d.idea.distinct === 'replaced').length !== 1) errs.push('[graft24] stored branches should have 1 distinct=replaced');
  // 0241 新颖度：三根都有角标；0234 去 AI 腔：「值得一提的是」被删
  if ((await pg.locator('.three .novelty').count()) !== 3) errs.push('[graft24] novelty line missing');
  if (devs.some((d) => typeof d.idea.nearest?.sim !== 'number')) errs.push('[graft24] stored nearest sim missing');
  if ((await branchOwnText(pg)).includes('值得一提的是')) errs.push('[graft24] AI-tone phrase not removed');
  if (!devs.some((d) => d.idea.deai >= 1)) errs.push('[graft24] deai count not stored');
  // 0202 主干：存了 anchorId；每根新枝的「因为这几穗」里主干加粗
  if (!devs.every((d) => typeof d.anchorId === 'number')) errs.push('[graft24] anchorId not stored');
  const anc = await pg.locator('.three .idea .sprig.anchor').count();
  if (anc < 3) errs.push(`[graft24] anchor sprig should be marked on every branch, got ${anc}`);
  // 提示词：主干 / AVOID（讨厌的，不带 ID）/ STYLE；私密穗一个字都不出现
  if (log.users.length < 2) errs.push(`[graft24] expected 2 AI calls, got ${log.users.length}`);
  for (const u of log.users) {
    if (!/\| 主干/.test(u)) errs.push('[graft24] prompt lacks 主干 mark');
    if (!u.includes('AVOID') || !u.includes('《烂俗鸡汤语录》')) errs.push('[graft24] prompt lacks AVOID with the disliked item');
    if (!u.includes('STYLE') || !u.includes('短句。不解释。')) errs.push('[graft24] prompt lacks STYLE sample');
    if (u.includes('日记里的一句')) errs.push('[graft24] private item leaked into prompt');
    if (!u.includes('为什么打动我')) errs.push('[graft24] why not in prompt');
  }
  if (!log.systems.every((x) => x.includes('是主干'))) errs.push('[graft24] system prompt lacks anchor rule');
  void anchorTitle;
  await pg.screenshot({ path: `${out}/graft24-result.png`, fullPage: true });
  // 0212 不要 + 理由：快捷理由
  await pg.locator('.three .idea-drop').first().click();
  await pg.waitForSelector('.confirm .reason-chips', { timeout: 3000 }).catch(() => errs.push('[graft24] reason chips missing in confirm'));
  if ((await pg.locator('.confirm .chip.reason').count()) !== 5) errs.push(`[graft24] expected 5 reason chips, got ${await pg.locator('.confirm .chip.reason').count()}`);
  await pg.click('.confirm .chip.reason[data-reason="cliche"]');
  await pg.waitForSelector('.confirm .chip.reason.on[data-reason="cliche"][aria-checked="true"]', { timeout: 2000 }).catch(() => errs.push('[graft24] picked reason not highlighted'));
  await studio(pg, 'graft24-confirm');
  await pg.screenshot({ path: `${out}/graft24-reason.png` });
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("记下了「太俗」")', { timeout: 3000 }).catch(() => errs.push('[graft24] reason toast missing'));
  // 自定义理由
  await pg.locator('.three .idea-drop').nth(1).click();
  await pg.click('.confirm .chip.reason[data-reason="custom"]');
  await pg.fill('.confirm .reason-input', '太像广告');
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("太像广告")', { timeout: 3000 }).catch(() => errs.push('[graft24] custom reason toast missing'));
  // 不选理由也能删
  const before = (await dbRaw(pg, 'rejects')).length;
  if (before !== 2) errs.push(`[graft24] rejects in db expected 2 got ${before}`);
  // 口味页：可见可删
  await pg.click('.nav-btn:has-text("口味")');
  await pg.waitForSelector('.rejects');
  if ((await pg.locator('.rejects .reject-row').count()) !== 2) errs.push('[graft24] taste should list 2 reasons');
  const tt = await pg.locator('.rejects').innerText();
  if (!tt.includes('太俗') || !tt.includes('太像广告')) errs.push('[graft24] reasons text missing on taste page');
  if (!(await pg.locator('.style-panel[data-on="1"]').count())) errs.push('[graft24] style panel should be on');
  if (!(await pg.locator('.dislikes[data-count="1"]').count())) errs.push('[graft24] dislike panel should list 1');
  await studio(pg, 'graft24-taste');
  await pg.screenshot({ path: `${out}/graft24-taste.png`, fullPage: true });
  await pg.click('.reject-row[data-reason="custom"] .reject-del');
  await pg.waitForFunction(() => document.querySelectorAll('.rejects .reject-row').length === 1, null, { timeout: 3000 }).catch(() => errs.push('[graft24] delete reason did not work'));
  // 下次嫁接：FEEDBACK 里有剩下的「太俗」，没有删掉的「太像广告」
  log.users.length = 0;
  await pg.click('.nav-btn:has-text("嫁接")');
  await pg.click('.controls .shuffle');
  await pg.click('.graft-btn');
  await pg.waitForSelector('.three .idea', { timeout: 20000 });
  await pg.waitForTimeout(300);
  const u2 = log.users.join('\n');
  if (!u2.includes('FEEDBACK') || !u2.includes('太俗、太常见')) errs.push('[graft24] next graft prompt lacks FEEDBACK');
  if (u2.includes('太像广告')) errs.push('[graft24] deleted reason still in prompt');
  await ctx.close();

  // 0208 / 0209 本地模型：探测本机 LM Studio（有模型）/ Ollama（没开），局域网地址探测，公网地址拒绝
  const c2 = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errs.push(`[local] pageerror ${e.message}`));
  const json = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  const probes = [];
  await c2.route('http://127.0.0.1:1234/**', (r) => (probes.push(r.request().url()), json(r, { data: [{ id: 'qwen2.5-7b-instruct' }, { id: 'text-embedding-nomic-embed-text-v1.5' }] })));
  await c2.route('http://127.0.0.1:11434/**', (r) => (probes.push(r.request().url()), r.abort('connectionrefused')));
  await c2.route('http://192.168.1.23:1234/**', (r) => (probes.push(r.request().url()), r.abort('connectionrefused')));
  await c2.route('http://192.168.1.23:11434/**', (r) => (probes.push(r.request().url()), r.request().url().endsWith('/api/tags') ? json(r, { models: [{ name: 'qwen3:8b' }] }) : r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no' })));
  p2.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_|CORS/.test(m.text()) && errs.push(`[local] console ${m.text()}`));
  await p2.goto(base);
  await p2.click('.nav-btn:has-text("设置")');
  await p2.click('.radio-list .radio:has-text("本地模型")');
  await p2.waitForSelector('.local-panel');
  await p2.click('.local-probe');
  await p2.waitForSelector('.local-row.ok[data-kind="lmstudio"]', { timeout: 6000 }).catch(() => errs.push('[local] LM Studio not found'));
  await p2.waitForSelector('.local-row.off[data-kind="ollama"]', { timeout: 6000 }).catch(() => errs.push('[local] Ollama off row missing'));
  if ((await p2.locator('.local-row[data-kind="lmstudio"] .chip.local-model').count()) !== 1) errs.push('[local] should list 1 chat model (embedding filtered)');
  await p2.click('.chip.local-model:has-text("qwen2.5-7b-instruct")');
  const base1 = await p2.locator('#set-ai input[placeholder="https://…/v1"]').inputValue();
  if (base1 !== 'http://127.0.0.1:1234/v1') errs.push(`[local] baseUrl not set: ${base1}`);
  await studio(p2, 'local-settings');
  await p2.screenshot({ path: `${out}/local-probe.png`, fullPage: true });
  // 测试连接按钮：本地模型不要密钥也能点
  if (await p2.locator('.test-conn').isDisabled()) errs.push('[local] test connection disabled without key');
  // 公网地址不探测
  const n0 = probes.length;
  await p2.fill('.local-host input', 'example.com');
  await p2.click('.local-probe-host');
  await p2.waitForSelector('.local-err', { timeout: 2000 }).catch(() => errs.push('[local] public host not refused'));
  if (probes.length !== n0) errs.push('[local] probed a public host');
  // 局域网电脑：Ollama /v1/models 404 → /api/tags
  await p2.fill('.local-host input', '192.168.1.23');
  await p2.click('.local-probe-host');
  await p2.waitForSelector('.local-row.ok[data-kind="ollama"]:has-text("192.168.1.23")', { timeout: 6000 }).catch(() => errs.push('[local] LAN Ollama not found via /api/tags'));
  await p2.click('#set-ai .btn.primary:has-text("保存")');
  const saved = await p2.evaluate(() => JSON.parse(localStorage.getItem('lingan.settings.v1') || '{}'));
  if (saved.preset !== 'local' || saved.localHost !== '192.168.1.23' || saved.chat?.chatModel !== 'qwen2.5-7b-instruct') errs.push(`[local] settings not saved ${JSON.stringify({ p: saved.preset, h: saved.localHost, m: saved.chat?.chatModel })}`);
  if (JSON.stringify(saved).includes('apiKey":"e2e')) errs.push('[local] key leaked');
  // 三枝不撞车阈值可调
  const v0 = await p2.locator('.distinct-val').innerText();
  await p2.locator('.distinct-range').fill('0.3');
  if ((await p2.locator('.distinct-val').innerText()) === v0) errs.push('[local] distinct threshold slider did not change');
  await p2.click('#set-ai .btn.primary:has-text("保存")');
  const saved2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('lingan.settings.v1') || '{}'));
  if (Math.abs((saved2.distinct?.text ?? 0) - 0.3) > 1e-6) errs.push(`[local] distinct threshold not saved ${JSON.stringify(saved2.distinct)}`);
  // 离线：本地模型照常可用的提示
  await c2.setOffline(true);
  await p2.waitForSelector('.offline-bar:has-text("本地模型照常嫁接")', { timeout: 3000 }).catch(() => errs.push('[local] offline bar should say local model works'));
  await c2.setOffline(false);
  await c2.close();
}

async function legacy() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[legacy] pageerror ${e.message}`));
  await pg.goto(new URL('favicon.svg', base).href);
  await pg.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('lingan', 10);
    r.onupgradeneeded = () => {
      const db = r.result;
      const it = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
      it.createIndex('type', 'type'); it.createIndex('createdAt', 'createdAt'); it.createIndex('updatedAt', 'updatedAt'); it.createIndex('tags', 'tags', { multiEntry: true });
      const dv = db.createObjectStore('developments', { keyPath: 'id', autoIncrement: true });
      dv.createIndex('createdAt', 'createdAt'); dv.createIndex('starred', 'starred');
    };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction(['items', 'developments'], 'readwrite');
      const now = Date.now();
      const its = tx.objectStore('items');
      its.add({ id: 1, type: 'film', title: '旧片子', tags: [], createdAt: now - 9e7, updatedAt: now });
      its.add({ id: 2, type: 'music', title: '旧歌', tags: [], createdAt: now - 9e7, updatedAt: now });
      its.add({ id: 3, type: 'idea', title: '旧念头', tags: [], createdAt: now - 9e7, updatedAt: now });
      const dvs = tx.objectStore('developments');
      dvs.add({ itemIds: [1, 2], jump: 0.5, idea: { title: '早先的一根', bridge: '旧桥', idea: '旧片子和旧歌接在一起', cliches: ['旧套路甲', '「旧套路乙」'] }, source: 'ai', createdAt: now - 8e7 });
      dvs.add({ itemIds: [1, 2, 3], jump: 0.5, idea: { title: '三枝里的一根', bridge: '', idea: '旧念头', cliches: [], refs: [1, 3], transform: 'invert' }, source: 'offline', createdAt: now - 7e7, batch: { id: 'gold', index: 0, size: 1, tensions: [{ text: 't', refs: [1] }], seeds: [] } });
      tx.oncomplete = () => { db.close(); res(null); };
      tx.onerror = () => rej(tx.error);
    };
  }));
  await pg.goto(base);
  await pg.waitForSelector('.view');
  await pg.click('.nav-btn:has-text("新枝")');
  await pg.waitForSelector('.hrow');
  if ((await pg.locator('.hrow').count()) !== 2) errs.push('[legacy] old branches lost');
  for (const t of ['早先的一根', '三枝里的一根']) {
    await pg.locator(`.hrow-head:has-text("${t}")`).click();
    await pg.waitForSelector('.hrow.open .sprig', { timeout: 3000 }).catch(() => errs.push(`[legacy] ${t} has no sprigs`));
    const n = await pg.locator('.hrow.open .sprig[data-item-id]').count();
    if (n !== 2) errs.push(`[legacy] ${t} expected 2 sprigs got ${n}`);
    if (!(await pg.locator('.hrow.open .sprigs-note:has-text("早先长的")').count())) errs.push(`[legacy] ${t} legacy note missing`);
    if (await pg.locator('.hrow.open .sprigs-weak').count()) errs.push(`[legacy] ${t} wrongly marked 证据不足`);
    await pg.locator('.hrow.open .hrow-head').click();
  }
  const ver = await pg.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingan'); r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; }));
  if (ver !== 100) errs.push(`[legacy] db version expected 100 (Dexie v10) got ${ver}`);
  // v0.26 0624：迁移前先把旧库原样存了一份（glean-snap 里的 pre-upgrade），记下当前库版本；再打开不会重复存
  const pu = await pg.evaluate(() => ({ g: window.__gleanPreUpgrade, seen: localStorage.getItem('glean.schema.v1') }));
  if (!pu.g || pu.g.from !== 1 || pu.g.to !== 10 || !pu.g.id || pu.seen !== '10') errs.push(`[legacy] pre-upgrade dump ${JSON.stringify(pu)}`);
  const snaps = await pg.evaluate(() => new Promise((res) => { const r = indexedDB.open('glean-snap'); r.onsuccess = () => { const q = r.result.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => { r.result.close(); res(q.result.map((x) => ({ kind: x.kind, schema: x.schema, items: x.items.map((i) => i.title), devs: x.developments.length, graft: x.items.map((i) => i.graftCount) }))); }; }; }));
  const pre = snaps.filter((x) => x.kind === 'pre-upgrade');
  if (pre.length !== 1 || pre[0].schema !== 1 || pre[0].items.join() !== '旧片子,旧歌,旧念头' || pre[0].devs !== 2 || pre[0].graft.some((x) => x != null)) errs.push(`[legacy] pre-upgrade snapshot should hold the untouched v1 rows ${JSON.stringify(snaps)}`);
  await pg.reload();
  await pg.waitForSelector('.view');
  if (await pg.evaluate(() => window.__gleanPreUpgrade)) errs.push('[legacy] pre-upgrade dump ran again on a normal start');
  await openSettings(pg);
  await pg.locator('#set-snap').scrollIntoViewIfNeeded();
  if ((await pg.locator('.snap-row[data-kind="pre-upgrade"]').count()) !== 1) errs.push('[legacy] settings should list the pre-upgrade copy');
  const [pdl] = await Promise.all([pg.waitForEvent('download', { timeout: 10000 }), pg.click('.snap-row[data-kind="pre-upgrade"] .snap-save')]);
  const pj = JSON.parse(fs.readFileSync(await pdl.path(), 'utf8'));
  if (pj.app !== 'lingan' || !pj.raw || pj.items.length !== 3 || pj.developments.length !== 2 || !/^glean-pre-upgrade-v1-/.test(pdl.suggestedFilename())) errs.push(`[legacy] pre-upgrade file ${pdl.suggestedFilename()} ${JSON.stringify({ app: pj.app, n: pj.items?.length })}`);
  await pg.click('.nav-btn:has-text("新枝")');
  // v0.19 旧新枝里列过的套路迁移上墙
  const lw = (await dbRaw(pg, 'cliches')).map((c) => c.key).sort();
  if (JSON.stringify(lw) !== JSON.stringify(['旧套路乙', '旧套路甲'].sort())) errs.push(`[legacy] wall backfill ${JSON.stringify(lw)}`);
  // v0.18 旧新枝回填嫁接次数：#1 两次（单根 + 一批），#2 两次，#3 一次
  const gc = (await dbRaw(pg, 'items')).sort((x, y) => x.id - y.id).map((x) => x.graftCount);
  if (JSON.stringify(gc) !== '[2,2,1]') errs.push(`[legacy] graftCount backfill expected [2,2,1] got ${JSON.stringify(gc)}`);
  // v0.17 旧库升级后：后台补好索引，旧穗和旧新枝都搜得到
  await pg.waitForFunction(() => window.__gleanSearch?.ready && window.__gleanSearch.indexed === 5, null, { timeout: 8000 }).catch(async () => errs.push(`[legacy] index not built ${JSON.stringify(await pg.evaluate(() => window.__gleanSearch))}`));
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.click('.search-toggle');
  await sqType(pg, '旧念头');
  const lh = await sqHeads(pg);
  if (lh.items !== 1 || lh.branches !== 1) errs.push(`[legacy] search 旧念头 expected 1 穗 + 1 新枝 got ${JSON.stringify(lh)}`);
  await ctx.close();
}


// v0.13 千穗不卡：灌 1000 穗（含 300 张 1280×960 照片）进 v0.12 的旧库结构 → 打开 App 迁移 + 后台补缩略图 →
// 冷启动计时（普通 / CPU 降速 4 倍模拟中端安卓）→ 瀑布与时间线滚动测帧。数字写进 perf.json 并打印。
const PERF = {};
async function seedLegacy1000(pg) {
  await pg.goto(new URL('favicon.svg', base).href);
  return pg.evaluate(async () => {
    // 12 张不同的「照片」：渐变 + 色块 + 噪点，JPEG 0.82，大小接近手机照片压到 1280 边后的样子
    const variants = [];
    for (let v = 0; v < 12; v++) {
      const c = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas'); // 在 svg 文档里
      c.width = v % 3 === 2 ? 960 : 1280; c.height = v % 3 === 2 ? 1280 : 960;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, c.width, c.height);
      gr.addColorStop(0, `hsl(${v * 31}, 55%, 70%)`); gr.addColorStop(1, `hsl(${v * 31 + 140}, 45%, 30%)`);
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
      for (let k = 0; k < 40; k++) { g.fillStyle = `hsla(${(v * 47 + k * 13) % 360}, 60%, ${30 + (k % 5) * 12}%, 0.5)`; g.beginPath(); g.arc((k * 197) % c.width, (k * 131) % c.height, 30 + (k % 7) * 25, 0, 7); g.fill(); }
      const id = g.getImageData(0, 0, c.width, c.height);
      let s = v * 7919 + 1;
      for (let i = 0; i < id.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const n = (s % 41) - 20; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
      g.putImageData(id, 0, 0);
      variants.push(c.toDataURL('image/jpeg', 0.82));
    }
    // v0.21：300 张图各不相同（.glean 按内容哈希去重，同图只存一份；这里要的是 300 份真原图）——在 JPEG 头后插一个注释段
    const uniqueJpeg = (url, i) => {
      const bin = atob(url.slice(url.indexOf(',') + 1));
      const tag = `glean-perf-${i}`;
      const seg = String.fromCharCode(0xff, 0xfe, 0, tag.length + 2) + tag;
      return 'data:image/jpeg;base64,' + btoa(bin.slice(0, 2) + seg + bin.slice(2));
    };
    const words = ['麦田', '黄昏', '旧歌', '慢镜头', '雨', '海边', '便利店', '霓虹', '胶片', '手写', '风', '街角', '老电影', '钢琴', '夏天', '夜车'];
    const types = ['film', 'music', 'text', 'idea', 'link'];
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 1000; i++) {
      const img = i % 10 < 3; // 300 张
      const t = img ? 'image' : types[i % 5];
      const w1 = words[i % 16], w2 = words[(i * 7) % 16];
      rows.push({
        type: t,
        title: img ? `${w1}的照片 ${i}` : `${w1}与${w2} · 第 ${i} 穗`,
        creator: i % 3 ? `作者${i % 37}` : '',
        content: t === 'text' || t === 'idea' ? `${w1}和${w2}之间有一种说不清的关系，像${words[(i * 3) % 16]}落在${words[(i * 5) % 16]}上。`.repeat(1 + (i % 3)) : '',
        url: t === 'link' ? `https://example.com/a/${i}` : '',
        why: i % 4 === 0 ? `因为${w2}让我想起${words[(i * 11) % 16]}` : '',
        tags: [w1, w2].slice(0, 1 + (i % 2)),
        ...(img ? { image: uniqueJpeg(variants[i % 12], i) } : {}),
        createdAt: now - Math.floor(i * 6.1 * 3600e3) - (i % 7) * 60e3,
        updatedAt: now,
      });
    }
    await new Promise((res, rej) => {
      const r = indexedDB.open('lingan', 20);
      r.onupgradeneeded = () => {
        const db = r.result;
        const it = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
        it.createIndex('type', 'type'); it.createIndex('createdAt', 'createdAt'); it.createIndex('updatedAt', 'updatedAt'); it.createIndex('tags', 'tags', { multiEntry: true });
        const dv = db.createObjectStore('developments', { keyPath: 'id', autoIncrement: true });
        dv.createIndex('createdAt', 'createdAt'); dv.createIndex('starred', 'starred'); dv.createIndex('evidence', 'evidence');
      };
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction('items', 'readwrite');
        for (const row of rows) tx.objectStore('items').add(row);
        tx.oncomplete = () => { db.close(); res(null); };
        tx.onerror = () => rej(tx.error);
      };
    });
    const sizes = variants.map((v) => Math.round((v.length * 3) / 4 / 1024));
    return { avgOrigKB: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length), maxOrigKB: Math.max(...sizes) };
  });
}
// 页面里按固定速度滚动 durMs 毫秒，记录每帧间隔
async function measureScroll(pg, pxPerSec, durMs) {
  return pg.evaluate(async ({ pxPerSec, durMs }) => {
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
    const max = document.documentElement.scrollHeight - innerHeight;
    const deltas = [];
    let maxMounted = 0;
    let maxLive = 0;
    await new Promise((res) => {
      const t0 = performance.now();
      let last = t0;
      const step = (now) => {
        deltas.push(now - last);
        last = now;
        const y = Math.min(max, ((now - t0) / 1000) * pxPerSec);
        window.scrollTo(0, y);
        maxMounted = Math.max(maxMounted, document.querySelectorAll('.card, .tl-frame, .list-view .trow').length);
        maxLive = Math.max(maxLive, window.__gleanImg?.live || 0);
        if (now - t0 < durMs && y < max) requestAnimationFrame(step);
        else res(null);
      };
      requestAnimationFrame(step);
    });
    const d = deltas.slice(2).sort((a, b) => a - b);
    const sum = d.reduce((a, b) => a + b, 0);
    const pct = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
    return {
      frames: d.length,
      scrolledPx: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      avgFps: Math.round((1000 * d.length) / sum),
      p50Ms: +pct(0.5).toFixed(1),
      p95Ms: +pct(0.95).toFixed(1),
      maxMs: +d[d.length - 1].toFixed(1),
      jankPct: +((100 * d.filter((x) => x > 34).length) / d.length).toFixed(1), // 超过 2 帧（掉帧）
      longPct: +((100 * d.filter((x) => x > 50).length) / d.length).toFixed(1),
      maxMountedCards: maxMounted,
      maxLiveObjectUrls: maxLive,
    };
  }, { pxPerSec, durMs });
}
async function coldStart(ctx, cpu) {
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const t = Date.now();
  await pg.goto(base);
  await pg.waitForFunction(() => window.__gleanReady && document.querySelectorAll('.masonry .card').length > 0, null, { timeout: 30000 });
  const r = await pg.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { ready: Math.round(window.__gleanReady), dcl: Math.round(nav?.domContentLoadedEventEnd || 0), cards: document.querySelectorAll('.masonry .card').length, count: document.querySelector('.page-title .count')?.textContent?.match(/\((\d+)\)/)?.[1] };
  });
  // 首屏缩略图全部解码好的时刻
  r.thumbs = await pg.evaluate(async () => {
    const imgs = [...document.querySelectorAll('.masonry img.card-img')].filter((i) => i.getBoundingClientRect().top < innerHeight);
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; }))));
    return { n: imgs.length, at: Math.round(performance.now()) };
  });
  r.wall = Date.now() - t;
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await pg.close();
  return r;
}
// v0.17 秒搜：1000 穗、断网，搜两个汉字从输入到结果（含黑底高亮）画出来 ≤ 100ms；计数与按规则数出来的一致
async function perfSearch(ctx) {
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[perf-search] pageerror ${e.message}`));
  await pg.goto(base);
  await pg.waitForFunction(() => window.__gleanReady && window.__gleanSearch?.ready, null, { timeout: 30000 });
  const reopen = await pg.evaluate(() => ({ ...window.__gleanSearch }));
  PERF.searchIndex.reopenLoadMs = reopen.loadMs;
  PERF.searchIndex.reopenRebuilt = reopen.built;
  if (reopen.built !== 0) errs.push(`[perf-search] reopening should not re-tokenize (built ${reopen.built})`);
  const raw = await dbRaw(pg, 'items');
  await ctx.setOffline(true);
  await pg.click('.search-toggle');
  await pg.waitForSelector('.sq-input');
  const runs = [];
  for (const q of ['黄昏', '海边', '钢琴', '夜车', '麦田', '黄昏']) {
    const r = await sqTime(pg, q);
    const exp = raw.filter((x) => e2eMatch(itemSearchText(x), e2eTerms(q))).length;
    if (r.n !== exp) errs.push(`[perf-search] ${q}: ${r.n} results, expected ${exp}`);
    if (!r.marks || r.markText !== q || r.markBg !== 'rgb(212, 203, 229)') errs.push(`[perf-search] ${q}: highlight wrong ${JSON.stringify(r)}`);
    runs.push(r);
  }
  await pg.screenshot({ path: `${out}/perf-search-1000.png` });
  // 4 倍降速（中端安卓）也量一次，只记录
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = [];
  for (const q of ['黄昏', '便利', '霓虹']) slow.push(await sqTime(pg, q));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await ctx.setOffline(false);
  PERF.search = { items: raw.length, offline: true, runs: runs.map((r) => ({ q: r.q, ms: r.ms, results: r.n, coreMs: r.core })), maxMs: Math.max(...runs.map((r) => r.ms)), medianMs: median(runs.map((r) => r.ms)), cpu4x: slow.map((r) => ({ q: r.q, ms: r.ms, results: r.n, coreMs: r.core })) };
  for (const r of runs) if (r.ms > 100) errs.push(`[perf-search] ${r.q} took ${r.ms}ms > 100ms`);
  await pg.close();
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function perf() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { if (!localStorage.getItem('lingan.settings.v1')) localStorage.setItem('lingan.settings.v1', JSON.stringify({ phase: 'day', autoCaption: false, autoEmbed: false })); });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[perf] pageerror ${e.message}`));
  // 种库时停在 favicon.svg 上，浏览器顺手要 /favicon.ico（静态服务器 404），这条不是 App 的错
  pg.on('console', (m) => m.type() === 'error' && !/\/favicon\.ico$/.test(m.location()?.url || '') && errs.push(`[perf] console ${m.text()}`));
  const seed = await seedLegacy1000(pg);
  PERF.seed = { items: 1000, images: 300, ...seed };
  // 第一次打开：Dexie v2 → v3 迁移（原图搬进 images 表）+ 首屏
  const t0 = Date.now();
  await pg.goto(base);
  await pg.waitForFunction(() => window.__gleanReady && document.querySelectorAll('.masonry .card').length > 0, null, { timeout: 60000 });
  PERF.firstOpenWithMigrationMs = await pg.evaluate(() => Math.round(window.__gleanReady));
  // v0.26 0624：迁移前存了升级前副本（内联大原图不复制，不能让第一次打开卡住）
  PERF.preUpgrade = await pg.evaluate(() => window.__gleanPreUpgrade || null);
  if (!PERF.preUpgrade?.id) errs.push(`[perf] pre-upgrade copy missing ${JSON.stringify(PERF.preUpgrade)}`);
  // 后台补 300 张缩略图
  await pg.waitForFunction(() => window.__gleanThumbs && window.__gleanThumbs.runs > 0 && !window.__gleanThumbs.running && window.__gleanThumbs.left === 0, null, { timeout: 150000 }).catch(() => errs.push('[perf] thumbnails never finished'));
  const th = await pg.evaluate(() => ({ ...window.__gleanThumbs }));
  PERF.thumbJob = { made: th.made, failed: th.failed, ms: th.lastMs, wallMs: Date.now() - t0 };
  // 数据完整性：1000 穗、300 原图、300 缩略图、行里不再有内联原图
  const integ = await pg.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('lingan');
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction(['items', 'images'], 'readonly');
      const out = { version: db.version, items: 0, inline: 0, withThumb: 0, hasImage: 0, thumbBytes: [], images: 0, imageBytes: 0 };
      tx.objectStore('items').openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;
        const v = c.value;
        out.items++;
        if ('image' in v) out.inline++;
        if (v.hasImage) out.hasImage++;
        if (v.thumb) { out.withThumb++; out.thumbBytes.push(v.thumb.size); }
        c.continue();
      };
      tx.objectStore('images').openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;
        out.images++;
        out.imageBytes += c.value.blob.size;
        c.continue();
      };
      tx.oncomplete = () => {
        db.close();
        const tb = out.thumbBytes;
        res({ ...out, thumbBytes: undefined, avgThumbKB: +(tb.reduce((a, b) => a + b, 0) / Math.max(1, tb.length) / 1024).toFixed(1), maxThumbKB: +(Math.max(0, ...tb) / 1024).toFixed(1), avgOrigKB: Math.round(out.imageBytes / Math.max(1, out.images) / 1024) });
      };
    };
  }));
  PERF.storage = integ;
  if (integ.version !== 100) errs.push(`[perf] db version (expected 100 = Dexie v10) ${integ.version}`);
  if (integ.items !== 1000 || integ.images !== 300 || integ.hasImage !== 300) errs.push(`[perf] data lost in migration ${JSON.stringify(integ)}`);
  if (integ.inline !== 0) errs.push(`[perf] ${integ.inline} rows still carry inline originals`);
  if (integ.withThumb !== 300) errs.push(`[perf] thumbnails ${integ.withThumb}/300`);
  if (integ.avgThumbKB > 30) errs.push(`[perf] thumbnails too big: avg ${integ.avgThumbKB}KB`);
  // v0.17 秒搜：旧库升级后后台把 1000 穗补进索引表
  await pg.waitForFunction(() => window.__gleanSearch?.ready && window.__gleanSearch.indexed === 1000, null, { timeout: 60000 }).catch(async () => errs.push(`[perf] search index not built ${JSON.stringify(await pg.evaluate(() => window.__gleanSearch))}`));
  const ftBuild = await pg.evaluate(() => ({ ...window.__gleanSearch }));
  const ftCount = (await dbRaw(pg, 'ftidx')).length;
  PERF.searchIndex = { built: ftBuild.built, buildMs: ftBuild.buildMs, rows: ftCount };
  if (ftCount !== 1000) errs.push(`[perf] ftidx rows ${ftCount} != 1000`);
  await pg.close();
  await perfSearch(ctx);
  // 冷启动：每次新开页面（新的 JS 堆、重新读库），各 3 次取中位数
  const normal = [];
  const slow = [];
  for (let i = 0; i < 3; i++) normal.push(await coldStart(ctx, 1));
  for (let i = 0; i < 3; i++) slow.push(await coldStart(ctx, 4));
  for (const r of [...normal, ...slow]) if (r.count !== '1000') errs.push(`[perf] cold start shows ${r.count} items`);
  PERF.coldStartMs = { median: median(normal.map((r) => r.ready)), runs: normal.map((r) => r.ready), firstThumbsDecodedMedian: median(normal.map((r) => r.thumbs.at)), cardsOnFirstScreen: normal[0].cards };
  PERF.coldStartCpu4xMs = { median: median(slow.map((r) => r.ready)), runs: slow.map((r) => r.ready), firstThumbsDecodedMedian: median(slow.map((r) => r.thumbs.at)) };
  if (PERF.coldStartMs.median > 2000) errs.push(`[perf] cold start ${PERF.coldStartMs.median}ms > 2000ms`);
  if (PERF.coldStartCpu4xMs.median > 2000) errs.push(`[perf] cold start at 4x CPU slowdown ${PERF.coldStartCpu4xMs.median}ms > 2000ms`);
  // 滚动：穗仓瀑布（双列）与时间线
  const sp = await ctx.newPage();
  sp.on('pageerror', (e) => errs.push(`[perf] pageerror ${e.message}`));
  await sp.goto(base);
  await sp.waitForFunction(() => window.__gleanReady && document.querySelectorAll('.masonry .card').length > 0);
  await sp.waitForTimeout(2200); // 首屏显影动画走完
  PERF.scrollMasonry = await measureScroll(sp, 2400, 7000);
  await sp.evaluate(() => window.scrollTo(0, 6000));
  await sp.waitForTimeout(1500);
  await noOverlap(sp, 'perf');
  await sp.screenshot({ path: `${out}/perf-library-1000.png` });
  const vm = await sp.evaluate(() => window.__gleanVirtual?.masonry);
  PERF.scrollMasonry.virtual = vm;
  await sp.evaluate(() => window.scrollTo(0, 0));
  await sp.waitForTimeout(500);
  // 滚完回顶：objectURL 已回收（挂着的卡片才有）
  PERF.scrollMasonry.liveObjectUrlsAfter = await sp.evaluate(() => window.__gleanImg?.live);
  PERF.scrollMasonry.objectUrlsCreated = await sp.evaluate(() => window.__gleanImg?.created);
  await sp.click('.view-switch button:has-text("时间线")');
  await sp.waitForSelector('.tl-day .tl-frame');
  await sp.waitForTimeout(800);
  PERF.scrollTimeline = await measureScroll(sp, 2400, 6000);
  PERF.scrollTimeline.virtual = await sp.evaluate(() => window.__gleanVirtual?.timeline);
  // v0.16 列表视图（无线表格，一行一穗，同样虚拟滚动）
  await sp.click('.view-switch button:has-text("列表")');
  await sp.waitForSelector('.list-view .trow');
  await sp.waitForTimeout(500);
  PERF.scrollList = await measureScroll(sp, 2400, 6000);
  PERF.scrollList.virtual = await sp.evaluate(() => window.__gleanVirtual?.timeline);
  // 4 倍降速下再滚一次网格
  await sp.click('.view-switch button:has-text("网格")');
  await sp.waitForTimeout(600);
  const cdp = await ctx.newCDPSession(sp);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  PERF.scrollMasonryCpu4x = await measureScroll(sp, 1600, 5000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  for (const [k, r] of [['masonry', PERF.scrollMasonry], ['timeline', PERF.scrollTimeline], ['list', PERF.scrollList]]) {
    if (r.scrolledPx < 8000) errs.push(`[perf] ${k} scrolled only ${r.scrolledPx}px`);
    // 瀑布只挂视口附近 ~20 张；时间线按天挂（一天一整条横排），上限放宽
    if (r.maxMountedCards > (k === 'masonry' ? 60 : 140)) errs.push(`[perf] ${k} not virtualized: ${r.maxMountedCards} cards mounted`);
    if (r.jankPct > 10) errs.push(`[perf] ${k} dropped frames ${r.jankPct}% > 10%`);
  }
  if (PERF.scrollMasonry.maxLiveObjectUrls > 80) errs.push(`[perf] objectURLs not recycled: ${PERF.scrollMasonry.maxLiveObjectUrls} live`);
  if (PERF.scrollMasonry.liveObjectUrlsAfter > 60) errs.push(`[perf] objectURLs leak: ${PERF.scrollMasonry.liveObjectUrlsAfter} live after scrolling back`);
  // 详情读原图（1280 边），不是缩略图
  await sp.evaluate(() => window.scrollTo(0, 0));
  await sp.waitForTimeout(300);
  await sp.locator('.masonry .card:has(img.card-img)').first().click();
  await sp.waitForSelector('.detail img.detail-img');
  const nat = await sp.locator('.detail img.detail-img').evaluate(async (i) => { if (!i.complete) await new Promise((r) => (i.onload = r)); return i.naturalWidth; });
  if (nat < 900) errs.push(`[perf] detail should show the original, got ${nat}px wide`);
  const cardNat = await sp.locator('.masonry img.card-img').first().evaluate((i) => i.naturalWidth);
  if (cardNat > 400) errs.push(`[perf] card should use thumbnail, got ${cardNat}px wide`);
  PERF.detailOriginalPx = nat;
  PERF.cardThumbPx = cardNat;
  await sp.screenshot({ path: `${out}/perf-detail.png` });
  await sp.close();
  await perfBackup(ctx);
  await ctx.close();
  fs.writeFileSync(`${out}/perf.json`, JSON.stringify(PERF, null, 2));
}

// v0.20 安全加固：CSP（与 tauri.conf.json 同一份，vitest 校验一致）、密钥迁移进钥匙串、错误兜底 + 本地日志 + 诊断、安全模式
const APP_CSP = {
  'default-src': "'self' ipc: http://ipc.localhost",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data: blob: https:",
  'font-src': "'self' data:",
  'media-src': "'self' data: blob:",
  'connect-src': "'self' ipc: http://ipc.localhost",
  'worker-src': "'self' blob:",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'frame-src': "'none'",
};
const cspString = () => Object.entries(APP_CSP).map(([k, v]) => `${k} ${v}`).join('; ');
async function security() {
  const tag = 'security';
  const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
  // 文档响应里加上 CSP（Tauri 里由 tauri.conf.json 注入；这里用 meta 模拟），记录所有违规
  await ctx.route((u) => u.origin === new URL(base).origin && (u.pathname === '/' || u.pathname.endsWith('.html')), async (route) => {
    const resp = await route.fetch();
    const html = (await resp.text()).replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${cspString()}">`);
    await route.fulfill({ response: resp, body: html, headers: { ...resp.headers(), 'content-type': 'text/html' } });
  });
  await ctx.addInitScript(() => {
    window.__cspv = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const pg = await ctx.newPage();
  const expected = /crash probe|e2e-unhandled|The above error occurred|React will try to recreate/;
  pg.on('pageerror', (e) => !expected.test(e.message) && errs.push(`[${tag}] pageerror ${e.message}`));
  pg.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && errs.push(`[${tag}] console ${m.text()}`));
  const origin = new URL(base).origin;
  // 旧版：key 明文在设置里 → 首次启动搬走
  await pg.goto(base);
  await pg.evaluate((v) => localStorage.setItem('lingan.settings.v1', v), JSON.stringify({ ...JSON.parse(MOCK_SETTINGS(origin)), chat: { ...JSON.parse(MOCK_SETTINGS(origin)).chat, apiKey: 'e2e-legacy-key-123' } }));
  const auth = [];
  await mockAI(pg, { delay: 50 });
  // 后注册的先跑：先记下 Authorization，再交给 mockAI
  await pg.route('**/mock-ai/v1/chat/completions', (r) => (auth.push(r.request().headers()['authorization'] || ''), r.fallback()));
  await pg.reload();
  await pg.waitForSelector('.view');
  const mig = await pg.evaluate(() => ({ s: localStorage.getItem('lingan.settings.v1') || '', v: JSON.parse(localStorage.getItem('glean.vault.v1') || '{}') }));
  if (mig.s.includes('e2e-legacy-key-123')) errs.push(`[${tag}] legacy key still in settings after migration`);
  if (mig.v['chat.apiKey'] !== 'e2e-legacy-key-123') errs.push(`[${tag}] legacy key not migrated to vault`);
  // 示例 + 打开详情 + 搜索 + AI 嫁接 + 设置：全程 CSP 无违规
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card[data-sample="1"]');
  await pg.locator('.card').first().click();
  await pg.waitForTimeout(400);
  await pg.keyboard.press('Escape');
  await pg.click('.search-toggle').catch(() => {});
  await pg.fill('.sq-input', '雨').catch(() => {});
  await pg.waitForTimeout(300);
  await pg.keyboard.press('Escape');
  await pg.click('.nav-btn:has-text("嫁接")');
  await pg.click('.controls button:has-text("抽几穗")');
  await pg.click('.graft-btn');
  await pg.waitForSelector('.three .idea', { timeout: 15000 }).catch(() => errs.push(`[${tag}] AI graft under CSP failed`));
  if (!auth.length || !auth.every((h) => h === 'Bearer e2e-legacy-key-123')) errs.push(`[${tag}] AI calls should carry migrated key, got ${JSON.stringify(auth.slice(0, 2))}`);
  await pg.click('.nav-btn:has-text("设置")');
  await pg.waitForSelector('#set-diag');
  const fontsOk = await pg.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.status === 'loaded'); });
  if (!fontsOk) errs.push(`[${tag}] self-hosted fonts did not load under CSP`);
  const keyField = await pg.locator('#set-ai input[type="password"]').first().inputValue();
  if (keyField !== 'e2e-legacy-key-123') errs.push(`[${tag}] settings key field should show vault key`);
  const vaultLabel = await pg.locator('.diag-vault').innerText();
  if (!vaultLabel.includes('浏览器')) errs.push(`[${tag}] vault label should say browser fallback, got ${vaultLabel}`);
  // 改 key → 只进钥匙串
  await pg.fill('#set-ai input[type="password"]', 'e2e-new-key-456');
  await pg.click('#set-ai .btn.primary');
  const after = await pg.evaluate(() => ({ s: localStorage.getItem('lingan.settings.v1') || '', v: JSON.parse(localStorage.getItem('glean.vault.v1') || '{}') }));
  if (after.s.includes('e2e-new-key-456') || after.v['chat.apiKey'] !== 'e2e-new-key-456') errs.push(`[${tag}] new key should go to vault only`);
  // 全局兜底：未处理的 Promise 拒绝进本地日志，且脱敏
  await pg.evaluate(() => { Promise.reject(new Error('e2e-unhandled Bearer sk-abcdefghijklmnop1234')); });
  await pg.waitForTimeout(200);
  // 页面级错误边界：口味页抛错 → 只这一页出错，导航还在
  await pg.evaluate(() => localStorage.setItem('glean.debug.crash', 'taste'));
  await pg.click('.nav-btn:has-text("口味")');
  await pg.waitForSelector('.crash-view:has-text("这一页出错了")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] view error boundary not shown`));
  await pg.screenshot({ path: `${out}/${tag}-crash-view.png` });
  await pg.evaluate(() => localStorage.removeItem('glean.debug.crash'));
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.waitForSelector('.card', { timeout: 4000 }).catch(() => errs.push(`[${tag}] other views should still work after a view crash`));
  const log = await pg.evaluate(() => JSON.parse(localStorage.getItem('glean.errlog.v1') || '[]'));
  if (!log.some((e) => e.src === 'render' && e.view === 'taste')) errs.push(`[${tag}] render error not logged`);
  if (!log.some((e) => e.src === 'rejection' && e.msg.includes('e2e-unhandled'))) errs.push(`[${tag}] unhandled rejection not logged`);
  if (JSON.stringify(log).includes('sk-abcdefghijklmnop1234')) errs.push(`[${tag}] error log not scrubbed`);
  // 设置 → 诊断：复制诊断信息
  await pg.click('.nav-btn:has-text("设置")');
  await pg.waitForSelector('.diag-copy');
  await pg.click('.diag-copy');
  await pg.waitForTimeout(300);
  const diag = await pg.evaluate(() => navigator.clipboard.readText());
  if (!/拾穗 Glean 诊断信息[\s\S]*版本：v\d+\.\d+\.\d+[\s\S]*库：\d+ 穗[\s\S]*最近错误（[1-9]/.test(diag)) errs.push(`[${tag}] diagnostics text incomplete: ${diag.slice(0, 160)}`);
  if (/e2e-new-key-456|e2e-legacy-key|sk-abcdefghijklmnop/.test(diag)) errs.push(`[${tag}] diagnostics leaks a key`);
  await pg.locator('#set-diag').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: `${out}/${tag}-diag.png` });
  // 安全模式：进 → 条幅 + 动效关 → 退
  await pg.click('.diag-safe');
  await pg.waitForSelector('.safe-bar', { timeout: 5000 }).catch(() => errs.push(`[${tag}] safe mode bar missing`));
  const sm = await pg.evaluate(() => ({ safe: document.documentElement.dataset.safe, motion: document.documentElement.dataset.motion }));
  if (sm.safe !== '1' || sm.motion !== 'off') errs.push(`[${tag}] safe mode should disable motion ${JSON.stringify(sm)}`);
  await pg.click('.safe-exit');
  await pg.waitForSelector('.view');
  await pg.waitForTimeout(300);
  if (await pg.locator('.safe-bar').count()) errs.push(`[${tag}] safe mode should exit`);
  const v = await pg.evaluate(() => window.__cspv);
  if (v.length) errs.push(`[${tag}] CSP violations: ${v.slice(0, 5).join(' | ')}`);
  console.log(`security: csp violations ${v.length}, ai calls ${auth.length}, errlog ${log.length}`);
  await ctx.close();
}

// v0.25 Agent 与 API / 更新：网页版里是说明 + 开关（本地 API 只有桌面版），写入开关要确认，接入命令可复制，访问记录可见
async function agent() {
  const tag = 'agent';
  for (const vp of [{ width: 1366, height: 860 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(() => localStorage.setItem('glean.onboarded', '1'));
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
    await pg.goto(base);
    await pg.waitForSelector('.view');
    await pg.evaluate(() => localStorage.setItem('glean.apiaudit.v1', JSON.stringify([{ t: Date.now() - 60000, client: 'Claude Code', tool: 'search_items', n: 7, ok: true }, { t: Date.now() - 30000, client: 'Cherry Studio', tool: 'add_item', n: 0, ok: false }])));
    await openSettings(pg);
    await pg.waitForSelector('#set-agent');
    const st = await pg.evaluate(() => ({
      na: !!document.querySelector('#set-agent .agent-na'),
      apiDisabled: document.querySelector('.agent-api')?.disabled,
      apiOn: document.querySelector('.agent-api')?.getAttribute('aria-checked'),
      write: document.querySelector('.agent-write')?.getAttribute('aria-checked'),
      audit: document.querySelector('.agent-audit')?.textContent || '',
      recent: document.querySelectorAll('.agent-recent li').length,
      denied: document.querySelectorAll('.agent-recent li.err').length,
      update: !!document.querySelector('#set-update'),
      checkDisabled: document.querySelector('.update-check')?.disabled,
      overflow: [...document.querySelectorAll('#set-agent, #set-update')].some((e) => e.scrollWidth > e.clientWidth + 1),
      index: [...document.querySelectorAll('.set-link-k')].map((e) => e.textContent).join('|'),
    }));
    if (!st.na || !st.apiDisabled || st.apiOn !== 'false') errs.push(`[${tag}] web build should show desktop-only API switch ${JSON.stringify(st)}`);
    if (st.write !== 'false') errs.push(`[${tag}] write should default to read-only`);
    if (!st.audit.includes('Claude Code') || !st.audit.includes('7 穗') || st.recent !== 2 || st.denied !== 1) errs.push(`[${tag}] audit view wrong ${JSON.stringify(st)}`);
    if (!st.update || !st.checkDisabled) errs.push(`[${tag}] update panel on web should exist with check disabled`);
    if (st.overflow) errs.push(`[${tag}] agent/update panel overflows at ${vp.width}`);
    if (!st.index.includes('Agent 与 API') || !st.index.includes('更新')) errs.push(`[${tag}] settings index missing new sections: ${st.index}`);
    // 写入：要确认；取消 = 保持只读
    await pg.click('.agent-write');
    await pg.waitForSelector('.confirm');
    await pg.click('.confirm button:has-text("保持只读")');
    await pg.waitForTimeout(300);
    if ((await pg.getAttribute('.agent-write', 'aria-checked')) !== 'false') errs.push(`[${tag}] cancel should keep read-only`);
    await pg.click('.agent-write');
    await pg.waitForSelector('.confirm');
    await pg.click('.confirm button:has-text("允许写入")');
    await pg.waitForTimeout(300);
    const cfg = await pg.evaluate(() => JSON.parse(localStorage.getItem('glean.agent.v1') || '{}'));
    if ((await pg.getAttribute('.agent-write', 'aria-checked')) !== 'true' || cfg.write !== true || cfg.on) errs.push(`[${tag}] write switch not saved ${JSON.stringify(cfg)}`);
    // 端口
    await pg.fill('.agent-port input', '50001');
    await pg.locator('.agent-port input').blur();
    await pg.waitForTimeout(200);
    const port = await pg.evaluate(() => JSON.parse(localStorage.getItem('glean.agent.v1') || '{}').port);
    if (port !== 50001) errs.push(`[${tag}] port not saved: ${port}`);
    // 复制 Claude Code 命令
    await pg.click('.agent-copy-cc');
    await pg.waitForTimeout(300);
    const clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    if (vp.width > 1000 && !clip.startsWith('claude mcp add --transport http glean http://127.0.0.1:50001/mcp --header "Authorization: Bearer ')) errs.push(`[${tag}] claude command copy wrong: ${clip}`);
    // 自动检查更新开关在网页版不可点；清空访问记录
    await pg.click('.agent-audit-clear');
    await pg.waitForSelector('.agent-audit-empty');
    if (vp.width < 600) await pg.locator('#set-agent').screenshot({ path: `${out}/agent-mobile.png` }).catch(() => {});
    await ctx.close();
  }
  console.log('agent: settings panels ok');
}

// v0.26 数据保险：自动备份（安卓桥模拟：写 → 回读校验 → 列表 → 恢复预览）、操作前快照（清空回收站 / 清空 → 回到那之前）、
// 清空先导出（0622）、写入失败兜底（0605：IndexedDB 抛 QuotaExceeded → 暂存 → 重开自动补上）
const MOCK_BACKUP = () => {
  const files = new Map();
  let cur = null;
  let curName = '';
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  window.__bak = files;
  window.LinganBackup = {
    where: () => '下载/Glean',
    begin: (n) => { cur = []; curName = n; return true; },
    append: (s) => { cur.push(unb64(s)); return true; },
    commit: () => { const len = cur.reduce((a, x) => a + x.length, 0); const all = new Uint8Array(len); let p = 0; for (const x of cur) { all.set(x, p); p += x.length; } files.set(curName, all); cur = null; return '下载/Glean'; },
    abort: () => { cur = null; },
    list: () => JSON.stringify([...files].map(([name, u]) => ({ name, bytes: u.length }))),
    remove: (n) => files.delete(n),
    readAt: (n, off, len) => { const u = files.get(n); return u ? b64(u.subarray(off, off + len)) : ''; },
  };
};
async function snapRows(pg) {
  return pg.locator('.snap-row').evaluateAll((els) => els.map((e) => ({ kind: e.dataset.kind, label: e.querySelector('.tc-title').textContent, src: e.querySelector('.tc-src').textContent })));
}
async function safety() {
  const tag = 'safety';
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.addInitScript(MOCK_BACKUP);
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  await pg.goto(base);
  await pg.waitForSelector('text=穗仓还是空的');
  for (const t of ['安全一', '安全二', '安全三']) await quickSave(pg, t);
  if ((await dbItems(pg)).length !== 3) errs.push(`[${tag}] seed failed`);
  // 1) 自动备份（安卓桥）：立即备份 → 回读校验通过 → 列表标「已验证」→ 恢复…出导入预览
  await openSettings(pg);
  const idx = await pg.locator('.set-link-k').allTextContents();
  if (!idx.includes('自动备份') || !idx.includes('操作前快照')) errs.push(`[${tag}] settings index missing new sections ${idx.join('|')}`);
  await pg.locator('#set-autobak').scrollIntoViewIfNeeded();
  if (await pg.locator('.autobak-web').count()) errs.push(`[${tag}] bridge present but panel shows web note`);
  await pg.click('.autobak-now');
  await pg.waitForSelector('.toast:has-text("回读校验通过")', { timeout: 20000 }).catch(() => errs.push(`[${tag}] backup toast`));
  await pg.waitForSelector('.autobak-row[data-verified="ok"]', { timeout: 5000 }).catch(() => errs.push(`[${tag}] backup row not verified`));
  const bk = await pg.evaluate(() => [...window.__bak.keys()]);
  if (bk.length !== 1 || !/^glean-manual-\d{4}-\d\d-\d\d-\d{6}\.glean$/.test(bk[0])) errs.push(`[${tag}] backup files ${JSON.stringify(bk)}`);
  if (!(await pg.locator('.autobak-where:has-text("下载/Glean")').count())) errs.push(`[${tag}] backup location not shown`);
  await pg.click('.autobak-restore');
  await pg.waitForSelector('.import-preview', { timeout: 10000 }).catch(() => errs.push(`[${tag}] restore preview`));
  const pv = await importNote(pg, 'merge').catch(() => ({}));
  if (pv.add !== 0 || pv.skip !== 3) errs.push(`[${tag}] restore preview counts ${JSON.stringify(pv)}`);
  await pg.click('.import-cancel');
  // 保留策略切换
  await pg.click('.autobak-policy button:has-text("最近 7 份")');
  const pol = await pg.evaluate(() => JSON.parse(localStorage.getItem('glean.autobak.v1') || '{}').policy);
  if (pol !== 'last7') errs.push(`[${tag}] policy not saved ${pol}`);
  await pg.locator('#set-autobak').screenshot({ path: `${out}/safety-autobak.png` });
  const ov = await pg.evaluate(() => [...document.querySelectorAll('#set-autobak, #set-snap')].some((e) => e.scrollWidth > e.clientWidth + 1));
  if (ov) errs.push(`[${tag}] safety panels overflow on mobile`);
  // 2) 回收站里一穗 → 清空回收站（先拍快照，连原图）→ 回到那之前：它又回到回收站
  await pg.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingan'); r.onsuccess = () => { const tx = r.result.transaction('items', 'readwrite'); const st = tx.objectStore('items'); st.getAll().onsuccess = (e) => { const it = e.target.result.find((x) => x.title === '安全一'); it.deletedAt = Date.now(); st.put(it); }; tx.oncomplete = () => { r.result.close(); res(); }; }; }));
  await pg.reload();
  await pg.waitForSelector('.view');
  await openSettings(pg);
  await pg.locator('#set-trash').scrollIntoViewIfNeeded();
  await pg.click('.trash-empty');
  await pg.waitForSelector('.confirm');
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("已彻底删掉 1 件")');
  if ((await dbRaw(pg, 'items', true)).length !== 2) errs.push(`[${tag}] purge should drop the trashed ear`);
  await pg.locator('#set-snap').scrollIntoViewIfNeeded();
  await pg.waitForSelector('.snap-row:has-text("清空回收站前")', { timeout: 5000 }).catch(() => errs.push(`[${tag}] no snapshot before emptying trash`));
  await pg.locator('.snap-row:has-text("清空回收站前") .snap-back').first().click();
  await pg.waitForSelector('.confirm:has-text("回到「清空回收站前」")');
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("已回到「清空回收站前」")', { timeout: 8000 }).catch(() => errs.push(`[${tag}] restore toast`));
  const back = await dbRaw(pg, 'items', true);
  if (back.length !== 3 || back.filter((x) => x.deletedAt).length !== 1) errs.push(`[${tag}] after restore expected 3 rows (1 in trash) got ${JSON.stringify(back.map((x) => [x.title, !!x.deletedAt]))}`);
  const sr = await snapRows(pg);
  if (!sr[0]?.label.includes('恢复「清空回收站前」前')) errs.push(`[${tag}] restore should snapshot the present first ${JSON.stringify(sr)}`);
  // 3) 清空：第一步点「算了」什么都不发生；确认后先导出 .glean（下载），存好了才问第二次；清空后能从快照回来
  await pg.click('.trow.danger');
  await pg.waitForSelector('.confirm:has-text("清空所有穗和新枝")');
  await pg.click('.confirm-cancel');
  if ((await dbRaw(pg, 'items', true)).length !== 3) errs.push(`[${tag}] cancel should keep everything`);
  await pg.click('.trow.danger');
  await pg.waitForSelector('.confirm:has-text("清空所有穗和新枝")');
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }), pg.click('.confirm-ok')]);
  await pg.waitForSelector('.confirm:has-text("备份存好了")');
  const z = readZipBuf(fs.readFileSync(await dl.path()));
  const man = JSON.parse(new TextDecoder().decode(z.get('manifest.json')));
  if (man.counts.items !== 3 || !/\.glean$/.test(dl.suggestedFilename())) errs.push(`[${tag}] wipe export ${dl.suggestedFilename()} ${JSON.stringify(man.counts)}`);
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("已清空")');
  if ((await dbRaw(pg, 'items', true)).length !== 0) errs.push(`[${tag}] wipe left rows`);
  await pg.locator('.snap-row:has-text("清空所有前") .snap-back').first().click();
  await pg.waitForSelector('.confirm');
  await pg.click('.confirm-ok');
  await pg.waitForSelector('.toast:has-text("已回到「清空所有前」")', { timeout: 8000 }).catch(() => errs.push(`[${tag}] restore after wipe`));
  if ((await dbRaw(pg, 'items', true)).length !== 3) errs.push(`[${tag}] wipe snapshot did not bring rows back`);
  await pg.locator('#set-snap').screenshot({ path: `${out}/safety-snap.png` });
  // v0.27：手机上快照 / 备份列表的说明和时间折行显示，不截成「…」
  const trunc = await pg.evaluate(() => [...document.querySelectorAll('.snap-row .tc-title, .snap-row .tc-src, .autobak-row .tc-title, .autobak-row .tc-src')].filter((e) => getComputedStyle(e).whiteSpace === 'nowrap' || getComputedStyle(e).textOverflow === 'ellipsis' || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  const nRows = await pg.locator('.snap-row').count();
  if (trunc.length || !nRows) errs.push(`[${tag}] snapshot / backup rows truncated on mobile (${nRows} rows) ${JSON.stringify(trunc.slice(0, 4))}`);
  // 4) 写入失败兜底：items 写入抛 QuotaExceeded → 提示已暂存、输入清空 → 重开后自动补上
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.evaluate(() => {
    const P = IDBObjectStore.prototype;
    const add = P.add;
    const put = P.put;
    const undo = () => { P.add = add; P.put = put; };
    P.add = function (...a) { if (this.name === 'items') { undo(); throw new DOMException('full', 'QuotaExceededError'); } return add.apply(this, a); };
    P.put = function (...a) { if (this.name === 'items') { undo(); throw new DOMException('full', 'QuotaExceededError'); } return put.apply(this, a); };
  });
  await pg.fill('.quick-input', '空间满时收的');
  await pg.press('.quick-input', 'Enter');
  await pg.waitForSelector('.toast:has-text("已暂存在本机")', { timeout: 5000 }).catch(() => errs.push(`[${tag}] pending toast`));
  const pend = await pg.evaluate(() => ({ q: JSON.parse(localStorage.getItem('glean.pending.v1') || '[]'), v: document.querySelector('.quick-input')?.value }));
  if (pend.q.length !== 1 || pend.q[0].data.title !== '空间满时收的' || pend.v) errs.push(`[${tag}] pending queue ${JSON.stringify(pend)}`);
  await pg.reload();
  await pg.waitForSelector('.toast:has-text("上次没存进去的 1 穗已补进穗仓")', { timeout: 10000 }).catch(() => errs.push(`[${tag}] replay toast`));
  const after = await dbItems(pg);
  if (!after.some((x) => x.title === '空间满时收的') || (await pg.evaluate(() => localStorage.getItem('glean.pending.v1')))) errs.push(`[${tag}] replay did not land ${JSON.stringify(after.map((x) => x.title))}`);
  await ctx.close();
  // 5) 网页版（没有桥）：自动备份说明白只在 App 里有
  const wctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const wp = await wctx.newPage();
  await wp.goto(base);
  await wp.waitForSelector('.view');
  await openSettings(wp);
  await wp.locator('#set-autobak').scrollIntoViewIfNeeded();
  if (!(await wp.locator('.autobak-web').count()) || (await wp.locator('.autobak-now').count())) errs.push(`[${tag}] web should explain auto backup is app-only`);
  await wp.locator('#set-autobak').screenshot({ path: `${out}/safety-web.png` });
  await wctx.close();
  console.log('safety: backup / snapshots / wipe / pending ok');
}

// v0.27 界面交互（C1）：安全区 / 主题桥、键盘贴底、类型小标、#标签补全、长按 / 右键菜单、返回原位、详情就地改、Ctrl+V / 拖放 / 小窗粘图、Ctrl+N、多窗口同步、触达区 ≥44
const MOCK_CHROME = () => {
  window.__theme = [];
  window.LinganChrome = { insets: () => '{"t":32,"b":20,"l":0,"r":0}', setTheme: (d, bg) => window.__theme.push([d, bg]) };
};
async function seedMany(pg, n) {
  await pg.evaluate((n) => new Promise((res) => { const r = indexedDB.open('lingan'); r.onsuccess = () => { const tx = r.result.transaction('items', 'readwrite'); const st = tx.objectStore('items'); const now = Date.now(); for (let i = 0; i < n; i++) st.add({ type: 'idea', title: `批量穗 ${i}`, content: '', creator: '', year: '', url: '', why: i % 2 ? '' : '因为好看', tags: i % 3 ? ['夜车'] : ['城市'], createdAt: now - i * 60000, updatedAt: now - i * 60000, uid: `01SEED${String(i).padStart(20, '0')}` }); tx.oncomplete = () => { r.result.close(); res(); }; }; }), n);
}
async function pngFileJs(pg) {
  // 页面里画一张真 PNG，返回 dataURL（粘贴 / 拖放用）
  return pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; const g = c.getContext('2d'); g.fillStyle = '#c96'; g.fillRect(0, 0, 40, 30); return c.toDataURL('image/png'); });
}
async function smallTargets(pg) {
  return pg.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="switch"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], summary')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || el.closest('[aria-hidden="true"]')) continue;
      const a = getComputedStyle(el, '::after');
      let w = r.width;
      let h = r.height;
      if (a.content !== 'none' && a.position === 'absolute') {
        w = Math.max(w, parseFloat(a.width) || 0);
        h = Math.max(h, parseFloat(a.height) || 0);
      }
      if (w < 43.5 || h < 43.5) bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(w)}x${Math.round(h)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 10)}"`);
    }
    return bad;
  });
}
async function ui27() {
  const tag = 'ui27';
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(MOCK_CHROME);
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  await pg.goto(base);
  await pg.waitForSelector('text=穗仓还是空的');
  // 0410 / 0416：原生安全区写进 CSS 变量，顶栏让开状态栏；主题同步给状态栏
  const edge = await pg.evaluate(() => ({ e: document.documentElement.dataset.edge, top: getComputedStyle(document.querySelector('.topbar')).paddingTop, dock: getComputedStyle(document.querySelector('.dock')).paddingBottom, th: window.__theme.at(-1) }));
  if (edge.e !== '1' || edge.top !== '32px' || !edge.dock.includes('30px') || JSON.stringify(edge.th) !== '[false,"#f7f5f1"]') errs.push(`[${tag}] safe area / theme bridge ${JSON.stringify(edge)}`);
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('glean:insets', { detail: { t: 40, b: 0, l: 0, r: 0 } })));
  if ((await pg.evaluate(() => getComputedStyle(document.querySelector('.topbar')).paddingTop)) !== '40px') errs.push(`[${tag}] insets event not applied`);
  for (const t of ['夜车上睡着 #夜车', '雨夜的霓虹 #雨夜', '城市天际线 #城市']) await quickSave(pg, t);
  // 0412：类型小标，点一下换类型，存的就是换过的
  await pg.fill('.quick-input', 'https://music.163.com/song?id=9');
  const t1 = await pg.textContent('.quick-type');
  await pg.click('.quick-type');
  const t2 = await pg.textContent('.quick-type');
  await pg.press('.quick-input', 'Enter');
  await pg.waitForTimeout(400);
  const last = (await dbRaw(pg, 'items')).find((x) => x.url === 'https://music.163.com/song?id=9');
  if (t1 !== '音乐' || t2 !== '电影' || last?.type !== 'film') errs.push(`[${tag}] type chip ${t1} → ${t2} saved ${last?.type}`);
  // 0413：#标签补全（Tab 填第一个；回车不抢存）
  await pg.click('.quick-input');
  await pg.keyboard.type('新的一穗 #夜');
  await pg.waitForSelector('.tag-suggest-opt', { timeout: 3000 }).catch(() => errs.push(`[${tag}] no tag suggestions`));
  const sugg = await pg.locator('.tag-suggest-opt').allTextContents();
  if (sugg[0] !== '#夜车' || !sugg.includes('#雨夜')) errs.push(`[${tag}] suggestions ${JSON.stringify(sugg)}`);
  await pg.keyboard.press('Tab');
  await pg.waitForTimeout(100);
  const qv = await pg.inputValue('.quick-input');
  if (qv !== '新的一穗 #夜车 ') errs.push(`[${tag}] tab fill ${JSON.stringify(qv)}`);
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(400);
  const nt = (await dbItems(pg)).find((x) => x.title === '新的一穗');
  if (!nt || nt.tags.join() !== '夜车') errs.push(`[${tag}] tag fill save ${JSON.stringify(nt)}`);
  // 0401：输入框聚焦、视口被键盘压矮 → 底栏只留速记条，贴着可见区底边
  await pg.focus('.quick-input');
  await pg.setViewportSize({ width: 390, height: 520 });
  await pg.waitForTimeout(300);
  const kb = await pg.evaluate(() => ({ kb: document.documentElement.dataset.kb, nav: getComputedStyle(document.querySelector('.dock .nav')).display, bottom: Math.round(document.querySelector('.quick-dock .quick-bar').getBoundingClientRect().bottom), h: innerHeight }));
  if (kb.kb !== '1' || kb.nav !== 'none' || kb.bottom > kb.h || kb.h - kb.bottom > 40) errs.push(`[${tag}] keyboard dock ${JSON.stringify(kb)}`);
  await pg.evaluate(() => document.activeElement.blur());
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.waitForTimeout(300);
  if (await pg.evaluate(() => document.documentElement.dataset.kb)) errs.push(`[${tag}] keyboard flag should clear`);
  // 0411：长按卡片 → 底部菜单 → 编辑
  const card = pg.locator('.card:has-text("城市天际线")');
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(200);
  const box = await card.boundingBox();
  await pg.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y })); }, [box.x + 20, box.y + 20]);
  await pg.waitForSelector('.ctxmenu.as-sheet', { timeout: 2000 }).catch(() => errs.push(`[${tag}] long press menu`));
  const acts = await pg.locator('.ctxmenu-item').allTextContents();
  if (acts.join('|') !== '打开|编辑|拿去嫁接|放进嫁接篮|复制文字|删掉') errs.push(`[${tag}] menu items ${acts.join('|')}`);
  await pg.click('.ctx-edit');
  await pg.waitForSelector('.sheet .capture', { timeout: 3000 }).catch(() => errs.push(`[${tag}] menu edit`));
  await pg.click('.sheet .icon-btn');
  // 0409：详情就地改标题 / 为什么（#标签进标签）/ 加标签
  await card.click();
  await pg.waitForSelector('.detail');
  await pg.click('.detail-title .inline-edit');
  await pg.fill('.detail-title .inline-input', '城市天际线（夜）');
  await pg.keyboard.press('Enter');
  await pg.click('.detail-why .inline-edit');
  await pg.fill('.detail-why .inline-input', '灯一盏盏亮起来 #夜车');
  await pg.keyboard.press('Control+Enter');
  await pg.click('.tags .tag-add');
  await pg.fill('.tags .inline-input', '天台');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(400);
  const ed = (await dbRaw(pg, 'items')).find((x) => x.title.startsWith('城市天际线'));
  if (ed?.title !== '城市天际线（夜）' || ed?.why !== '灯一盏盏亮起来' || ed?.tags.join() !== '城市,夜车,天台') errs.push(`[${tag}] inline edit ${JSON.stringify(ed && [ed.title, ed.why, ed.tags])}`);
  if (!(await pg.locator('.detail-title:has-text("城市天际线（夜）")').count())) errs.push(`[${tag}] detail not refreshed after inline edit`);
  // Esc 放弃，不关详情
  await pg.click('.detail-title .inline-edit');
  await pg.fill('.detail-title .inline-input', '不要这个');
  await pg.keyboard.press('Escape');
  if (!(await pg.locator('.detail').count()) || (await dbItems(pg)).some((x) => x.title === '不要这个')) errs.push(`[${tag}] escape should cancel edit only`);
  await pg.click('.sheet .icon-btn');
  // 0403：关掉详情回到那张卡；切页回来回到原来的滚动位置
  await pg.waitForSelector('.card.was-open', { timeout: 1200 }).catch(async () => errs.push(`[${tag}] closed card not marked ${await pg.evaluate(() => JSON.stringify({ a: document.activeElement?.outerHTML.slice(0, 80), d: !!document.querySelector('.detail'), s: !!document.querySelector('.sheet'), cards: [...document.querySelectorAll('.main [data-item-id]')].map((e) => e.dataset.itemId + ':' + e.className) }))}`));
  await seedMany(pg, 60);
  await pg.reload();
  await pg.waitForSelector('.card');
  await pg.evaluate(() => window.scrollTo(0, 1500));
  await pg.waitForTimeout(300);
  const y0 = await pg.evaluate(() => window.scrollY);
  const anchor0 = await pg.evaluate(() => { const el = [...document.querySelectorAll('.main .card[data-item-id]')].find((e) => e.getBoundingClientRect().top >= 80); return el ? { id: el.dataset.itemId, top: Math.round(el.getBoundingClientRect().top) } : null; });
  await pg.click('.nav-btn:has-text("设置")');
  await pg.waitForSelector('.settings-layout, .set-sec');
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.waitForTimeout(1200);
  const y1 = await pg.evaluate(() => window.scrollY);
  // 回到同一张卡、差不多同一位置（浏览器的滚动锚定会因上方内容长高而整体挪一点，看的是卡不是像素）
  const anchor1 = anchor0 && (await pg.evaluate((id) => { const el = document.querySelector(`.main .card[data-item-id="${id}"]`); return el ? Math.round(el.getBoundingClientRect().top) : null; }, anchor0.id));
  // 瀑布流在上方模块晚到时会重新分列，单张卡的像素位置不一定不变：要求刚才看着的那张卡回来后仍在屏幕里
  if (y0 < 1000 || y1 < 1000 || !anchor0 || anchor1 == null || anchor1 < -150 || anchor1 > 700) errs.push(`[${tag}] scroll restore ${y0} → ${y1} card ${JSON.stringify(anchor0)} → ${anchor1}`);
  // 0414：手机上可点元素触达区 ≥ 44（穗仓 / 设置 / 详情）
  const small = [];
  await pg.evaluate(() => window.scrollTo(0, 0));
  small.push(...(await smallTargets(pg)));
  await pg.click('.nav-btn:has-text("设置")');
  await pg.waitForSelector('.set-sec');
  for (const y of [0, 1200, 2400, 3600]) {
    await pg.evaluate((y) => window.scrollTo(0, y), y);
    await pg.waitForTimeout(150);
    small.push(...(await smallTargets(pg)));
  }
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.locator('.card').first().click();
  await pg.waitForSelector('.detail');
  small.push(...(await smallTargets(pg)));
  await pg.click('.sheet .icon-btn');
  const uniq = [...new Set(small)];
  PERF.touchTargets = { small: uniq.length, list: uniq.slice(0, 20) };
  if (uniq.length) errs.push(`[${tag}] touch targets < 44px: ${uniq.slice(0, 8).join(' ; ')}${uniq.length > 8 ? ` …(+${uniq.length - 8})` : ''}`);
  // 0416：换黑主题 → 状态栏桥收到 dark
  await pg.click('.nav-btn:has-text("设置")');
  await pg.click('.theme-seg button:has-text("黑")').catch(() => errs.push(`[${tag}] theme seg`));
  await pg.waitForTimeout(200);
  if (JSON.stringify(await pg.evaluate(() => window.__theme.at(-1))) !== '[true,"#17161a"]') errs.push(`[${tag}] dark theme not sent to status bar`);
  await ctx.close();

  // 桌面：右键菜单、Ctrl+V 成穗、拖放、Ctrl+N、速记小窗粘图、多窗口同步
  const dctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const dp = await dctx.newPage();
  dp.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  await dp.goto(base);
  await dp.waitForSelector('text=穗仓还是空的');
  await quickSave(dp, '右键这一穗');
  await dp.click('.card:has-text("右键这一穗")', { button: 'right' });
  await dp.waitForSelector('.ctxmenu.at-point', { timeout: 2000 }).catch(() => errs.push(`[${tag}] right click menu`));
  const mp = await dp.evaluate(() => { const r = document.querySelector('.ctxmenu').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0; });
  if (!mp) errs.push(`[${tag}] menu off screen`);
  await dp.keyboard.press('Escape');
  if (await dp.locator('.ctxmenu').count()) errs.push(`[${tag}] esc should close menu`);
  await dp.click('.card:has-text("右键这一穗")', { button: 'right' });
  await dp.click('.ctx-delete');
  await dp.waitForSelector('.confirm');
  await dp.click('.confirm-ok');
  await dp.waitForTimeout(300);
  if ((await dbItems(dp)).some((x) => x.title === '右键这一穗')) errs.push(`[${tag}] menu delete`);
  // 0406：穗仓任意处 Ctrl+V（文字 / 图片）
  await dp.click('.view h1, .view', { position: { x: 5, y: 5 } }).catch(() => {});
  await dp.evaluate(() => { document.activeElement?.blur?.(); const dt = new DataTransfer(); dt.setData('text/plain', '粘贴来的一句话'); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await dp.waitForSelector('.toast:has-text("已拾 1 穗")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] paste text toast`));
  const png = await pngFileJs(dp);
  await dp.evaluate(async (png) => { const blob = await (await fetch(png)).blob(); const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' })); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, png);
  await dp.waitForTimeout(1200);
  const pasted = await dbItems(dp);
  if (!pasted.some((x) => x.title === '粘贴来的一句话') || !pasted.some((x) => x.type === 'image' && x.title === '粘贴的图片')) errs.push(`[${tag}] paste anywhere ${JSON.stringify(pasted.map((x) => [x.type, x.title]))}`);
  // 输入框里粘贴照旧（不成穗）
  const n0 = (await dbItems(dp)).length;
  await dp.focus('.quick-input');
  await dp.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', '只是粘进输入框'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await dp.waitForTimeout(400);
  if ((await dbItems(dp)).length !== n0) errs.push(`[${tag}] paste in input should not capture`);
  await dp.evaluate(() => document.activeElement.blur());
  // 0407：拖文件进窗口：出提示层，松手成穗（图片 + .md + 跳过 pdf）
  await dp.evaluate(async (png) => {
    const blob = await (await fetch(png)).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], '海边.png', { type: 'image/png' }));
    dt.items.add(new File(['# 读书笔记\n第二行'], '读书笔记.md', { type: 'text/markdown' }));
    dt.items.add(new File(['%PDF'], 'x.pdf', { type: 'application/pdf' }));
    window.__dt = dt;
    document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, png);
  if (!(await dp.locator('.dropin').count())) errs.push(`[${tag}] drop overlay`);
  await dp.evaluate(() => document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true })));
  await dp.waitForSelector('.toast:has-text("已拾 2 穗 · 跳过 1 个")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] drop toast`));
  if (await dp.locator('.dropin').count()) errs.push(`[${tag}] overlay should hide after drop`);
  const dropped = await dbItems(dp);
  if (!dropped.some((x) => x.type === 'image' && x.title === '海边') || !dropped.some((x) => x.type === 'text' && x.title === '读书笔记')) errs.push(`[${tag}] drop items ${JSON.stringify(dropped.map((x) => [x.type, x.title]))}`);
  // 0406：Ctrl+N 打开完整表单
  await dp.keyboard.press('Control+n');
  await dp.waitForSelector('.sheet .capture', { timeout: 2000 }).catch(() => errs.push(`[${tag}] ctrl+n`));
  await dp.keyboard.press('Escape');
  // 0405：速记小窗粘贴图片 → 预览 → 回车存成图片穗（带说明）
  await dp.evaluate(() => window.dispatchEvent(new Event('glean:quick')));
  await dp.waitForSelector('.quick-window input');
  await dp.fill('.quick-window input', '截图里的海');
  await dp.evaluate(async (png) => { const blob = await (await fetch(png)).blob(); const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' })); document.querySelector('.quick-window input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, png);
  await dp.waitForSelector('.qw-img img', { timeout: 3000 }).catch(() => errs.push(`[${tag}] quick window image preview`));
  await dp.press('.quick-window input', 'Enter');
  await dp.waitForTimeout(600);
  if (!(await dbItems(dp)).some((x) => x.type === 'image' && x.title === '截图里的海')) errs.push(`[${tag}] quick window image save`);
  // 0417：两个窗口：一个存穗、改主题，另一个立刻跟上
  const dp2 = await dctx.newPage();
  await dp2.goto(base);
  await dp2.waitForSelector('.card');
  await quickSave(dp, '另一个窗口也看得到');
  await dp2.waitForSelector('.card:has-text("另一个窗口也看得到")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] cross-window item sync`));
  await dp.evaluate(() => { const s = JSON.parse(localStorage.getItem('lingan.settings.v1') || '{}'); s.theme = 'dark'; localStorage.setItem('lingan.settings.v1', JSON.stringify(s)); });
  await dp2.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 3000 }).catch(() => errs.push(`[${tag}] cross-window settings sync`));
  await dctx.close();
  console.log('ui27: safe area / keyboard / type chip / tag suggest / menus / scroll / inline edit / paste / drop / sync ok');
}

// v0.28 拾穗动线：0024 行内语法 / 0019 口令 / 0023 去追踪参数 / 0408 待嫁接篮 / 0107 穗束 / 0108 束当嫁接池 / 0112 拼音搜索 / 0402 桌面三栏 / 0404 首启拾第一穗
async function longPress(pg, sel) {
  const card = pg.locator(sel).first();
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(150);
  const box = await card.boundingBox();
  await pg.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y })); }, [box.x + 20, box.y + 20]);
  await pg.waitForSelector('.ctxmenu.as-sheet', { timeout: 2000 });
  await pg.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y })); }, [box.x + 20, box.y + 20]);
}
async function v028() {
  const tag = 'v028';
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  await pg.goto(base);
  await pg.waitForSelector('text=穗仓还是空的');
  // 0024 / 0019 / 0023：速记条里的行内语法、口令、追踪参数
  await quickSave(pg, '《重庆森林》 @王家卫 > 雨夜里的霓虹 #夜');
  await quickSave(pg, '一个人的末班车 http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！');
  await quickSave(pg, 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1007&vd_source=abc&t=30 好看的片段');
  await quickSave(pg, '/歌 晴天 @周杰伦');
  let rows = await dbRaw(pg, 'items');
  const film = rows.find((x) => x.title === '重庆森林');
  if (!film || film.type !== 'film' || film.creator !== '王家卫' || film.why !== '雨夜里的霓虹' || film.tags.join() !== '夜') errs.push(`[${tag}] inline syntax ${JSON.stringify(film)}`);
  const xhs = rows.find((x) => x.url === 'http://xhslink.com/a/AbCdEf');
  if (!xhs || xhs.title !== '一个人的末班车') errs.push(`[${tag}] share code ${JSON.stringify(xhs && xhs.title)}`);
  const bili = rows.find((x) => /bilibili/.test(x.url || ''));
  if (!bili || bili.url !== 'https://www.bilibili.com/video/BV1xx411c7mD/?t=30') errs.push(`[${tag}] tracking params ${bili && bili.url}`);
  const song = rows.find((x) => x.title === '晴天');
  if (!song || song.type !== 'music' || song.creator !== '周杰伦') errs.push(`[${tag}] /歌 ${JSON.stringify(song)}`);
  // 0408 待嫁接篮：长按菜单放进去，满 3 穗能嫁接
  for (const s of ['重庆森林', '晴天', '一个人的末班车']) {
    await longPress(pg, `.card:has-text("${s}")`);
    const lbl = await pg.textContent('.ctx-basket').catch(() => '');
    if (lbl !== '放进嫁接篮') errs.push(`[${tag}] basket menu label ${lbl}`);
    await pg.click('.ctx-basket');
    await pg.waitForTimeout(200);
  }
  const bk = await pg.evaluate(() => localStorage.getItem('glean.basket.v1'));
  if (!bk) errs.push(`[${tag}] basket storage empty`);
  await pg.waitForSelector('.basket-dock', { timeout: 4000 }).catch(() => errs.push(`[${tag}] basket not shown in dock`));
  const bn = await pg.textContent('.basket-n').catch(() => '');
  if (bn !== '3/5') errs.push(`[${tag}] basket count ${bn}`);
  if (await pg.locator('.basket-graft:disabled').count()) errs.push(`[${tag}] basket graft should be enabled at 3`);
  const small = await smallTargets(pg);
  if (small.length) errs.push(`[${tag}] small targets with basket: ${small.slice(0, 5).join('; ')}`);
  await pg.click('.basket-toggle');
  await pg.waitForSelector('.basket-list li');
  if ((await pg.locator('.basket-list li').count()) !== 3) errs.push(`[${tag}] basket list`);
  await pg.screenshot({ path: `${out}/v028-basket.png` });
  // 0107 篮子存成穗束
  await pg.click('.basket-bundle');
  await pg.fill('.basket-acts .inline-input', '想写的歌');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(400);
  rows = await dbRaw(pg, 'items');
  const nb = rows.filter((x) => (x.bundles || []).includes('想写的歌')).length;
  if (nb !== 3) errs.push(`[${tag}] bundle from basket ${nb}`);
  await pg.waitForSelector('.bundle-chip:has-text("想写的歌")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] bundle chip missing`));
  await pg.click('.bundle-chip:has-text("想写的歌")');
  await pg.waitForTimeout(300);
  const shown = await pg.locator('.masonry .card').count();
  if (shown !== 3) errs.push(`[${tag}] bundle filter shows ${shown}`);
  await pg.screenshot({ path: `${out}/v028-bundle.png` });
  // 0108 从这一束里嫁接 → 嫁接页只在束里抽
  await pg.click('.bundle-graft');
  await pg.waitForSelector('.pool-pick', { timeout: 4000 }).catch(() => errs.push(`[${tag}] pool picker missing`));
  if (!(await pg.locator('.pool-chip.on:has-text("想写的歌")').count())) errs.push(`[${tag}] pool should be the bundle`);
  await pg.screenshot({ path: `${out}/v028-pool.png` });
  // 篮子一键嫁接：带着这 3 穗进嫁接页，篮子清空
  await pg.click('.basket-graft');
  await pg.waitForSelector('.graft .label:has-text("已选 (3)")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] basket graft did not preset 3`));
  if (await pg.locator('.basket').count()) errs.push(`[${tag}] basket should clear after graft`);
  // 详情：放进篮 + 穗束一行
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.waitForSelector('.card:has-text("重庆森林")');
  await pg.click('.card:has-text("重庆森林")');
  await pg.waitForSelector('.detail .kv-bundles');
  if (!(await pg.locator('.detail .bundle-go:has-text("想写的歌")').count())) errs.push(`[${tag}] detail bundle chip`);
  await pg.click('.detail-basket');
  await pg.waitForTimeout(200);
  if ((await pg.textContent('.detail-basket')) !== '在篮里 ✓') errs.push(`[${tag}] detail basket toggle`);
  const smallD = await smallTargets(pg);
  if (smallD.length) errs.push(`[${tag}] small targets in detail: ${smallD.slice(0, 5).join('; ')}`);
  await pg.screenshot({ path: `${out}/v028-detail.png` });
  await pg.click('.detail .bundle-go');
  await pg.waitForTimeout(400);
  if (!(await pg.locator('.bundle-chip.on').count())) errs.push(`[${tag}] detail bundle link should filter library`);
  // 0112 拼音 / 首字母搜索
  await pg.click('.search-toggle');
  await sqType(pg, 'wjw');
  // 拼音字表第一次打字母时才懒加载：等它到
  await pg.waitForFunction(() => Number(document.querySelector('.sq-count')?.dataset.n) > 0, null, { timeout: 3000 }).catch(() => {});
  const h1 = await sqHeads(pg);
  if (h1.items < 1 || !(await pg.locator('.search-view :text("重庆森林")').count())) errs.push(`[${tag}] pinyin initials search ${JSON.stringify(h1)}`);
  await sqType(pg, 'chongqing');
  if ((await sqHeads(pg)).items < 1) errs.push(`[${tag}] pinyin full search`);
  await pg.screenshot({ path: `${out}/v028-pinyin.png` });
  await ctx.close();

  // 0402 桌面三栏（≥1500px）
  const dctx = await b.newContext({ viewport: { width: 1680, height: 1000 } });
  const dp = await dctx.newPage();
  dp.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  await dp.goto(base);
  await dp.waitForSelector('text=穗仓还是空的');
  for (const s of ['三栏一号 #夜', '三栏二号', '三栏三号']) await quickSave(dp, s);
  await dp.click('.card:has-text("三栏二号")');
  await dp.waitForSelector('.preview-pane .detail', { timeout: 3000 }).catch(() => errs.push(`[${tag}] preview pane missing`));
  if (await dp.locator('.sheet .detail').count()) errs.push(`[${tag}] single click should not open full detail`);
  const lay = await dp.evaluate(() => ({ rail: getComputedStyle(document.querySelector('.lib-rail') || document.body).display, pane: Math.round(document.querySelector('.preview-pane')?.getBoundingClientRect().width || 0), right: Math.round(document.querySelector('.preview-pane')?.getBoundingClientRect().right || 0), w: innerWidth }));
  if (lay.pane < 360 || lay.right !== lay.w || lay.rail !== 'none') errs.push(`[${tag}] pane layout ${JSON.stringify(lay)}`);
  const t1 = await dp.textContent('.preview-pane .detail-title');
  await dp.keyboard.press('ArrowRight');
  await dp.waitForTimeout(300);
  const t2 = await dp.textContent('.preview-pane .detail-title');
  if (t1 === t2) errs.push(`[${tag}] arrow should step preview ${t1}`);
  await dp.screenshot({ path: `${out}/v028-desktop-three.png` });
  await dp.click('.card:has-text("三栏一号")', { button: 'right' });
  await dp.click('.ctx-basket');
  await dp.waitForSelector('.basket-side', { timeout: 4000 }).catch(() => errs.push(`[${tag}] basket not in sidebar`));
  await dp.dblclick('.card:has-text("三栏三号")');
  await dp.waitForSelector('.sheet .detail', { timeout: 3000 }).catch(() => errs.push(`[${tag}] dblclick should open full detail`));
  if (await dp.locator('.preview-pane').count()) errs.push(`[${tag}] pane should close when full detail opens`);
  await dp.keyboard.press('Escape');
  await dp.waitForTimeout(300);
  await dp.click('.card:has-text("三栏一号")');
  await dp.waitForSelector('.preview-pane');
  await dp.keyboard.press('Escape');
  await dp.waitForTimeout(200);
  if (await dp.locator('.preview-pane').count()) errs.push(`[${tag}] Esc should close preview`);
  await dp.screenshot({ path: `${out}/v028-desktop-basket.png` });
  await dctx.close();

  // 0404 首启：第一屏就真的拾第一穗
  const octx = await b.newContext({ viewport: { width: 390, height: 844 }, onboard: true });
  const op = await octx.newPage();
  op.on('pageerror', (e) => errs.push(`[${tag}] pageerror ${e.message}`));
  await op.goto(base);
  await op.waitForSelector('.onboard-first-input', { timeout: 5000 }).catch(() => errs.push(`[${tag}] onboarding first input missing`));
  await op.fill('.onboard-first-input', '《花样年华》 @王家卫 > 旗袍和楼梯');
  await op.waitForSelector('.onboard-first-guess:has-text("电影")', { timeout: 2000 }).catch(() => errs.push(`[${tag}] onboarding guess`));
  await op.press('.onboard-first-input', 'Enter');
  await op.waitForSelector('.onboard-first-card:has-text("第 1 穗")', { timeout: 3000 }).catch(() => errs.push(`[${tag}] onboarding first card`));
  await op.screenshot({ path: `${out}/v028-onboard-first.png` });
  if ((await op.textContent('.onboard-next')) !== '下一步') errs.push(`[${tag}] onboarding next label`);
  await op.click('.onboard-skip');
  await op.waitForSelector('.card:has-text("花样年华")', { timeout: 4000 }).catch(() => errs.push(`[${tag}] first item not in library after onboarding`));
  await octx.close();
  console.log('v028: inline syntax / share code / clean url / basket / bundles / pool / pinyin / three-pane / onboarding first ok');
}

try {
  if (process.env.E2E_ONLY === 'v028') {
    await v028();
    throw Object.assign(new Error('v028 only'), { only: true });
  }
  if (process.env.E2E_ONLY === 'ui27') {
    await ui27();
    throw Object.assign(new Error('ui27 only'), { only: true });
  }
  if (process.env.E2E_ONLY === 'graft24') {
    await graft24();
    throw Object.assign(new Error('graft24 only'), { only: true });
  }
  if (process.env.E2E_ONLY === 'inbox') {
    await inbox();
    await inboxMobile();
    throw Object.assign(new Error('inbox only'), { only: true });
  }
  if (process.env.E2E_ONLY === 'capture') {
    await capture();
    throw Object.assign(new Error('capture only'), { only: true });
  }
  if (process.env.E2E_ONLY === 'perf') {
    await perf();
    throw Object.assign(new Error('perf only'), { only: true });
  }
  if (process.env.E2E_ONLY === 'agent') {
    await agent();
    throw Object.assign(new Error('agent only'), { only: true });
  }
  if (process.env.E2E_ONLY === 'safety') {
    await safety();
    throw Object.assign(new Error('safety only'), { only: true });
  }
  if (process.env.E2E_ONLY === 'legacy') {
    await legacy();
    throw Object.assign(new Error('legacy only'), { only: true });
  }
  await security();
  await ui27();
  await v028();
  await safety();
  if (process.env.E2E_ONLY === 'security') throw Object.assign(new Error('security only'), { only: true });
  await agent();
  await onboarding();
  if (process.env.E2E_ONLY === 'onboarding') throw Object.assign(new Error('onboarding only'), { only: true });
  await obsidian();
  if (process.env.E2E_ONLY === 'obsidian') throw Object.assign(new Error('obsidian only'), { only: true });
  await datafound();
  if (process.env.E2E_ONLY === 'datafound') throw Object.assign(new Error('datafound only'), { only: true });
  await capture();
  if (process.env.E2E_ONLY === 'capture') throw Object.assign(new Error('capture only'), { only: true });
  await inbox();
  await inboxMobile();
  if (process.env.E2E_ONLY === 'inbox') throw Object.assign(new Error('inbox only'), { only: true });
  await modes();
  if (process.env.E2E_ONLY === 'modes') throw Object.assign(new Error('modes only'), { only: true });
  await wall();
  if (process.env.E2E_ONLY === 'wall') throw Object.assign(new Error('wall only'), { only: true });
  await graft24();
  if (process.env.E2E_ONLY === 'graft24') throw Object.assign(new Error('graft24 only'), { only: true });
  await legacy();
  await daily();
  if (process.env.E2E_ONLY === 'daily') throw Object.assign(new Error('daily only'), { only: true });
  // v0.5 reduced-motion：系统要求减少动效时，档位必须是 off
  const rctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const rpg = await rctx.newPage();
  await rpg.goto(base);
  await rpg.waitForSelector('.view');
  const lv = await rpg.evaluate(() => document.documentElement.dataset.motion);
  if (lv !== 'off') errs.push(`[reduced] expected motion off got ${lv}`);
  // v0.16 减少动态效果：淡入与图片放大全部关闭
  const rm = await rpg.evaluate(() => ({ anim: getComputedStyle(document.querySelector('.view > *')).animationName, tr: getComputedStyle(document.querySelector('.view > *')).transitionDuration }));
  if (rm.anim !== 'none') errs.push(`[reduced] fade-in should be off, got ${rm.anim}`);
  // v0.11 嫁接等待：减少动态效果时四步是静态文字
  await rpg.evaluate((v) => localStorage.setItem('lingan.settings.v1', v), MOCK_SETTINGS(new URL(base).origin));
  await mockAI(rpg, { delay: 2500 });
  await rpg.reload();
  await rpg.click('text=先放点示例');
  await rpg.waitForSelector('.card[data-sample="1"]');
  await rpg.click('.nav-btn:has-text("嫁接")');
  await rpg.click('.controls button:has-text("抽几穗")');
  await rpg.click('.graft-btn');
  await rpg.waitForSelector('.growing', { timeout: 3000 });
  const g1 = await rpg.evaluate(() => ({ still: document.querySelector('.growing')?.dataset.still, steps: document.querySelectorAll('.grow-steps li').length, anim: [...document.querySelectorAll('.growing, .growing *')].some((e) => getComputedStyle(e).animationName !== 'none') }));
  if (g1.still !== '1') errs.push(`[reduced] growing should be still, got ${g1.still}`);
  if (g1.steps !== 4 || g1.anim) errs.push(`[reduced] growing should be 4 static steps ${JSON.stringify(g1)}`);
  await rpg.waitForSelector('.three .idea', { timeout: 15000 });
  if ((await rpg.locator('.three .idea').count()) !== 3) errs.push('[reduced] expected 3 branches');
  await rctx.close();
  await run('desktop', { width: 1366, height: 860 });
  await run('mobile', { width: 390, height: 844 });
  await shots();
  await perf();
} catch (e) {
  if (Object.keys(PERF).length) console.log('PERF partial ' + JSON.stringify(PERF).slice(0, 600));
  if (!e.only) errs.push('FATAL ' + e.message + ' @ ' + ((e.stack || '').split('\n').find((l) => l.includes('run.mjs')) || '').trim());
}
await b.close();
if (PERF.scrollMasonryCpu4x && PERF.scrollTimeline) {
  const P = PERF;
  console.log(`PERF cold start ${P.coldStartMs.median}ms (4x CPU ${P.coldStartCpu4xMs.median}ms) · first open+migration ${P.firstOpenWithMigrationMs}ms · thumbs ${P.thumbJob.made} in ${P.thumbJob.ms}ms avg ${P.storage.avgThumbKB}KB (orig ${P.storage.avgOrigKB}KB)`);
  if (P.search) console.log(`PERF search 1000 items offline: max ${P.search.maxMs}ms median ${P.search.medianMs}ms (${P.search.runs.map((r) => `${r.q} ${r.ms}ms/${r.results}`).join(', ')}) · 4x CPU ${P.search.cpu4x.map((r) => `${r.q} ${r.ms}ms`).join(', ')} · index build ${P.searchIndex.built} rows in ${P.searchIndex.buildMs}ms, reopen load ${P.searchIndex.reopenLoadMs}ms`);
  if (P.backup) console.log(`PERF backup 1000 items/${P.backup.images} images (${P.backup.imageMB}MB) → ${(P.backup.bytes / 1048576).toFixed(1)}MB .glean in ${P.backup.ms}ms, JS heap +${P.backup.heap.deltaMB}MB (peak ${P.backup.heap.peakMB}MB) · restore ${P.restore?.ms}ms heap +${P.restore?.heap.deltaMB}MB`);
  console.log(`PERF scroll masonry ${P.scrollMasonry.avgFps}fps p95 ${P.scrollMasonry.p95Ms}ms jank ${P.scrollMasonry.jankPct}% mounted≤${P.scrollMasonry.maxMountedCards} · 4x ${P.scrollMasonryCpu4x.avgFps}fps jank ${P.scrollMasonryCpu4x.jankPct}% · timeline ${P.scrollTimeline.avgFps}fps jank ${P.scrollTimeline.jankPct}%${P.scrollList ? ` · list ${P.scrollList.avgFps}fps jank ${P.scrollList.jankPct}% mounted≤${P.scrollList.maxMountedCards}` : ''}`);
}
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ALL PASS');
