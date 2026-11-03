# AGENTS.md · 给 Claude Code / Qoder / Codex 的仓库指南

拾穗 Glean：私人灵感收集器。Tauri v2（Rust）+ React 19 + TypeScript + Vite 8（rolldown）+ Dexie（IndexedDB）。作者署名 Q1f730。

## 目录

- `src/lib/` 逻辑层（纯函数为主，可单测）：`db.ts` Dexie schema 与迁移、`backup.ts` .glean 备份、`graft.ts` 嫁接、`search.ts` 搜索、`agentapi.ts` 本地 API / MCP、`update.ts` 自动更新、`vault.ts` 钥匙串。
- `src/views/` 页面，`src/components/` 组件，样式全在 `src/index.css`。
- `src/__tests__/` vitest（node 环境 + fake-indexeddb）；夹具在 `src/__tests__/fixtures/`。
- `src-tauri/` Rust：`lib.rs` 入口与托盘、`api.rs` + `apicore.rs` 本地 API、`smtc.rs` Windows 正在播放。
- `scripts/android/*.kt` 安卓原生代码（`patch-android.mjs` 换包名后拷进 gen）。
- `e2e/run.mjs` Playwright 端到端（含性能基准）。`mcp/glean-mcp.mjs` stdio 桥 + CLI。
- `docs/releases/` 每版发布说明，`docs/perf/` 每版性能，`docs/ideas/` 1000 条建议与实施计划。

## 质量门（全部必须过，不许删测试、不许放宽阈值）

```
rm -f node_modules/.tmp/*.tsbuildinfo   # tsc -b 的缓存会骗人
npx tsc -b
npx oxlint            # 0 error
npx vitest run
npm run build
node scripts/size-budget.mjs   # 体积预算（scripts/size-budget.json），只许收紧
node e2e/run.mjs http://127.0.0.1:4173/ /tmp/shots   # 必须 ALL PASS
```

CI：`.github/workflows/ci.yml` 每次推送跑前五项；`release.yml` 手动发版（verify → 建 release → Windows / 安卓 → 产物核对 + SHA256SUMS）。

## 硬规则

- **Dexie 改 schema 必须新增 version + upgrade 迁移**，并在 `src/__tests__/fixtures/dexie/` 加上一版夹具、`migrate.test.ts` 覆盖。不许改已有 version 的定义。
- **密钥不进仓库、不进日志、不进 localStorage 设置**：AI 密钥走 `src/lib/vault.ts`；本地 API 令牌只在系统钥匙串（Rust `api.rs`）；签名私钥只在 GitHub Secrets。
- **私密穗（`private: 1`）不出本机**：不发云端模型、不给 MCP / API。
- **视觉**：遵守 `DESIGN_CHOICE.md` 与 `docs/design/studio/STYLE.md`；新界面字如果不在字体切片里才重做字体子集（会让首片变大）。
- **首屏**：新功能默认懒加载；改完看 `dist/index.html` 的 modulepreload，只能有 app 块 + 入口 + runtime。
- **动效**必须尊重 reduced-motion，不能拖慢低端安卓。
- 公开署名 Q1f730，不写真名。
