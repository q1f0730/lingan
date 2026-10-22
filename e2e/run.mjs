// e2e smoke test: node e2e/run.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || '/tmp/shots';
import fs from 'node:fs';
fs.mkdirSync(out, { recursive: true });
const errs = [];
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
// v0.16 引导只在第一次打开时出现：其余用例都当作「走过引导」的老用户（onboard: true 的上下文才看引导）
const _newContext = b.newContext.bind(b);
b.newContext = async (opts = {}) => {
  const { onboard, ...o } = opts;
  const c = await _newContext(o);
  if (!onboard) await c.addInitScript(() => { try { localStorage.setItem('glean.onboarded', '1'); } catch { /* svg doc */ } });
  return c;
};
// v0.16 Studio：旧的暖纸 / 麦田 / ASCII / 衬线 一律不该再出现；无圆角、无阴影
async function studio(pg, tag) {
  const r = await pg.evaluate(() => {
    const out = { canvas: document.querySelectorAll('canvas').length, svgInView: document.querySelectorAll('.app svg, .view svg').length, old: [], theme: document.documentElement.dataset.theme };
    for (const sel of ['.field-canvas', '.wheatfield', '.ascii-wrap', '.paper', '.whisper', '.grow-wheat', '.seed-burst', '.ripple']) if (document.querySelector(sel)) out.old.push(sel);
    const bad = [];
    for (const el of document.querySelectorAll('.btn, .card, .chip, .sheet, .confirm, .toast, input, .sprig, .trow')) {
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderTopLeftRadius) > 0 || (cs.boxShadow && cs.boxShadow !== 'none')) bad.push(el.className);
    }
    out.round = bad.slice(0, 3);
    const ff = getComputedStyle(document.body).fontFamily;
    out.font = /Glean Inter/.test(ff) && /Glean Sans/.test(ff) && !/Serif|Cormorant|Mono/.test(ff);
    return out;
  });
  if (r.canvas) errs.push(`[${tag}] canvas still on page (${r.canvas})`);
  if (r.svgInView) errs.push(`[${tag}] decorative svg icons in view (${r.svgInView})`);
  if (r.old.length) errs.push(`[${tag}] old-style elements: ${r.old.join(',')}`);
  if (r.round.length) errs.push(`[${tag}] rounded corners / shadows on ${r.round.join(' | ')}`);
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
async function mockAI(pg, { fail429 = 0, delay = 500, evidence = 'ok' } = {}) {
  const log = { calls: 0, phases: [] };
  let left = fail429;
  let cCalls = 0;
  await pg.route('**/mock-ai/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const sys = String(body.messages?.[0]?.content || '');
    log.calls++;
    if (left-- > 0) return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'retry-after': '1' }, body: JSON.stringify({ error: { message: 'rate limited' } }) });
    await new Promise((r) => setTimeout(r, delay));
    const a = sys.includes('PHASE A');
    log.phases.push(a ? 'A' : sys.includes('PHASE C') ? 'C' : '?');
    const user = String(body.messages?.[1]?.content || '');
    const found = [...user.matchAll(/\[#(\d+) \|[^\]]*\] ([^\n]+)/g)];
    const ids = [...new Set(found.map((m) => Number(m[1])))];
    const titles = found.map((m) => m[2].trim());
    log.ids = ids;
    const mm = user.match(/这次的接法：([^（\n]+)（/);
    (log.modes ||= []).push(mm ? mm[1] : '');
    if (!a) cCalls++;
    if (!a && sys.includes('上一次的回答里')) log.recheckPrompt = true;
    const cMode = a ? 'ok' : evidence === 'recheck' && cCalls === 1 ? 'noid' : evidence === 'weak' ? (cCalls === 1 ? 'noid' : 'weak') : 'ok';
    const payload = withIds(a ? MOCK_MAP : MOCK_CONV, ids, titles, cMode);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(payload) + '\n```' } }] }) });
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
      q.onsuccess = () => { r.result.close(); res(q.result.map((x) => ({ id: x.id, type: x.type, title: x.title, content: x.content || '', creator: x.creator || '', tags: x.tags, sample: x.sample || 0, createdAt: x.createdAt }))); };
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
      q.onsuccess = () => { r.result.close(); res(q.result.map((x) => ({ id: x.id, title: x.title, why: x.why || '', tags: x.tags }))); };
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
async function dbRaw(pg, store) {
  return pg.evaluate((store) => new Promise((res, rej) => {
    const r = indexedDB.open('lingan');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); return res([]); }
      const q = db.transaction(store).objectStore(store).getAll();
      q.onsuccess = () => { db.close(); res(q.result.map((x) => { const { thumb, image, ...rest } = x; void thumb; void image; return rest; })); };
      q.onerror = () => rej(q.error);
    };
  }), store);
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
  // v0.16 布局：桌面 ≥1024 顶栏导航 + 顶栏右侧速记、没有底部固定栏；手机底部 速记 + 文字导航
  const lay = await pg.evaluate(() => ({ topNav: !!document.querySelector('.topbar .nav'), topQuick: !!document.querySelector('.topbar .quick-input'), dock: !!document.querySelector('.dock'), dockNav: document.querySelectorAll('.dock .nav-btn').length, navIcons: document.querySelectorAll('.nav svg, .nav img').length }));
  if (viewport.width >= 1024 ? !(lay.topNav && lay.topQuick && !lay.dock) : !(lay.dock && lay.dockNav === 5 && !lay.topNav)) errs.push(`[${name}] layout wrong ${JSON.stringify(lay)}`);
  if (lay.navIcons) errs.push(`[${name}] nav should be text only`);
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
  await pg.waitForSelector('.confirm:has-text("再确认一次")');
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
  if (!['rgb(0, 0, 0)', 'rgb(255, 255, 255)'].includes(markBg)) errs.push(`[${name}] hit should be reversed black/white, got ${markBg}`);
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
  if (mf.bg !== 'rgb(0, 0, 0)' || mf.fg !== 'rgb(255, 255, 255)' || !mf.text || mf.pages < 1) errs.push(`[${name}] manifesto wrong ${JSON.stringify(mf)}`);
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
  if (sky[0] !== 'dark' || sky[1] !== 'rgb(0, 0, 0)') errs.push(`[${name}] dark theme not applied: ${sky}`);
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
      if ((await pg.locator('.radio-list .radio').count()) !== 4) errs.push(`[${tag}] expected 4 AI services`);
      await pg.click('.radio-list .radio:has-text("智谱")');
      await pg.fill('.radio-item input', 'e2e-onboard-key');
      await pg.screenshot({ path: `${out}/${tag}-3.png` });
      await pg.click('.onboard-done');
      await pg.waitForSelector('text=穗仓还是空的');
      const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('lingan.settings.v1') || '{}'));
      if (st.preset !== 'zhipu' || st.chat?.apiKey !== 'e2e-onboard-key') errs.push(`[${tag}] onboarding AI choice not saved ${st.preset}`);
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
    const gid = fm.match(/^glean_id: (\d+)$/m);
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

