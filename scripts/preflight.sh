#!/usr/bin/env bash
# v0.37 0739 一键发版前检查（本地）：和 CI / release verify 同一套门，外加几条只在本地查得到的。
# 用法：bash scripts/preflight.sh vX.Y.Z      （在 lingan/ 下跑；InstaBox e2e + 同会话交替测仍按 RELEASE_RUNBOOK 另跑）
set -euo pipefail
TAG="${1:?用法：bash scripts/preflight.sh vX.Y.Z}"
V="${TAG#v}"
cd "$(dirname "$0")/.."
ok() { printf '  OK  %s\n' "$1"; }
die() { printf '  FAIL %s\n' "$1"; exit 1; }
echo "preflight $TAG"
# tsc 增量缓存会骗人（RUNBOOK v0.21）
rm -f node_modules/.tmp/*.tsbuildinfo
npx tsc -b >/dev/null && ok tsc || die tsc
# oxlint 新版末行是「Finished in …」：找汇总行（Found n warnings and 0 errors）
npx oxlint >/tmp/preflight-oxlint.log 2>&1 || true; grep -Eq '^Found [0-9]+ warnings? and 0 errors' /tmp/preflight-oxlint.log && ok "oxlint $(grep -Eo '^Found [0-9]+ warnings? and 0 errors' /tmp/preflight-oxlint.log)" || { tail -5 /tmp/preflight-oxlint.log; die oxlint; }
NO_COLOR=1 npx vitest run >/tmp/preflight-vitest.log 2>&1 && ok "vitest $(grep -o 'Tests  *[0-9]* passed' /tmp/preflight-vitest.log | head -1)" || { tail -30 /tmp/preflight-vitest.log; die vitest; }
npx vite build >/tmp/preflight-build.log 2>&1 && ok build || { tail -20 /tmp/preflight-build.log; die build; }
node scripts/size-budget.mjs >/tmp/preflight-size.log 2>&1 && ok "体积预算 $(grep -o '总量.*' /tmp/preflight-size.log | head -1)" || { cat /tmp/preflight-size.log; die 体积预算; }
node --check mcp/glean-mcp.mjs && node --check e2e/run.mjs && node --check e2e/stress.mjs && ok 语法 || die 语法
[ -f "docs/releases/$TAG.md" ] && ok "发布说明 docs/releases/$TAG.md" || die "缺 docs/releases/$TAG.md"
grep -Eq '\b0[0-9]{3}\b' "docs/releases/$TAG.md" && ok 发布说明列了编号 || die 发布说明没列编号
[ -f "docs/perf/$TAG.json" ] && ok "性能记录 docs/perf/$TAG.json" || die "缺 docs/perf/$TAG.json"
# ideas.csv 必须是 CRLF（RUNBOOK v0.29），不然 ghsync 会推一遍整表
python3 - <<'P' || die 'ideas.csv 不是 CRLF'
b=open('docs/ideas/ideas.csv','rb').read()
assert b.count(b'\n')==b.count(b'\r\n'), 'mixed line endings'
P
ok 'ideas.csv CRLF'
# 私钥 / key 不进仓库
# 排除本脚本自己的模式串；e2e 里脱敏测试用的假 key（sk-abcdefghijklmnop1234）白名单放行
if grep -rIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=target --exclude-dir=gen --exclude=preflight.sh -E 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9]{20,}|untrusted comment: rsign encrypted secret key' . | grep -v 'sk-abcdefghijklmnop1234' >/tmp/preflight-secrets.txt; then cut -d: -f1,2 /tmp/preflight-secrets.txt; die '疑似私钥 / key'; fi
ok '没有私钥 / key'
find . -path ./node_modules -prune -o \( -name '*.p12' -o -name '*.jks' -o -name '*.keystore' -o -name 'updater.key' \) -print | grep -q . && die '仓库里有密钥文件' || ok '没有密钥文件'
# 锁文件完整（CI 用 npm ci）
node -e "const l=require('./package-lock.json');const p=require('./package.json');for(const d of Object.keys({...p.dependencies,...p.devDependencies}))if(!l.packages['node_modules/'+d])throw new Error('lock 缺 '+d)" && ok package-lock || die package-lock
echo "preflight $V OK —— 下一步：InstaBox e2e ALL PASS + bench5 同会话交替 + node scripts/perf-gate.mjs，再 ghsync / 发版"
