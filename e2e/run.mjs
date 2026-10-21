// e2e smoke test: node e2e/run.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || '/tmp/shots';
import fs from 'node:fs';
fs.mkdirSync(out, { recursive: true });
const errs = [];
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
async function run(name, viewport) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`[${name}] pageerror ${e.message}`));
  pg.on('console', (m) => m.type() === 'error' && errs.push(`[${name}] console ${m.text()}`));
  pg.on('dialog', (d) => d.accept());
  await pg.goto(base);
  await pg.waitForSelector('text=暗房还是空的');
  await pg.screenshot({ path: `${out}/${name}-0-empty.png`, fullPage: true });
  // capture one manually
  await pg.click('text=收集第一件');
  await pg.fill('.capture .field.big input', '重庆森林');
  await pg.click('.capture .chip:has-text("电影")');
  await pg.fill('.capture input[maxlength="80"]', '王家卫');
  await pg.fill('.capture .field.why input', '凤梨罐头的过期日期像一份情书');
  await pg.fill('.capture input[placeholder="雨 克制 慢镜头"]', '香港 罐头 霓虹');
  await pg.click('text=收进暗房');
  await pg.waitForSelector('.card:has-text("重庆森林")');
  // validation: empty save
  await pg.click(viewport.width < 760 ? '.nav-add' : '.fab');
  await pg.click('text=收进暗房');
  await pg.waitForSelector('.error');
  await pg.click('.capture button:has-text("取消")');
  // samples via settings import? use samples button not visible now; add via db through UI: delete flow test later
  await pg.evaluate(async () => {});
  // load samples: wipe then samples
  await pg.click('.nav-btn:has-text("设置")');
  await pg.click('button:has-text("清空")');
  await pg.click('.nav-btn:has-text("灵感库")');
  await pg.click('text=先放点示例');
  await pg.waitForSelector('.card:has-text("花样年华")');
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${out}/${name}-1-library.png`, fullPage: true });
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
  await pg.screenshot({ path: `${out}/${name}-2-detail.png` });
  await pg.click('text=以此显影');
  await pg.waitForSelector('.darkroom');
  await pg.click('.develop-btn');
  await pg.waitForSelector('.idea', { timeout: 10000 });
  await pg.waitForTimeout(1300);
  await pg.screenshot({ path: `${out}/${name}-3-develop.png`, fullPage: true });
  await pg.click('.idea button:has-text("收藏")');
  await pg.click('text=重新抽底片');
  await pg.click('.seg button:has-text("3")');
  await pg.click('text=重新抽底片');
  const negs = await pg.locator('.darkroom .negative').count();
  if (negs !== 3) errs.push(`[${name}] expected 3 negatives got ${negs}`);
  await pg.click('.develop-btn');
  await pg.waitForTimeout(1500);
  const hist = await pg.locator('.hrow').count();
  if (hist !== 2) errs.push(`[${name}] expected 2 history got ${hist}`);
  // taste
  await pg.click('.nav-btn:has-text("画像")');
  await pg.waitForSelector('.stat-n');
  await pg.screenshot({ path: `${out}/${name}-4-taste.png`, fullPage: true });
  // settings + theme
  await pg.click('.nav-btn:has-text("设置")');
  await pg.click('text=暗房（深）');
  await pg.screenshot({ path: `${out}/${name}-5-settings-dark.png`, fullPage: true });
  await pg.click('.nav-btn:has-text("灵感库")');
  await pg.screenshot({ path: `${out}/${name}-6-library-dark.png`, fullPage: true });
  // edit + delete
  await pg.click('.card:has-text("Avril 14th")');
  await pg.click('.detail button:has-text("编辑")');
  await pg.fill('.capture .field.big input', 'Avril 14th (edited)');
  await pg.click('text=收进暗房');
  await pg.waitForSelector('.card:has-text("(edited)")');
  await pg.click('.card:has-text("(edited)")');
  await pg.click('.detail button:has-text("删除")');
  await pg.waitForTimeout(300);
  if (await pg.locator('.card:has-text("(edited)")').count()) errs.push(`[${name}] delete failed`);
  // reload persistence
  await pg.reload();
  await pg.waitForSelector('.card:has-text("花样年华")');
  const th = await pg.evaluate(() => document.documentElement.dataset.theme);
  if (th !== 'darkroom') errs.push(`[${name}] theme not persisted`);
  await ctx.close();
}
try {
  await run('desktop', { width: 1366, height: 860 });
  await run('mobile', { width: 390, height: 844 });
} catch (e) {
  errs.push('FATAL ' + e.message);
}
await b.close();
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ALL PASS');
