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
async function run(name, viewport) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${name}] pageerror ${e.message}`));
  pg.on('console', (m) => m.type() === 'error' && errs.push(`[${name}] console ${m.text()}`));
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
  await pg.waitForSelector('.card:has-text("花样年华")');
  await pg.waitForTimeout(400);
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
  // search + filter
  await pg.fill('.search input', '钢琴');
  await pg.waitForTimeout(200);
  const n = await pg.locator('.masonry .card').count();
  if (n !== 1) errs.push(`[${name}] search expected 1 got ${n}`);
  await pg.fill('.search input', '');
  await pg.click('.chips.scroll .chip:has-text("音乐")');
  const m = await pg.locator('.masonry .card').count();
  if (m !== 3) errs.push(`[${name}] filter music expected 3 got ${m}`);
  await pg.click('.chips.scroll .chip:has-text("全部")');
  // detail
  await pg.click('.card:has-text("花样年华")');
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
  await pg.click('.idea button:has-text("收藏")');
  await pg.click('text=重新抽穗');
  await pg.click('.seg button:has-text("3")');
  await pg.click('text=重新抽穗');
  const negs = await pg.locator('.graft .pair-item').count();
  if (negs !== 3) errs.push(`[${name}] expected 3 picked got ${negs}`);
  await pg.click('.graft-btn');
  await pg.waitForSelector('.after-note');
  await brand(pg, name);
  // v0.10 新枝页
  await pg.click('.nav-btn:has-text("新枝")');
  await pg.waitForSelector('.hrow');
  await brand(pg, name);
  const hist = await pg.locator('.hrow').count();
  if (hist !== 2) errs.push(`[${name}] expected 2 history got ${hist}`);
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
  const sky = await pg.evaluate(() => [document.documentElement.dataset.phase, document.documentElement.dataset.sky]);
  if (sky[0] !== 'night' || sky[1] !== 'dark') errs.push(`[${name}] night phase not applied: ${sky}`);
  await pg.screenshot({ path: `${out}/${name}-5-settings-dark.png`, fullPage: true });
  await pg.click('.nav-btn:has-text("穗仓")');
  await pg.screenshot({ path: `${out}/${name}-6-library-dark.png`, fullPage: true });
  const w2 = await pg.locator('.card:has-text("花样年华") .card-when').innerText();
  if (w2 !== '2025/10/19') errs.push(`[${name}] edited time expected 2025/10/19 got ${w2}`);
  // edit + delete
  await pg.click('.card:has-text("Avril 14th")');
  await pg.click('.detail button:has-text("编辑")');
  await pg.fill('.capture .field.big input', 'Avril 14th (edited)');
  await pg.click('.capture button[type=submit]');
  await pg.waitForSelector('.card:has-text("(edited)")');
  await pg.click('.card:has-text("(edited)")');
  await pg.click('.detail button:has-text("删除")');
  await pg.waitForTimeout(300);
  if (await pg.locator('.card:has-text("(edited)")').count()) errs.push(`[${name}] delete failed`);
  // reload persistence
  await pg.reload();
  await pg.waitForSelector('.card:has-text("花样年华")');
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
  await pg.waitForSelector('.ascii-canvas', { timeout: 3000 });
  await pg.waitForTimeout(450);
  await pg.screenshot({ path: `${out}/${name}-7-ascii-mid.png` });
  await pg.waitForFunction(() => !document.querySelector('.ascii-canvas') && document.querySelector('.ascii-wrap.ascii-done'), null, { timeout: 5000 });
  const iw = await pg.locator('.card:has-text("渐变测试图") img.card-img').evaluate((i) => i.naturalWidth);
  if (iw < 10) errs.push(`[${name}] ascii image not loaded`);
  await ctx.close();
}
// 发版截图：手机 390×844 @2x，白天配色（穗仓首页 / 图片显影中 / 嫁接结果 / 口味）
async function shots() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[shots] pageerror ${e.message}`));
  await pg.addInitScript(() => { if (!localStorage.getItem('lingan.settings.v1')) localStorage.setItem('lingan.settings.v1', JSON.stringify({ phase: 'day' })); });
  await pg.goto(base);
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card:has-text("花样年华")');
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
  await pg.click('.nav-btn:has-text("嫁接")');
  await pg.click('text=嫁接今日两穗');
  await pg.waitForSelector('.idea');
  await pg.waitForFunction(() => !document.querySelector('.idea .tw-rest'), null, { timeout: 9000 }).catch(() => {});
  await pg.waitForTimeout(400);
  await pg.evaluate(() => { const el = document.querySelector('.graft'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 10); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${out}/shot-graft.png` });
  await pg.click('.nav-btn:has-text("口味")');
  await pg.waitForSelector('.heat-grid');
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: `${out}/shot-taste.png` });
  await ctx.close();
}

try {
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
  await rctx.close();
  await run('desktop', { width: 1366, height: 860 });
  await run('mobile', { width: 390, height: 844 });
  await shots();
} catch (e) {
  errs.push('FATAL ' + e.message);
}
await b.close();
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ALL PASS');
