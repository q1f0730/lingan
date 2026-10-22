// e2e smoke test: node e2e/run.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || '/tmp/shots';
import fs from 'node:fs';
fs.mkdirSync(out, { recursive: true });
const errs = [];
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
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
  // v0.10 活的麦田：canvas 在、在动、指针划过会重画
  const f0 = await pg.evaluate(() => ({ ...window.__gleanField, mode: document.querySelector('.field-canvas')?.dataset.mode, phase: document.documentElement.dataset.phase }));
  if (!f0.cols || !f0.rows) errs.push(`[${name}] field not mounted ${JSON.stringify(f0)}`);
  if (!['dawn', 'day', 'dusk', 'night'].includes(f0.phase)) errs.push(`[${name}] phase missing ${f0.phase}`);
  if (f0.mode !== 'live') errs.push(`[${name}] field should be live, got ${f0.mode}`);
  await pg.mouse.move(viewport.width * 0.2, viewport.height * 0.85);
  await pg.mouse.move(viewport.width * 0.8, viewport.height * 0.86, { steps: 8 });
  await pg.waitForTimeout(400);
  const f1 = await pg.evaluate(() => ({ ...window.__gleanField }));
  if (!(f1.frames > f0.frames)) errs.push(`[${name}] field not animating ${f0.frames}->${f1.frames}`);
  // 字体自托管：不从任何外部域名拉字体
  const ext = await pg.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /\.(woff2?|ttf|otf)/.test(u) && !u.startsWith(location.origin)));
  if (ext.length) errs.push(`[${name}] external fonts ${ext.join(',')}`);
  const fontsOk = await pg.evaluate(async () => {
    await Promise.all([document.fonts.load('900 40px "Glean Display"', '穗仓'), document.fonts.load('16px "Glean Serif"', '穗'), document.fonts.load('italic 20px "Glean Latin"', 'Glean'), document.fonts.load('800 13px "Glean Mono"', '|')]);
    return ['900 40px "Glean Display"', '16px "Glean Serif"', 'italic 20px "Glean Latin"', '800 13px "Glean Mono"'].map((f) => [f, document.fonts.check(f, f.includes('Latin') || f.includes('Mono') ? 'G' : '穗')]);
  });
  for (const [f, ok] of fontsOk) if (!ok) errs.push(`[${name}] font not loaded: ${f}`);
  if (!(await pg.locator('.ascii-empty').count())) errs.push(`[${name}] ascii empty state missing`);
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
  await pg.click(viewport.width < 760 ? '.nav-add' : '.nav-write');
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.error');
  await pg.click('.capture button:has-text("取消")');
  // samples via settings import? use samples button not visible now; add via db through UI: delete flow test later
  await pg.evaluate(async () => {});
  // load samples: wipe then samples
  await pg.click('.nav-btn:has-text("设置")');
  await pg.click('button:has-text("清空")');
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
  await pg.waitForSelector('.card:has-text("速记测试一句")');
  const when = await pg.locator('.card:has-text("速记测试一句") .card-when').innerText();
  if (!when.startsWith('今天')) errs.push(`[${name}] card time expected 今天 got ${when}`);
  if (!(await pg.locator('.card:has-text("速记测试一句") .tag:has-text("速记")').count())) errs.push(`[${name}] quick tag missing`);
  await pg.fill('.quick-why', '因为很安静 #夜');
  await pg.press('.quick-why', 'Enter');
  await pg.waitForSelector('.card:has-text("因为很安静")');
  if (await pg.locator('.quick-after').count()) errs.push(`[${name}] quick-after should close`);
  // clipboard offer
  const clipText = `剪贴板里的一句话 ${name}`;
  await pg.evaluate((t) => navigator.clipboard.writeText(t), clipText);
  await pg.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pg.waitForSelector('.clip-offer', { timeout: 5000 });
  await pg.screenshot({ path: `${out}/${name}-1b-clip.png` });
  await pg.click('.clip-offer button:has-text("拾进穗仓")');
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
  // search + filter（关键词与期望数量来自这次实际抽到的示例）
  const all = await dbItems(pg);
  const kw = A.title;
  const expN = all.filter((x) => [x.title, x.creator, x.content, x.tags.join(' ')].join(' ').toLowerCase().includes(kw.toLowerCase())).length;
  await pg.fill('.search input', kw);
  await pg.waitForTimeout(200);
  const n = await pg.locator('.masonry .card').count();
  if (n < 1 || n > expN + 1 || !(await pg.locator(`.masonry ${cardSel(A.id)}`).count())) errs.push(`[${name}] search ${kw} expected ~${expN} incl. #${A.id} got ${n}`);
  await pg.fill('.search input', '');
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
  await pg.click('text=以此嫁接');
  await pg.waitForSelector('.graft');
  await pg.click('.graft-btn');
  if (!(await pg.locator('.seed-burst').count())) errs.push(`[${name}] seed burst missing`);
  await pg.waitForSelector('.idea', { timeout: 10000 });
  await pg.waitForTimeout(1300);
  await pg.screenshot({ path: `${out}/${name}-3-develop.png`, fullPage: true });
  await pg.waitForFunction(() => !document.querySelector('.idea .tw-rest'), null, { timeout: 9000 }).catch(() => {});
  await pg.evaluate(() => { const el = document.querySelector('.graft'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${out}/${name}-shot-graft.png` });
  // v0.5 动效：标题解码、正文逐字浮现，最终都应还原为完整文字
  const mv = await pg.evaluate(() => document.documentElement.dataset.motion);
  if (!['full', 'lite', 'off'].includes(mv)) errs.push(`[${name}] data-motion missing: ${mv}`);
  await pg.waitForFunction(() => !document.querySelector('.idea .tw-rest'), null, { timeout: 8000 }).catch(() => errs.push(`[${name}] type reveal never finished`));
  const dec = await pg.evaluate(() => {
    const el = document.querySelector('.idea-title .decode');
    return el ? { label: el.getAttribute('aria-label'), text: el.textContent } : null;
  });
  if (!dec) errs.push(`[${name}] decode title missing`);
  else if (dec.label !== dec.text) errs.push(`[${name}] decode title not settled: ${dec.text} vs ${dec.label}`);
  // 涟漪：按下按钮后应出现 .ripple（off 档除外）
  if (mv !== 'off') {
    const rp = await pg.evaluate(async () => {
      const btn = document.querySelector('.idea button.btn');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      return !!btn.querySelector('.ripple');
    });
    if (!rp) errs.push(`[${name}] ripple missing`);
  }
  // v0.12 从一穗出发也会凑够 3 穗；离线新枝同样能点回 ≥3 穗
  const offPicked = await pg.locator('.graft .pair-item').count();
  if (offPicked !== 3) errs.push(`[${name}] graft from one item should pick 3, got ${offPicked}`);
  await pg.waitForSelector('.three .idea .sprig', { timeout: 5000 }).catch(() => errs.push(`[${name}] offline sprigs missing`));
  const offSpr = await pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => ({ n: e.querySelectorAll('.sprig').length, ev: e.dataset.evidence })));
  if (offSpr.some((x) => x.n < 3 || x.ev !== 'ok')) errs.push(`[${name}] offline provenance wrong ${JSON.stringify(offSpr)}`);
  await pg.click('.idea button:has-text("收藏")');
  await pg.click('text=重新抽穗');
  await pg.click('.seg button:has-text("4")');
  await pg.click('text=重新抽穗');
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
  // v0.12 溯源：每根 AI 新枝都能点回 ≥3 件自己的穗，且都在这次嫁接的素材里
  const picked = await pg.evaluate(() => [...document.querySelectorAll('.graft .pair-item .card-title')].map((e) => e.textContent));
  const prov = await pg.evaluate(() => [...document.querySelectorAll('.three .idea')].map((e) => ({ ev: e.dataset.evidence, ids: [...e.querySelectorAll('.sprig[data-item-id]')].map((x) => Number(x.dataset.itemId)), titles: [...e.querySelectorAll('.sprig .sprig-title')].map((x) => x.textContent), weak: !!e.querySelector('.sprigs-weak') })));
  for (const [i, p] of prov.entries()) {
    if (p.ev !== 'ok' || p.weak) errs.push(`[${name}] AI branch ${i} evidence ${p.ev}`);
    if (new Set(p.ids).size < 3) errs.push(`[${name}] AI branch ${i} points back to ${p.ids.length} ears`);
    if (p.ids.some((x) => !ai.ids.includes(x))) errs.push(`[${name}] AI branch ${i} sprig not from this graft ${p.ids} vs ${ai.ids}`);
    // 摘抄类穗的卡片标题显示的是原文（「…」），小穗卡显示出处，没法按字面对上，这类只靠上面的 ID 校验
    if (!picked.some((q) => (q || '').startsWith('「')) && p.titles.some((t) => !picked.some((q) => (q || '').includes(t) || t.includes((q || '').replace(/^「|」$/g, ''))))) errs.push(`[${name}] sprig titles ${p.titles} not among picked ${picked}`);
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
  await pg.click('text=重新抽穗');
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
  await pg.waitForSelector('.toast:has-text("三根都收藏了")', { timeout: 3000 }).catch(() => errs.push(`[${name}] star-all toast missing`));
  await pg.click('.chip:has-text("只看收藏")');
  const starredRows = await pg.locator('.hrow').count();
  if (starredRows !== 4) errs.push(`[${name}] starred rows expected 4 (1+3) got ${starredRows}`);
  await pg.click('.chip:has-text("只看收藏")');
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
  // v0.7 时间线
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.click('.chip:has-text("时间线")');
  await pg.waitForSelector('.tl-day .tl-frame');
  await pg.screenshot({ path: `${out}/${name}-4b-timeline.png`, fullPage: true });
  await pg.click('.chip:has-text("时间线")');
  await pg.click('.nav-btn:has-text("口味")');
  // settings + theme
  await pg.click('.nav-btn:has-text("设置")');
  await brand(pg, name);
  await pg.click('.phase-seg button:has-text("夜晚")');
  // 换配色要经过 设置 → usePhase 的 effect → 写 dataset 两拍渲染，等它落定再读（之前是立即读，偶发读到旧值）
  await pg.waitForFunction(() => document.documentElement.dataset.phase === 'night', null, { timeout: 3000 }).catch(() => {});
  const sky = await pg.evaluate(() => [document.documentElement.dataset.phase, document.documentElement.dataset.sky]);
  if (sky[0] !== 'night' || sky[1] !== 'dark') errs.push(`[${name}] night phase not applied: ${sky}`);
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
  await pg.click('.card:has-text("(edited)")');
  await pg.click('.detail button:has-text("删除")');
  await pg.waitForTimeout(300);
  if (await pg.locator('.card:has-text("(edited)")').count()) errs.push(`[${name}] delete failed`);
  // reload persistence
  await pg.reload();
  await pg.waitForSelector(cardSel(A.id));
  const th = await pg.evaluate(() => document.documentElement.dataset.phase);
  if (th !== 'night') errs.push(`[${name}] phase not persisted: ${th}`);
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
  await pg.waitForSelector('.ascii-canvas', { timeout: 3000 });
  await pg.waitForTimeout(450);
  await pg.screenshot({ path: `${out}/${name}-7-ascii-mid.png` });
  await pg.waitForFunction(() => !document.querySelector('.ascii-canvas') && document.querySelector('.ascii-wrap.ascii-done'), null, { timeout: 5000 });
  const iw = await pg.locator('.card:has-text("渐变测试图") img.card-img').evaluate((i) => i.naturalWidth);
  if (iw < 10) errs.push(`[${name}] ascii image not loaded`);
  await ctx.close();
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
  await pg.waitForSelector('.card:has-text("傍晚的麦田")');
  await pg.waitForSelector('.ascii-canvas', { timeout: 4000 }).catch(() => {});
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: `${out}/shot-library-developing.png` });
  await pg.waitForFunction(() => !document.querySelector('.ascii-canvas'), null, { timeout: 6000 }).catch(() => {});
  await pg.mouse.move(40, 760);
  await pg.mouse.move(360, 770, { steps: 10 });
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: `${out}/shot-library.png` });
  await noOverlap(pg, 'shots');
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
  await pg.click('.nav-add');
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
  if (ver !== 40) errs.push(`[legacy] db version expected 40 (Dexie v4) got ${ver}`);
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
        maxMounted = Math.max(maxMounted, document.querySelectorAll('.card').length);
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
    return { ready: Math.round(window.__gleanReady), dcl: Math.round(nav?.domContentLoadedEventEnd || 0), cards: document.querySelectorAll('.masonry .card').length, count: document.querySelector('.dateline')?.textContent?.match(/共 (\d+) 穗/)?.[1] };
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
  if (integ.version !== 40) errs.push(`[perf] db version (expected 40 = Dexie v4) ${integ.version}`);
  if (integ.items !== 1000 || integ.images !== 300 || integ.hasImage !== 300) errs.push(`[perf] data lost in migration ${JSON.stringify(integ)}`);
  if (integ.inline !== 0) errs.push(`[perf] ${integ.inline} rows still carry inline originals`);
  if (integ.withThumb !== 300) errs.push(`[perf] thumbnails ${integ.withThumb}/300`);
  if (integ.avgThumbKB > 30) errs.push(`[perf] thumbnails too big: avg ${integ.avgThumbKB}KB`);
  await pg.close();
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
  await sp.click('.chip:has-text("时间线")');
  await sp.waitForSelector('.tl-day .tl-frame');
  await sp.waitForTimeout(800);
  PERF.scrollTimeline = await measureScroll(sp, 2400, 6000);
  PERF.scrollTimeline.virtual = await sp.evaluate(() => window.__gleanVirtual?.timeline);
  // 4 倍降速下再滚一次瀑布
  await sp.click('.chip:has-text("时间线")');
  await sp.waitForTimeout(600);
  const cdp = await ctx.newCDPSession(sp);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  PERF.scrollMasonryCpu4x = await measureScroll(sp, 1600, 5000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  for (const [k, r] of [['masonry', PERF.scrollMasonry], ['timeline', PERF.scrollTimeline]]) {
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
  await obsidian();
  if (process.env.E2E_ONLY === 'obsidian') throw Object.assign(new Error('obsidian only'), { only: true });
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
  const st = await rpg.evaluate(() => ({ mode: document.querySelector('.field-canvas')?.dataset.mode, frames: window.__gleanField?.frames }));
  await rpg.mouse.move(50, 700);
  await rpg.mouse.move(300, 720, { steps: 6 });
  await rpg.waitForTimeout(800);
  const st2 = await rpg.evaluate(() => window.__gleanField?.frames);
  if (st.mode !== 'still') errs.push(`[reduced] field should be still, got ${st.mode}`);
  if (st2 !== st.frames) errs.push(`[reduced] still field kept drawing ${st.frames}->${st2}`);
  // v0.11 嫁接等待：减少动态效果时麦子是静图
  await rpg.evaluate((v) => localStorage.setItem('lingan.settings.v1', v), MOCK_SETTINGS(new URL(base).origin));
  await mockAI(rpg, { delay: 2500 });
  await rpg.reload();
  await rpg.click('text=先放点示例');
  await rpg.waitForSelector('.card[data-sample="1"]');
  await rpg.click('.nav-btn:has-text("嫁接")');
  await rpg.click('.controls button:has-text("抽几穗")');
  await rpg.click('.graft-btn');
  await rpg.waitForSelector('.growing', { timeout: 3000 });
  const g1 = await rpg.evaluate(() => ({ still: document.querySelector('.growing')?.dataset.still, txt: document.querySelector('.grow-wheat')?.textContent }));
  await rpg.waitForTimeout(700);
  const g2 = await rpg.evaluate(() => document.querySelector('.grow-wheat')?.textContent);
  if (g1.still !== '1') errs.push(`[reduced] growing should be still, got ${g1.still}`);
  if (g1.txt !== g2) errs.push('[reduced] growing wheat animated');
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
  console.log(`PERF scroll masonry ${P.scrollMasonry.avgFps}fps p95 ${P.scrollMasonry.p95Ms}ms jank ${P.scrollMasonry.jankPct}% mounted≤${P.scrollMasonry.maxMountedCards} · 4x ${P.scrollMasonryCpu4x.avgFps}fps jank ${P.scrollMasonryCpu4x.jankPct}% · timeline ${P.scrollTimeline.avgFps}fps jank ${P.scrollTimeline.jankPct}%`);
}
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ALL PASS');
