// v0.37 0703 / 0715 大库压力夹具与基准：1 万穗（3000 张图）和 5 万穗（纯文字）。
// 用法：node e2e/stress.mjs <输出 json> <轮数> 名字=dist目录 [名字=dist目录 …]
//   例：node e2e/stress.mjs /tmp/stress.json 5 v036=/tmp/lg/dist36 v037=/tmp/lg/dist
// 环境：STRESS_SIZES=10000,50000（默认两档都测）、E2E_CHROMIUM（默认 /usr/bin/chromium）
// 多个版本挂在同一个源（同一个端口，按请求头 x-glean-v 选 dist 目录），所以共用同一个 IndexedDB：种一次数据，各版本同会话交替测冷启动。
// 量：冷启动（普通 + 4× 降速，painted = 带卡片那一帧真正画完，口径同 bench5）、滚动帧率、秒搜耗时、导出 .glean 的耗时与堆增长（只测最后一个版本）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const outFile = process.argv[2] || '/tmp/stress.json';
const ROUNDS = +(process.argv[3] || 5);
const DISTS = Object.fromEntries(process.argv.slice(4).map((a) => a.split(/=(.*)/s).slice(0, 2)));
const KEYS = Object.keys(DISTS);
if (!KEYS.length) throw new Error('至少给一个 名字=dist目录');
const SIZES = (process.env.STRESS_SIZES || '10000,50000').split(',').map(Number);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const srv = http
  .createServer((req, res) => {
    const root = DISTS[req.headers['x-glean-v']] || DISTS[KEYS[KEYS.length - 1]];
    let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': T[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(p).pipe(res);
  })
  .listen(0);
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const b = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const errs = [];
const OUT = { date: new Date().toISOString(), rounds: ROUNDS, versions: KEYS, sizes: {} };

async function page(ctx, v) {
  const pg = await ctx.newPage();
  await pg.setExtraHTTPHeaders({ 'x-glean-v': v });
  pg.on('pageerror', (e) => errs.push(`[${v}] pageerror ${e.message}`));
  return pg;
}

/** 直接往 IndexedDB 写 n 条（images 条带原图 + 缩略图，不走后台缩略图任务），分批事务 */
async function seed(pg, n, images) {
  return pg.evaluate(
    async ({ n, images }) => {
      const mk = (w, h, hue, q) =>
        new Promise((res) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          const gr = g.createLinearGradient(0, 0, w, h);
          gr.addColorStop(0, `hsl(${hue},55%,70%)`);
          gr.addColorStop(1, `hsl(${hue + 140},45%,30%)`);
          g.fillStyle = gr;
          g.fillRect(0, 0, w, h);
          for (let k = 0; k < 30; k++) {
            g.fillStyle = `hsla(${(hue + k * 13) % 360},60%,${30 + (k % 5) * 12}%,0.5)`;
            g.beginPath();
            g.arc((k * 197) % w, (k * 131) % h, 20 + (k % 7) * 18, 0, 7);
            g.fill();
          }
          c.toBlob(res, 'image/jpeg', q);
        });
      const origs = [], thumbs = [];
      for (let v = 0; v < 12; v++) {
        origs.push(await mk(v % 3 === 2 ? 600 : 800, v % 3 === 2 ? 800 : 600, v * 31, 0.8));
        thumbs.push({ blob: await mk(v % 3 === 2 ? 300 : 400, v % 3 === 2 ? 400 : 300, v * 31, 0.72), w: v % 3 === 2 ? 300 : 400, h: v % 3 === 2 ? 400 : 300 });
      }
      const words = ['麦田', '黄昏', '旧歌', '慢镜头', '雨', '海边', '便利店', '霓虹', '胶片', '手写', '风', '街角', '老电影', '钢琴', '夏天', '夜车'];
      const types = ['film', 'music', 'text', 'idea', 'link'];
      const now = Date.now();
      const every = images ? Math.round(n / images) : 0;
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('lingan');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const B = 2000;
      let imgs = 0;
      for (let s = 0; s < n; s += B) {
        await new Promise((res, rej) => {
          const tx = db.transaction(['items', 'images'], 'readwrite');
          const it = tx.objectStore('items'), im = tx.objectStore('images');
          for (let i = s; i < Math.min(n, s + B); i++) {
            const img = every && i % every === 0 && imgs < images;
            const t = img ? 'image' : types[i % 5];
            const w1 = words[i % 16], w2 = words[(i * 7) % 16];
            const th = img ? thumbs[i % 12] : null;
            const row = {
              type: t,
              title: img ? `${w1}的照片 ${i}` : `${w1}与${w2} · 第 ${i} 穗`,
              creator: i % 3 ? `作者${i % 37}` : '',
              year: '',
              content: t === 'text' || t === 'idea' ? `${w1}和${w2}之间有一种说不清的关系，像${words[(i * 3) % 16]}落在${words[(i * 5) % 16]}上。` : '',
              url: t === 'link' ? `https://example.com/a/${i}` : '',
              why: i % 4 === 0 ? `因为${w2}让我想起${words[(i * 11) % 16]}` : '',
              tags: [w1, w2].slice(0, 1 + (i % 2)),
              createdAt: now - i * 3600e3,
              updatedAt: now - i * 3600e3,
              uid: `01STRESS${String(i).padStart(18, '0')}`,
              graftCount: 0,
              ...(th ? { hasImage: 1, thumb: th.blob, thumbW: th.w, thumbH: th.h } : {}),
            };
            const q = it.add(row);
            if (img) {
              imgs++;
              // 每张原图各不相同（.glean 按内容哈希去重）：JPEG 头后插一个注释段，Blob 拼接不复制像素
              const tagb = `glean-stress-${i}`;
              const seg = new Uint8Array([0xff, 0xfe, 0, tagb.length + 2, ...new TextEncoder().encode(tagb)]);
              const o = origs[i % 12];
              const blob = new Blob([o.slice(0, 2), seg, o.slice(2)], { type: 'image/jpeg' });
              q.onsuccess = () => im.put({ itemId: q.result, blob, mid: null });
            }
          }
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error);
        });
      }
      db.close();
      // 不让后台任务（旧图补详情档）在测量时抢主线程；全文索引照常后台建
      localStorage.setItem('glean.mid.v1', '1');
      return { items: n, images: imgs };
    },
    { n, images },
  );
}

