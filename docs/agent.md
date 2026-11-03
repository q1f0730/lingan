# 让 Agent 读你的穗仓：glean-mcp 与本地 API（v0.25 起）

拾穗 Windows 版可以在本机开一个只给自己用的接口，让 Claude Code、Cherry Studio、Qoder 这类 Agent 搜你的穗、读你的口味，帮你写东西时引用真东西，而不是瞎编。

## 安全边界

- **默认关**。设置 → Agent 与 API →「本地 API」打开后才监听。
- **只听本机**：`127.0.0.1:47321`（端口可改）。Host 头必须是本机（防 DNS 重绑定），带浏览器 `Origin` 头的请求一律拒绝（网页偷调不了）。
- **要令牌**：`Authorization: Bearer glean_…`。令牌存在系统钥匙串（Windows 凭据管理器），只有你在设置里点「复制令牌」时才取出来；怀疑泄露就点「换一个令牌」，旧的立即失效。
- **默认只读**：搜穗、读穗、列新枝、口味侧写、查套路。**私密穗永远不给**，原图和向量不返回。
- **写入要两道门**：设置里打开「允许 Agent 写入」后，Agent 才看得到 `add_item`；每一次写入都会在拾穗里弹窗，你点「允许」才收下，收下的穗进「待理」、标「Agent 代拾 · 客户端名」，不会直接进穗仓。3 分钟没点算拒绝。
- **有记录**：每次调用记一行（客户端、工具、返回几穗），设置里能看「谁看过我的穗仓 · 近 7 天」。不记你的查询词和穗的内容。

拾穗主窗口要开着（缩在托盘里也行），接口才有人应答。

## Claude Code

```
claude mcp add --transport http glean http://127.0.0.1:47321/mcp --header "Authorization: Bearer <令牌>"
```

设置页的「复制命令」会把真令牌填好。

## Cherry Studio

设置 → MCP 服务器 → 添加 → 类型选「可流式传输的 HTTP（streamableHttp）」：

- URL：`http://127.0.0.1:47321/mcp`
- 请求头：`Authorization: Bearer <令牌>`

或者「从 JSON 导入」，粘设置页「复制 JSON」的内容：

```json
{ "mcpServers": { "glean": { "type": "streamableHttp", "url": "http://127.0.0.1:47321/mcp", "headers": { "Authorization": "Bearer <令牌>" } } } }
```

## 只支持 stdio 的客户端

下载 Release 里的 `glean-mcp.mjs`（单文件、零依赖，Node 18+）：

```json
{ "mcpServers": { "glean": { "command": "node", "args": ["C:/path/to/glean-mcp.mjs"], "env": { "GLEAN_TOKEN": "<令牌>", "GLEAN_PORT": "47321" } } } }
```

它同时是个命令行（0834 / 0836）：

```
node glean-mcp.mjs search 雨 --json
node glean-mcp.mjs get <id>
node glean-mcp.mjs taste
node glean-mcp.mjs lint 草稿.md        # 用你的套路墙查文字，撞了退出码 1
node glean-mcp.mjs add --title "…" --url "…" --why "…" --tag 歌   # 需开写入并在 App 里点允许
```

## MCP 工具与资源

| 名字 | 说明 |
|---|---|
| `search_items(query?, type?, limit?)` | 全文搜（标题、作者、内容、为什么、标签）；不给 query = 最新的穗 |
| `get_item(id)` | 读一穗完整内容 |
| `list_branches(limit?, starred?)` | 嫁接长出的新枝，带用到的穗 |
| `get_taste()` | 口味侧写（markdown） |
| `check_cliches(text)` | 套路墙命中的说法与位置 |
| `add_item(...)` | 只有开了写入才出现；每次要你点允许 |
| 资源 `glean://taste` | 高频标签、最近 30 天升温 / 冷下来、常拾的作者、反口味、套路墙前 30 条 |

协议：MCP Streamable HTTP（`POST /mcp`，JSON 应答，不开 SSE），支持 2025-06-18 / 2025-03-26 / 2024-11-05。

## REST

都要 `Authorization: Bearer <令牌>`：

| 方法 | 路径 | |
|---|---|---|
| GET | `/v1/items?q=&type=&limit=` | 搜穗 |
| GET | `/v1/items/<id>` | 读一穗 |
| GET | `/v1/branches?limit=&starred=1` | 列新枝 |
| GET | `/v1/taste` | `{ markdown }` |
| POST | `/v1/cliches/check` | `{ text }` → `{ count, hits:[{text, at, len}] }` |
| POST | `/v1/items` | `{ title?, content?, url?, why?, creator?, type?, tags? }` → 201 `{ id, inbox:true }`；没开写入 403，本人拒绝 403 |
| GET | `/health` | 不要令牌，只回 `{ok:true}` |
