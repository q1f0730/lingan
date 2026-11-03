// v0.26 0750：把 docs/releases/vX.Y.Z.md 压成几行纯文字，写进 latest.json 的 notes（App 里「这版新了什么」显示它）。
// 用法：node scripts/latest-notes.mjs docs/releases/v0.26.0.md latest.json
// 只改 notes 字段；版本、签名、下载地址原样不动（签名只覆盖安装包，不覆盖 latest.json）。
import fs from 'node:fs';

export function summarize(md, max = 1500) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  let intro = '';
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith('#')) {
      if (intro) break;
      continue;
    }
    if (t.startsWith('**') || t.startsWith('-')) break;
    intro += (intro ? ' ' : '') + t;
  }
  if (intro) out.push(intro);
  for (const l of lines) {
    const m = /^\s*-\s+\*\*(.+?)\*\*/.exec(l);
    if (m) out.push('· ' + m[1].replace(/`/g, ''));
  }
  let s = out.join('\n').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

if (process.argv[1] && process.argv[1].endsWith('latest-notes.mjs')) {
  const [md, json] = process.argv.slice(2);
  const j = JSON.parse(fs.readFileSync(json, 'utf8'));
  j.notes = summarize(fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '');
  fs.writeFileSync(json, JSON.stringify(j, null, 2));
  console.log(j.notes);
}