async function coldStart(ctx, v, cpu) {
  const pg = await page(ctx, v);
  const cdp = await ctx.newCDPSession(pg);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await pg.addInitScript(() => {
    let x;
    Object.defineProperty(window, '__gleanReady', { configurable: true, get: () => x, set: (y) => { x = y; const ch = new MessageChannel(); ch.port1.onmessage = () => { window.__gleanPainted = performance.now(); }; ch.port2.postMessage(0); } });
  });
  await pg.goto(base);
  await pg.waitForFunction(() => window.__gleanPainted && document.querySelectorAll('.masonry .card').length > 0, null, { timeout: 120000 });
  const r = await pg.evaluate(() => ({ painted: Math.round(window.__gleanPainted), count: document.querySelector('.page-title .count')?.textContent }));
  // 全量到了的时刻（类型 chip 出来 = 全表读完、算完）
  const t0 = Date.now();
  await pg.waitForFunction(() => document.querySelectorAll('.filter-row .chip').length > 1, null, { timeout: 120000 }).catch(() => {});
  r.fullAfterMs = Date.now() - t0;
  r.heapMB = await pg.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await pg.close();
  return r;
}

async function scroll(pg) {
  return pg.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
    const max = document.documentElement.scrollHeight - innerHeight;
    const d = [];
    await new Promise((res) => {
      const t0 = performance.now();
      let last = t0;
      const step = (now) => {
        d.push(now - last);
        last = now;
        const y = Math.min(max, ((now - t0) / 1000) * 3000);
        window.scrollTo(0, y);
        if (now - t0 < 4000 && y < max) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
    const s = d.slice(2).sort((a, b) => a - b);
    const sum = s.reduce((a, b) => a + b, 0);
    return { avgFps: Math.round((1000 * s.length) / sum), p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(1), jankPct: +((100 * s.filter((x) => x > 34).length) / s.length).toFixed(1), mounted: document.querySelectorAll('.card').length };
  });
}

async function search(pg, n) {
  await pg.click('.search-toggle');
  await pg.waitForSelector('.sq-input');
  await pg.waitForFunction((n) => window.__gleanSearch?.ready && window.__gleanSearch.indexed >= n, n, { timeout: 300000 }).catch(() => errs.push(`[search] index not ready for ${n}`));
  const out = [];
  for (const q of ['黄昏', '慢镜头', '夜车 海边', '第 4']) {
    const ms = await pg.evaluate(async (q) => {
      const inp = document.querySelector('.sq-input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, '');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const t0 = performance.now();
      set.call(inp, q);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((res) => {
        const chk = () => (document.querySelector('.sq-count')?.dataset.q === q ? requestAnimationFrame(() => res()) : requestAnimationFrame(chk));
        chk();
      });
      return { ms: Math.round(performance.now() - t0), n: Number(document.querySelector('.sq-count')?.dataset.n) };
    }, q);
    out.push({ q, ...ms });
  }
  await pg.keyboard.press('Escape');
  return { maxMs: Math.max(...out.map((x) => x.ms)), runs: out };
}

async function exportGlean(pg, n) {
  await pg.click('.nav-btn:has-text("设置")');
  await pg.waitForSelector('#set-data', { timeout: 20000 });
  await pg.waitForSelector('.backup-export', { timeout: 20000 });
  await pg.evaluate(() => window.gc && window.gc());
  const base0 = await pg.evaluate(() => performance.memory.usedJSHeapSize);
  await pg.evaluate(() => { window.__peak = performance.memory.usedJSHeapSize; window.__pt = setInterval(() => { window.__peak = Math.max(window.__peak, performance.memory.usedJSHeapSize); }, 20); });
  const t0 = Date.now();
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 600000 }), pg.click('.backup-export')]);
  await pg.waitForSelector(`.toast:has-text("已导出 ${n} 穗")`, { timeout: 600000 }).catch(() => errs.push(`[export] toast for ${n}`));
  const ms = Date.now() - t0;
  const peak = await pg.evaluate(() => { clearInterval(window.__pt); return window.__peak; });
  const bytes = fs.statSync(await dl.path()).size;
  return { ms, mb: +(bytes / 1048576).toFixed(1), heapDeltaMB: +((peak - base0) / 1048576).toFixed(1) };
}

