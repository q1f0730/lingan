# 拾穗 · Glean — Rewamp UI 重设计：组件清单

分支：`redesign/rewamp-ui`（基于 main v0.19.0）。来源：Rewamp UI（https://www.rewampui.com/components ，源码 https://github.com/palakonweb/Rewamp-UI ，React 19 + Tailwind 4 + Framer Motion 的复制粘贴组件库）。

## 一句话方向

明亮、安静、温暖、低摩擦。暖白底（`#F7F5F1`）上浮起白色卡片，细描边 + 柔和投影 + 大圆角，强调色用 Rewamp 自己的淡紫（`#D4CBE5` / 字色 `#4A3F66`），「每日一穗」「为什么收」用一点淡杏色。字体沿用自托管的 Inter + 思源黑体（400–700），中文字号阶梯：标题 34/44、正文 15、小字 12。不再有 Studio 的 0 圆角 / 超大标题，也不回阿卡迪亚的暖纸 / 麦田 / 衬线，深色只在用户选「黑」或系统深色时出现（暖灰黑 `#17161A`，不是纯黑暗房）。

## 技术取舍

- **Framer Motion：引入**（`framer-motion@^12.43`）。全部用 `LazyMotion` + `m.*` 写，`domMax`（含 layoutId 共享布局）放在单独的 `features` 包里首屏后异步加载；`MotionConfig reducedMotion`：系统「减少动态效果」或低端机判为 off 时一律不动。
- **Tailwind 4：不引入**。现有 3000 多行手写 CSS 和 e2e 的 class 选择器都建立在语义类名上，换成 utility 类风险大、收益小。Rewamp 组件里的 Tailwind 类按其设计值（圆角、描边 `black/8`、投影 `0 10px 30px -8px`、弹簧参数）移植成 CSS 变量 + 语义类，写在 `src/styles/rewamp.css`（在 `index.css` 之后加载，只改外观）。
- **lucide-react：不引入**。导航与按钮用到的 9 个图标照 Lucide 路径手抄进 `src/components/rw/icons.tsx`（ISC 许可）。
- React 19 / Vite 8 / TS 6 版本都不动；Tauri identifier `com.q1f730.lingan`、Dexie 库名与 v7 schema 都没动（这次没有新 schema）。

## 用了哪些组件

| Rewamp slug | 用在哪 | 方式 | 文件 |
|---|---|---|---|
| `morphing-tab-navbar` | 手机底部导航：白色浮起胶囊，五项 图标 + 中文，选中项底下一块淡紫会滑动的底（layoutId 弹簧 420/30） | 移植（换中文 + 手抄 Lucide 图标；玻璃底色改成暖白 `--glass`） | `src/components/rw/NavBar.tsx` `layout="dock"` |
| `sidebar`（Animated Dock Sidebar） | 桌面左侧栏：logo、五页导航（选中淡紫底 + 左侧小竖条一起滑动）、搜索按钮（Ctrl K）、主题开关、快捷键提示 | 移植（原组件是 68px 纯图标 + 悬停提示；中文导航要读得出来，改成 248px 图标 + 文字常显，快捷键 Alt+1…4 / Alt+, 悬停时显示；去掉 macOS 红黄绿点与花形 logo） | `NavBar.tsx` `layout="side"`、`App.tsx` |
| `magnetic-pill-navbar` | 分段切换：穗仓 网格 / 列表 / 时间线 / 月历，设置 外观 跟随系统 / 白 / 黑（白色药丸 layoutId 滑动）；新枝页 列表 / 宣言、嫁接 几穗 用同一套样式（无滑动） | 移植 | `src/components/rw/Seg.tsx` |
| `morph-search-capsule` | ① 速记「随手拾一穗」：白色胶囊 + 内沿高光，聚焦时弹簧放大 1.015 + 淡紫光晕，点下去一圈涟漪，左侧「+」形变成闪烁光标；② 秒搜输入行同一胶囊样式（放大镜） | 移植（原组件的放大镜 ↔ 光标 SVG 形变改成加号 ↔ 光标；回车即存、补一句为什么的逻辑不变） | `src/components/QuickBar.tsx`、`rewamp.css` `.sq-line` |
| `theme-toggle` | 桌面侧栏底部的 白 / 黑 一键切换（轨道 + 弹簧圆钮，太阳 / 月亮） | 移植（去掉 lilac 光晕以外的装饰；设置里仍保留三选一） | `src/components/rw/ThemeToggle.tsx` |
| `shimmer-button` | 「嫁接这 n 穗」主按钮：一道很窄的柔光每 3 秒斜扫一次，悬停上浮 1px | 移植成纯 CSS（`::after` + keyframes，不跑 JS 循环；低端机 / 减少动效 / 禁用时不扫） | `rewamp.css` `.rw-shimmer`、`views/Develop.tsx` |
| `word-by-word-text` | 空穗仓的「穗仓还是空的」逐短语淡入、上移、去模糊 | 移植（中文按标点切短语，不拆字，读屏与查找不受影响） | `src/components/rw/WordReveal.tsx` |
| `diagonal-card-stack` | 每日一穗卡左侧：三张旧穗（缩略图或文字面）斜向叠成一小摞，悬停 / 聚焦时弹簧摊开，点它打开最上面那一穗 | 移植（只取叠放态；去掉原组件连续自动滚动的 rAF 循环与拖拽） | `src/components/rw/DailyStack.tsx`、`components/DailyCard.tsx` |
| `skeleton` | 读库时的占位：圆角浅底块 + 一道很淡的淡紫流光 | 移植 | `components/DisplayTitle.tsx` `Loading`、`rewamp.css` `.sk` |
| （导航提示气泡的进出弹簧，出自 `dark-mode-mobile-navbar` / `sidebar` 的 tooltip） | Toast：深色胶囊从底部弹起（AnimatePresence，y + scale，stiffness 500 / damping 30），撤销条底部一根淡紫倒计时线；覆盖层 Sheet / 确认弹层的弹簧进场 | 移植（只取动效参数；Toast / 弹层本身 Rewamp 没有现成组件） | `src/components/rw/Toasts.tsx`、`components/Sheet.tsx`、`components/Confirm.tsx` |