async function legacy() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
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
      dvs.add({ itemIds: [1, 2], jump: 0.5, idea: { title: '早先的一根', bridge: '旧桥', idea: '旧片子和旧歌接在一起', cliches: [] }, source: 'ai', createdAt: now - 8e7 });
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
  if (ver !== 60) errs.push(`[legacy] db version expected 60 (Dexie v6) got ${ver}`);
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
        ...(img ? { image: variants[i % 12] } : {}),
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
    if (!r.marks || r.markText !== q || !['rgb(0, 0, 0)', 'rgb(255, 255, 255)'].includes(r.markBg)) errs.push(`[perf-search] ${q}: highlight wrong ${JSON.stringify(r)}`);
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
  pg.on('console', (m) => m.type() === 'error' && errs.push(`[perf] console ${m.text()}`));
  const seed = await seedLegacy1000(pg);
  PERF.seed = { items: 1000, images: 300, ...seed };
  // 第一次打开：Dexie v2 → v3 迁移（原图搬进 images 表）+ 首屏
  const t0 = Date.now();
  await pg.goto(base);
  await pg.waitForFunction(() => window.__gleanReady && document.querySelectorAll('.masonry .card').length > 0, null, { timeout: 60000 });
  PERF.firstOpenWithMigrationMs = await pg.evaluate(() => Math.round(window.__gleanReady));
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
  if (integ.version !== 60) errs.push(`[perf] db version (expected 60 = Dexie v6) ${integ.version}`);
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
  await ctx.close();
  fs.writeFileSync(`${out}/perf.json`, JSON.stringify(PERF, null, 2));
}

try {
  if (process.env.E2E_ONLY === 'perf') {
    await perf();
    throw Object.assign(new Error('perf only'), { only: true });
  }
  await onboarding();
  if (process.env.E2E_ONLY === 'onboarding') throw Object.assign(new Error('onboarding only'), { only: true });
  await obsidian();
  if (process.env.E2E_ONLY === 'obsidian') throw Object.assign(new Error('obsidian only'), { only: true });
  await modes();
  if (process.env.E2E_ONLY === 'modes') throw Object.assign(new Error('modes only'), { only: true });
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
  if (!e.only) errs.push('FATAL ' + e.message);
}
await b.close();
if (PERF.scrollMasonryCpu4x && PERF.scrollTimeline) {
  const P = PERF;
  console.log(`PERF cold start ${P.coldStartMs.median}ms (4x CPU ${P.coldStartCpu4xMs.median}ms) · first open+migration ${P.firstOpenWithMigrationMs}ms · thumbs ${P.thumbJob.made} in ${P.thumbJob.ms}ms avg ${P.storage.avgThumbKB}KB (orig ${P.storage.avgOrigKB}KB)`);
  if (P.search) console.log(`PERF search 1000 items offline: max ${P.search.maxMs}ms median ${P.search.medianMs}ms (${P.search.runs.map((r) => `${r.q} ${r.ms}ms/${r.results}`).join(', ')}) · 4x CPU ${P.search.cpu4x.map((r) => `${r.q} ${r.ms}ms`).join(', ')} · index build ${P.searchIndex.built} rows in ${P.searchIndex.buildMs}ms, reopen load ${P.searchIndex.reopenLoadMs}ms`);
  console.log(`PERF scroll masonry ${P.scrollMasonry.avgFps}fps p95 ${P.scrollMasonry.p95Ms}ms jank ${P.scrollMasonry.jankPct}% mounted≤${P.scrollMasonry.maxMountedCards} · 4x ${P.scrollMasonryCpu4x.avgFps}fps jank ${P.scrollMasonryCpu4x.jankPct}% · timeline ${P.scrollTimeline.avgFps}fps jank ${P.scrollTimeline.jankPct}%${P.scrollList ? ` · list ${P.scrollList.avgFps}fps jank ${P.scrollList.jankPct}% mounted≤${P.scrollList.maxMountedCards}` : ''}`);
}
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ALL PASS');
