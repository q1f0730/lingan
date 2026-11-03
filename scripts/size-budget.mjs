// v0.25 0742 体积预算：vite build 之后跑。读 dist/index.html 找首屏会加载的 JS / CSS（入口 + modulepreload + stylesheet），
// 再看首片中文字体、最大的懒加载块、总量。任何一项超预算 → 退出码 1。
// 用法：node scripts/size-budget.mjs [--report size-report.md] [--json size-report.json]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const argOf = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const dist = 'dist';
const budget = JSON.parse(fs.readFileSync(new URL('./size-budget.json', import.meta.url), 'utf8'));
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const size = (f) => fs.statSync(path.join(dist, f)).size;
const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(dist, f)), { level: 9 }).length;
const refs = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^\//, ''));
const firstJs = [...new Set([...refs(/<script[^>]+src="([^"]+\.js)"/g), ...refs(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)])];
const firstCss = refs(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g);
const assets = fs.readdirSync(path.join(dist, 'assets')).map((f) => 'assets/' + f);
const sum = (xs, fn = size) => xs.reduce((s, f) => s + fn(f), 0);
const lazy = assets.filter((f) => f.endsWith('.js') && !firstJs.includes(f)).map((f) => [f, size(f)]).sort((a, b) => b[1] - a[1]);
const font0 = assets.filter((f) => /glean-sans-0-.*\.woff2$/.test(f));
const inter = assets.filter((f) => /glean-inter-.*\.woff2$/.test(f));

const rows = [
  ['首屏 JS', firstJs.join(' + '), sum(firstJs), budget.firstJs],
  ['首屏 JS（gzip）', '同上', sum(firstJs, gz), budget.firstJsGzip],
  ['首屏 CSS', firstCss.join(' + '), sum(firstCss), budget.firstCss],
  ['首片中文字体', font0.join(' '), sum(font0), budget.fontFirstSlice],
  ['西文字体', inter.join(' '), sum(inter), budget.fontInter],
  ['最大懒加载块', lazy[0]?.[0] || '-', lazy[0]?.[1] || 0, budget.lazyChunkMax],
  ['dist/assets 总量', `${assets.length} 个文件`, sum(assets), budget.totalAssets],
];
if (!firstJs.length || !font0.length) rows.push(['解析', '没在 index.html / assets 里找到首屏 JS 或首片字体', 1, 0]);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const fails = rows.filter((r) => r[2] > r[3]);
const md = [
  '# 体积预算',
  '',
  '| 项 | 文件 | 实际 | 预算 | |',
  '|---|---|---:|---:|---|',
  ...rows.map(([k, f, v, b]) => `| ${k} | ${f} | ${kb(v)} | ${kb(b)} | ${v > b ? '超标' : 'OK'} |`),
  '',
  '## 全部产物（大 → 小）',
  '',
  '| 文件 | 大小 | gzip |',
  '|---|---:|---:|',
  ...assets.map((f) => [f, size(f)]).sort((a, b) => b[1] - a[1]).map(([f, s]) => `| ${f}${firstJs.includes(f) || firstCss.includes(f) ? '（首屏）' : ''} | ${kb(s)} | ${/\.(js|css|svg)$/.test(f) ? kb(gz(f)) : '-'} |`),
].join('\n');
console.log(md.split('\n## ')[0]);
const rep = argOf('--report');
if (rep) fs.writeFileSync(rep, md + '\n');
const js = argOf('--json');
if (js) fs.writeFileSync(js, JSON.stringify({ rows: rows.map(([k, f, v, b]) => ({ k, f, v, b, ok: v <= b })) }, null, 1));
if (fails.length) {
  console.error(`\n体积预算超标：${fails.map((r) => `${r[0]} ${kb(r[2])} > ${kb(r[3])}`).join('；')}`);
  process.exit(1);
}
console.log('\n体积预算 OK');
