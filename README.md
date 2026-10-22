# 灵感暗房 Lingan

> 大模型的答案偏向大众平均值。灵感暗房只用**你自己收藏的东西**来显影创意。

私人灵感收集器：随手收进打动你的音乐、电影、图片、文案、链接和想法，写一句「为什么打动我」。
需要灵感时，按「跳跃度」从你的库里抽出几张八竿子打不着的底片，让 AI 先列出套路、再全部禁用，产出一个能追溯到你素材的具体创意。

## 下载
到 [Releases](../../releases) 下载最新版：
- **安卓**：`Lingan_x.y.z_android.apk`（首次安装需允许「安装未知来源应用」）
- **Windows**：`Lingan_x.y.z_x64-setup.exe`（或 `.msi`）

## 功能（v0.1）
| 模块 | 内容 |
| --- | --- |
| 灵感库 | 胶片卡片瀑布流、搜索、类型/标签筛选、详情编辑删除 |
| 收集 | 6 种类型、图片自动压缩、标签、「为什么打动我」 |
| 显影 | 跳跃度控制的远距离抽样、2/3 张底片、换一张、今日底片、AI 套路禁用 + 斜策略、离线显影、记录与收藏、来源追溯 |
| 口味画像 | 构成、母题、年代、常客、7 天曲线、AI 毒舌侧写 |
| 设置 | 智谱 GLM（免费，默认）/ 硅基流动 / Gemini / 任意 OpenAI 兼容接口（含本地 LM Studio）、可选向量模型、浅色相纸 / 深色暗房、导入导出备份、导出为 Obsidian 仓库（Markdown + 图片 ZIP） |

数据全部保存在本机（IndexedDB）。API Key 只存在你的设备上，不会打包进安装包。

## 免费 AI 怎么配
1. 打开 https://bigmodel.cn 用手机号注册，在 API Keys 页面新建密钥
2. App → 设置 → 选「智谱 GLM（免费）」→ 粘贴密钥 → 测试连接 → 保存

## 开发
```bash
npm install
npm run dev        # 浏览器里开发
npm test           # 单元测试
npm run tauri dev  # 桌面壳
```
技术栈：Tauri v2 + React + TypeScript + Vite + Dexie(IndexedDB)。安装包由 GitHub Actions 构建（`.github/workflows/release.yml`），推送 `v*` 标签即发布。
设计稿来自 Google Stitch（`docs/design/`）。技术选型参考了 Gemini 与 Perplexity 的深度研究。

## 致谢
- 斜策略的思路来自 Brian Eno & Peter Schmidt 的 *Oblique Strategies*（文案为本项目重写）
- [Tauri](https://tauri.app)（MIT/Apache-2.0）· [Dexie](https://dexie.org)（Apache-2.0）· [JetBrains Mono](https://www.jetbrains.com/lp/mono/)（OFL）

License: Apache-2.0 · by Q1f730