## 看过但没用（不适合）

- **Animated Backgrounds**（liquid-cursor-gradient、soft-aurora、plexus-engine、hyperspeed-warp、water-caustics… 共 20 个）：全屏持续动画 / WebGL，耗电、拖慢低端安卓，和「安静、低摩擦」相反。
- **UI for AI 的 5 个 Orb**（three.js）：嫁接等待时很想用，但 three.js 包体太大、冷启动受影响；嫁接中仍用四步文字 + 呼吸点。
- **Cursors**（pill-trail、halftone-dot）：手机没有光标；桌面也会干扰阅读。
- **Text**：kinetic-reel、character-scramble、flip-3d、velocity-marquee、gradient-reveal、spotlight、typewriter、split-text-reveal——中文标题拆字动画会影响可读与搜索高亮，只留了 word-by-word 一处。
- **Buttons**：googly-eyes、gloss、rainbow、chrome-border、neumorphic-download、book-a-call——太花或品牌感太强；slide-to-confirm 会给删除加摩擦（我们是「删掉 + 5 秒撤销」）。
- **Cards**：perspective-flip-deck、orbital-card-arch、editorial-3d-orbit、arch-card-carousel、folder-tab-card——3D 轮播不适合要快速扫读的穗仓网格（虚拟滚动 1000 穗）。
- **Navbars** 其余 9 个（hero-morph、pill-expand、pixel-dot、fluid-wave、circular-radial、curtain-reveal、jelly-scoop、liquid-underline、orbiting-planets）：要么只有图标、要么动效过强；jelly-scoop 的弹性过冲在五项中文导航上显得晃。
- **Toggles**：day-night-sky、landscape-orb、glass-orb——插画感太强，用了更克制的 theme-toggle。
- **Sidebars**：kinetic-lens、flower-sidebar——放大镜 / 花形装饰与内容抢注意力。

## 页面布局（手机 390 / 桌面 1440）

- **手机**：顶栏 logo + 搜索；底部两层浮起胶囊（速记胶囊 + 导航胶囊），渐隐到底色；内容单列，卡片 2 列 10px 间距。
- **桌面 ≥1024**：左侧栏 248px + 主区；顶栏只放 560px 速记胶囊；穗仓是真两栏（主区网格 3–4 列 14px 间距 + 右栏 320px：每日一穗、示例条、回顾、标签云，右栏吸顶）；嫁接选穗时左边已选与接法、右边控制面板，有结果时左 4 / 右 8；详情是居中的 1180px 圆角面板（左图右文）；设置 左目录 + 右分组卡片；搜索结果是圆角表格。

## 测试改动

e2e 里 v0.16 Studio 专属的视觉断言随设计更新（只改断言，不删用例）：
- `studio()`：从「0 圆角、0 阴影、不许有 svg」改为「卡片 / 弹层 / toast / 主按钮 / 速记胶囊 / chip 必须圆角，导航每项都有图标 + 中文」；旧风格元素、字体、主题检查保留。
- 布局：桌面断言左侧栏 5 项 + 顶栏速记、无底部栏；手机断言底部速记 + 5 项导航、无侧栏；导航图标数 = 5。
- 搜索命中高亮：黑底白字 → 淡紫底 `rgb(212, 203, 229)`。
- 黑主题底色：`#000` → `#17161A`。
- 新枝宣言：整页黑 → 深墨卡片 `#1F1C24` + 暖白字，且不再把整页换成黑主题。
- 新增单测 `src/__tests__/rewamp.test.ts`（导航五页 / 快捷键唯一、逐词切分不丢字）。
