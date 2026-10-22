# 拾穗 · Glean

> 大模型的答案偏向大众平均值。拾穗只用**你自己拾来的东西**嫁接出新创意。

私人灵感收集器：随手拾进打动你的音乐、电影、图片、摘抄、链接和想法，写一句「为什么收」。
需要灵感时，挑几穗相距很远的东西嫁接在一起，一次长出三根新枝；每根新枝都写明「因为这几穗」，点一下回到原穗，说不清来源的会标「证据不足」。

## 下载
到 [Releases](../../releases) 下载最新版：
- **安卓**：`Glean_x.y.z_android.apk`（首次安装需允许「安装未知来源应用」）
- **Windows**：`Glean_x.y.z_x64-setup.exe`（或 `.msi`）

## 功能
| 模块 | 内容 |
| --- | --- |
| 穗仓 | 网格 / 列表 / 时间线（按周）/ 月历四种视图、搜索（穗与新枝，命中高亮）、类型与标签筛选（真实计数）、每日一穗、「那年今天」回顾、示例池 |
| 速记 | 常驻「随手拾一穗」回车即存、剪贴板一键收、安卓分享进来、Windows 全局快捷键 Ctrl+Shift+L 小窗 + 托盘、N 键展开完整表单 |
| 嫁接 | 3–5 穗、跳跃度、四步（找张力 → 撒种子 → 换掉相像的 → 留三根）、离线同样可用、来源溯源 |
| 新枝 | 按批次成捆、留下 / 再接一次 / 不要、黑底「宣言」大字视图 |
| 口味 | 倾向与来源表、构成、最近冷下来的、365 天拾穗日子、AI 侧写 |
| 设置 | 智谱 GLM（免费，默认）/ 硅基流动 / Gemini / 任意 OpenAI 兼容接口、可选向量模型、白 / 黑主题（跟随系统）、JSON 备份导入、搬去 Obsidian（Markdown + 图片 ZIP） |

数据全部保存在本机（IndexedDB）。API Key 只存在你的设备上，不会打包进安装包。

## 免费 AI 怎么配
1. 打开 https://bigmodel.cn 用手机号注册，在 API Keys 页面新建密钥
2. App → 设置 → AI 服务 → 选「智谱 GLM（免费）」→ 粘贴密钥 → 保存 → 测试连接

## 开发
```bash
npm install
npm run dev        # 浏览器里开发
npm test           # 单元测试
npm run tauri dev  # 桌面壳
```
技术栈：Tauri v2 + React + TypeScript + Vite + Dexie(IndexedDB)。安装包由 GitHub Actions 构建（`.github/workflows/release.yml`）。
视觉规范与设计稿见 `docs/design/studio/`（STYLE.md、SCREENS.md）。技术选型参考了 Gemini 与 Perplexity 的深度研究。

## 致谢
- 斜策略的思路来自 Brian Eno & Peter Schmidt 的 *Oblique Strategies*（文案为本项目重写）
- [Tauri](https://tauri.app)（MIT/Apache-2.0）· [Dexie](https://dexie.org)（Apache-2.0）· [Inter](https://rsms.me/inter/)（OFL）· [Noto Sans SC / 思源黑体](https://github.com/notofonts/noto-cjk)（OFL）

License: Apache-2.0 · by Q1f730
