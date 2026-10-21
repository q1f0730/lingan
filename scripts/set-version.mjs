import fs from 'node:fs';
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v)) { console.log('skip version', v); process.exit(0); }
const c = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
c.version = v; fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(c, null, 2));
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = v; fs.writeFileSync('package.json', JSON.stringify(p, null, 2));
const t = fs.readFileSync('src-tauri/Cargo.toml', 'utf8').replace(/^version = ".*"$/m, `version = "${v}"`);
fs.writeFileSync('src-tauri/Cargo.toml', t);
console.log('version', v);
