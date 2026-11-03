#!/usr/bin/env node
// v0.37 0727 性能回归门：只认「同一 InstaBox 会话里交替测」的结果（跨会话能差 15%+，见 RELEASE_RUNBOOK）。
// 用法：node scripts/perf-gate.mjs <bench.json> <旧版名> <新版名>
//   bench.json = bench5.mjs 打印的 BENCH {...}（或 docs/perf/vX.json 的 interleavedBench）
// 规则（阈值只许收紧）：新版 painted 中位数比旧版慢超过 10%，且 Mann-Whitney 单侧显著（p < 0.05，正态近似）才算回归。
// 两档（普通 / 4× 降速）都要过。一次离群不会拦，真变慢拦得住。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_SLOWER = 0.1;
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** U = 新版里「比旧版快」的对数（并列算半个）；z > 1.645 = 新版显著更慢 */
export function mannWhitneyU(a, b) {
  let u = 0;
  for (const x of a) for (const y of b) u += y < x ? 1 : y === x ? 0.5 : 0;
  const n1 = a.length, n2 = b.length;
  const mu = (n1 * n2) / 2;
  const sd = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12) || 1;
  // u 小 = b（新版）大多比 a（旧版）慢
  return { u, z: (mu - u) / sd };
}
export function gate(oldRuns, newRuns) {
  const mo = med(oldRuns), mn = med(newRuns);
  const ratio = mn / mo - 1;
  const { u, z } = mannWhitneyU(oldRuns, newRuns);
  const slower = ratio > MAX_SLOWER && z > 1.645;
  return { pass: !slower, oldMedian: mo, newMedian: mn, ratio: +(ratio * 100).toFixed(1), u, z: +z.toFixed(2) };
}

function pick(j, k) {
  const r = j[k] || j.interleavedBench?.[k];
  if (!r) throw new Error(`bench 里没有 ${k}（有：${Object.keys(j.interleavedBench || j).join(', ')}）`);
  return r;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [file, a, b] = process.argv.slice(2);
  if (!file || !a || !b) {
    console.error('用法：node scripts/perf-gate.mjs <bench.json> <旧版名> <新版名>');
    process.exit(2);
  }
  let txt = fs.readFileSync(file, 'utf8');
  if (txt.startsWith('BENCH ')) txt = txt.slice(6);
  const j = JSON.parse(txt);
  const A = pick(j, a), B = pick(j, b);
  let ok = true;
  for (const [label, k] of [['普通', 'normalRuns'], ['4× 降速', 'cpu4xRuns']]) {
    if (!A[k]?.length || !B[k]?.length) continue;
    const g = gate(A[k], B[k]);
    ok &&= g.pass;
    console.log(`${g.pass ? 'OK  ' : 'FAIL'} ${label}: ${a} ${g.oldMedian}ms → ${b} ${g.newMedian}ms（${g.ratio >= 0 ? '+' : ''}${g.ratio}%，U=${g.u}/${A[k].length * B[k].length}，z=${g.z}）`);
  }
  console.log(ok ? '性能回归门 OK' : '性能回归门 FAIL：新版显著变慢超过 10%');
  process.exit(ok ? 0 : 1);
}
