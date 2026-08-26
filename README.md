# 星愿 XingYuan for DeepSeek Harness

[![npm version](https://img.shields.io/npm/v/@starwish-ai/dsh)](https://www.npmjs.com/package/@starwish-ai/dsh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/starwish-ai/dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/starwish-ai/dsh/actions/workflows/ci.yml)

XingYuan (星愿) is a wish & habit companion shipped as a DeepSeek Harness plugin bundle + agent preset.

把星愿核心体验整体移植为 dsh 组合包（bundle）+ Agent Preset：AI 对话创建愿望/任务、机会日打卡、记忆、HITL 确认、图表与会话内今日/愿望/日历/成长页面。

## 安装

```sh
dsh plugin --profile <name> add @starwish-ai/dsh
```

启动 Web GUI 后，agent 选择器出现「星愿」即安装成功。业务数据存于 `~/.dsh/xingyuan/xingyuan.sqlite`（卸载/升级均存活；备份 = 拷贝该目录）。

## 界面

- **会话视图页**：会话顶部标签页「今日 / 愿望 / 任务 / 日历 / 成长 / 记忆」，无需对话即可查看与操作——打卡、领取、补卡、取消打卡均为页面按钮直连动作接口（用户点击即本人确认，不经模型）。
- **成长中心**：等级体系（Lv.1 初心者 → Lv.10 星愿大师，经验 = 每条打卡记录 10 × 连击加成 1.2/1.5，与云端版统计口径逐用例对拍）+ 七项统计卡 + 近 30 天柱状图 + 等级说明；对话内 `get_growth_stats` 同口径可答。
- **深浅色适配**：卡片与页面颜色全部使用壳主题令牌（--dsw-alias-*），跟随应用深色模式；独立 HTML 页面（/xingyuan/today 等，URL 直开备用入口）跟随系统深浅色。分类徽章走 HSL 变量分层（JS 供色相/饱和度、CSS 按主题供亮度），与 Web 端实现同构。
- **品牌一致性**：强调色与星愿 Web 端 primary 蓝系同源（浅 `#1a6fe0` / 深 `#60a5fa`，前景对比 ≥4.5:1），壳内视图页、会话卡与 standalone 页三处统一。
- **分类色板 22 键**：与 Web `wish-category.ts` 预设一一对应；未选色的分类按分类名哈希取稳定色相，老数据零迁移兼容。
- **轻提示与状态反馈**：写操作成功 toast 带实际落账日期（对齐 Web「打卡成功（YYYY-MM-DD）」语义）；会话任务卡领取后原地转为可打卡态（领取 ≠ 完成）；页面四态齐全（骨架屏 / 错误重试 / 空态引导 / 数据列表）。
- **标签页/设置页规范重构**：按 Web Interface Guidelines 全量过审——表单控件补齐可见标签与 aria-label、切换按钮暴露 `aria-expanded`/`aria-controls`、分段选择用 `aria-pressed`；日历拾取详情改为 加载骨架/错误重试/详情 三态闭环（不再静默吞错），月份标题与星期经 `Intl.DateTimeFormat` 本地化；成长页图表区分「加载中」与「暂无数据」（等高骨架防位移）；分类改名/配色成功后愿望列表同步刷新（数据闭环）；记忆页编辑自动聚焦内容框；设置页保存按钮带进行态、注入上限支持 Enter 提交。宽度稳定：卡片头收缩链 + `overflow-wrap` 长词断行 + 搜索框 `min()` 宽度 + 触控 `touch-action: manipulation`。
- **全页面严格复审·闭环加固**：布局/状态/数据/审美四路专项审查落地——领域错误携带稳定 `code`（含新增 `task_closed`）经路由透传，会话卡状态恢复与记忆覆盖重试不再依赖中文文案子串；HTTP 面 `cycle` 改发原始枚举（英文界面不再露出「每日」等中文标签），独立备用页内联映射；愿望卡补删除动作（`delete-wish` 端点闭环启用）；今日/任务行 busy 窗口延伸到刷新完成（防陈旧双击）；日历切月/快速连点双竞态守卫 + 详情面板 `aria-live`；成长页图表空数据可达、图例改为柱体语义（已打卡/未完成缺口）、区间接口失败不拖垮英雄卡与统计；记忆页「加载更多」代数守卫、表单校验就地 `role=alert`、清空防重入；设置页档案加载守卫、注入上限越界就地报错、二次确认开关乐观写；分类管理取数骨架屏、改名 Enter/Esc 键盘闭环、「跟随愿望」反馈如实化；色板统一共享 `SwatchRow`（24px 命中目标、`aria-pressed`、22 键本地化颜色名）；详情面板骨架加载、打卡网格读屏一句汇总 + 可见图例、操作区两段式且删除右置；样式回归节奏锁（padding 18/20 · 区块间 14 · 圆角四档 12/9/8/999 清除漂移）。
- **今日/任务页分组卡改版**：任务页三状态分桶升级为分组卡（状态点 + 标题 + 计数胶囊的卡片头，任务行两栏网格：名称/元信息居左、动作簇右置），行间以分隔线呈现于卡内，替代裸堆叠的 section-title + wishtasks；今日页新增「今日概览卡」（标题、完成计数与进度条同卡 + 品牌色轻晕染），进度条带 `role=progressbar` 语义且不再作为裸条悬在页头下（修复 0% 时形似「空白横条」的问题），待完成/已完成两组复用同一分组卡语言。
- **全标签页面板化收口**：愿望卡子任务与任务页统一为同一两栏网格行语法并以分隔线分行；日历月历收进面板卡、日期详情面板升级为附卡且任务行改用分组卡行；成长页近 30 天图表三态整体收进面板卡；记忆页添加表单收进虚线书写卡、列表改为单张分组卡分隔线行（高重要度 ★ 改琥珀警示色，不再与完成勾撞绿色）；设置页三节（教练风格/画像/对话偏好）各自成面板卡并统一卡内纵向节奏——六个标签页与设置页再无裸堆叠区块。
- **写操作二次确认**：创建愿望/任务、打卡、取消打卡经系统确认卡确认（可在 设置 → 星愿 关闭）；删除始终确认。
- **设置**：设置 → 星愿 整页（教练风格、昵称/职业/兴趣画像、二次确认开关、记忆注入上限）。

## Model Experience

### What the model sees

- **工具**：45 个星愿工具挂 preset 层（愿望 13 / 任务 16 / 微行动 3 / 记忆 6 / 配置 4 / 成长 1 / 图表 1 / 汇总 1），仅选择「星愿」的会话可见，不污染编程会话。
- **进度恒新鲜**：愿望/任务读路径按今日重算状态与完成率（写路径照旧落库），跨多日回来模型报告的也是最新口径。

### Token effect

静态分节约 4.5k tokens（一次性进 system prompt）；动态上下文随数据量浮动（记忆注入上限可配）。

### KV Cache effect

全部分节为稳定顺序的静态文本 + 少量尾部动态上下文，前缀稳定利于缓存命中；工具 schema 仅 preset 会话装载。

## 与云端版的实现差异（体验对齐）

- `updateWishCategory` 并入 `update_wish`：本地分类颜色随愿望存储，改分类时以可选 `colorKey` 参数同时指定，避免两个工具覆盖同一写路径。
- 云端内部工具 `syncWishProgress` 不设独立工具：本地单写者、每次写操作后自动重算，读取侧再新鲜化，手动同步无意义。
- 定时提醒：harness schedule 仅一次性触发且 session-local（见 Known Limitations）；提示词已按此如实改写。

## Known Limitations

- 周期提醒不支持：harness schedule 仅一次性触发（`at`/`every_seconds`）且 session-local；以今日页 + 开场「今日应打卡」概览兜底，提示词已如实告知模型。
- 存储无迁移机制：领域版本 v1 一次定死，介质版本不符直接拒绝打开。
- 打卡确认依赖 userQuestions 的 UI provider（Web GUI 自带）；headless 单发任务无确认界面时自动放行。
- preset 发布副本残留：preset 以内容指纹发布到 `~/.dsh/.agent-presets/xingyuan`（多 profile 共享，卸载时自动删除会误伤其它 profile），`dsh plugin remove` 后选择器仍可能显示「星愿」——手动删除该目录即可彻底清理。

## 开发

```sh
pnpm install && pnpm build && pnpm test
```

Loader 级组合测试（test/loader.test.ts）经 cordis-plugin-loader 以发布形态装载 `lib/` 产物，
断言工具注册、落库回读与逐行 dispose 清理——先构建再测试。