for (const n of SIZES) {
  const images = n <= 10000 ? Math.round(n * 0.3) : 0;
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('glean.onboarded', '1');
      localStorage.setItem('glean.inbox', 'off');
      if (!localStorage.getItem('lingan.settings.v1')) localStorage.setItem('lingan.settings.v1', JSON.stringify({ phase: 'day', autoCaption: false, autoEmbed: false }));
    } catch {
      /* */
    }
  });
  const last = KEYS[KEYS.length - 1];
  const p0 = await page(ctx, last);
  await p0.goto(base);
  await p0.waitForSelector('text=穗仓还是空的', { timeout: 30000 });
  const ts = Date.now();
  const seeded = await seed(p0, n, images);
  const seedMs = Date.now() - ts;
  // 第一次打开：建全文索引（后台），等它建完再测，免得冷启动里混进建索引
  await p0.reload();
  await p0.waitForFunction(() => document.querySelectorAll('.masonry .card').length > 0, null, { timeout: 120000 });
  await p0.waitForFunction((n) => window.__gleanSearch?.ready && window.__gleanSearch.indexed >= n, n, { timeout: 600000 }).catch(() => errs.push(`[${n}] index build timeout`));
  const indexInfo = await p0.evaluate(() => ({ buildMs: window.__gleanSearch?.buildMs, rows: window.__gleanSearch?.rows }));
  await p0.close();
  const R = Object.fromEntries(KEYS.map((k) => [k, { n: [], c4: [], fullAfter: [], heap: [], count: null }]));
  for (let i = 0; i < ROUNDS; i++) {
    const order = KEYS.map((_, j) => KEYS[(i + j) % KEYS.length]);
    for (const k of order) {
      const a = await coldStart(ctx, k, 1);
      R[k].n.push(a.painted);
      R[k].fullAfter.push(a.fullAfterMs);
      R[k].heap.push(a.heapMB);
      R[k].count = a.count;
      if (!process.env.NO4X) R[k].c4.push((await coldStart(ctx, k, 4)).painted);
    }
  }
  const res = { seeded, seedMs, index: indexInfo, cold: {} };
  for (const k of KEYS) res.cold[k] = { normalMedian: med(R[k].n), cpu4xMedian: R[k].c4.length ? med(R[k].c4) : null, normalRuns: R[k].n, cpu4xRuns: R[k].c4, fullAfterMedianMs: med(R[k].fullAfter), heapMedianMB: med(R[k].heap), count: R[k].count };
  for (const k of KEYS) if (R[k].count !== `(${n})`) errs.push(`[${n}] ${k} title count ${R[k].count}`);
  // 滚动 / 搜索 / 导出：每个版本各一次（导出太慢，5 万档不测）
  res.scroll = {};
  res.search = {};
  for (const k of KEYS) {
    const pg = await page(ctx, k);
    await pg.goto(base);
    await pg.waitForFunction(() => document.querySelectorAll('.filter-row .chip').length > 1, null, { timeout: 120000 });
    await pg.waitForTimeout(800);
    res.scroll[k] = await scroll(pg);
    res.search[k] = await search(pg, n);
    if (n <= 10000 && k === last) res.export = { [k]: await exportGlean(pg, n) };
    await pg.close();
  }
  OUT.sizes[n] = res;
  console.log(`STRESS ${n}: ` + JSON.stringify({ seedMs, index: indexInfo, cold: Object.fromEntries(KEYS.map((k) => [k, [res.cold[k].normalMedian, res.cold[k].cpu4xMedian, res.cold[k].fullAfterMedianMs]])), scroll: res.scroll, search: Object.fromEntries(KEYS.map((k) => [k, res.search[k].maxMs])), export: res.export }));
  await ctx.close();
}
OUT.errors = errs;
fs.writeFileSync(outFile, JSON.stringify(OUT, null, 2));
console.log(errs.length ? 'STRESS ERRORS:\n' + errs.join('\n') : 'STRESS DONE');
await b.close();
srv.close();
