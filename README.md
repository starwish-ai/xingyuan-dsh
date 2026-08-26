# 星愿 XingYuan for DeepSeek Harness

[![npm version](https://img.shields.io/npm/v/@starwish-ai/dsh)](https://www.npmjs.com/package/@starwish-ai/dsh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/starwish-ai/XingYuan-Dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/starwish-ai/XingYuan-Dsh/actions/workflows/ci.yml)

简体中文 | [English](./README.en-US.md)

星愿是一个愿望与习惯养成助手，以 DeepSeek Harness 插件组合包 + Agent Preset 形式交付。

## 功能

- **对话驱动**：自然语言创建愿望 / 任务，自动查重相似项
- **机会日打卡**：周期任务打卡、补卡、取消、未来预勾，进度跨天恒为最新
- **成长体系**：等级 Lv.1–Lv.10、连击加成、统计卡与近 30 天柱状图
- **会话视图页**：今日 / 愿望 / 任务 / 日历 / 成长 / 记忆 六个标签页，页面按钮直连动作接口
- **记忆**：重要记忆自动注入上下文（上限可配），支持增删改查
- **图表**：15 种统计图表自动渲染为卡片
- **安全确认**：写操作默认二次确认（可关闭），删除始终确认
- **主题适配**：深浅色跟随应用主题

工具只挂载在选择星愿 preset 的会话上，不影响其他会话。

## 安装

```sh
dsh plugin --profile <name> add @starwish-ai/dsh
```

启动 Web GUI 后，agent 选择器出现「星愿」即安装成功。

## 数据与备份

业务数据存于 `~/.dsh/xingyuan/xingyuan.sqlite`，卸载 / 升级均存活，备份只需拷贝该目录。

## 设置（Web GUI → 设置 → 星愿）

| 配置项 | 说明 |
| --- | --- |
| 教练风格 | 温柔 / 幽默 / 严格 |
| 用户画像 | 昵称、职业、兴趣 |
| 写操作二次确认 | 创建 / 打卡类写操作是否确认（删除始终确认） |
| 记忆注入上限 | 每次注入上下文的记忆条数上限 |

## 已知限制

- 周期提醒不支持：harness schedule 仅一次性触发且 session-local
- 存储无迁移机制：介质版本不符直接拒绝打开
- headless 场景无确认界面时，打卡确认自动放行

## 开发

```sh
pnpm install
pnpm build   # tsc + tsdown（集成测试依赖 lib/ 产物）
pnpm test    # vitest
```

发布：推送 `v*` tag 自动构建并发布到 npm（预发布版本挂 `alpha` tag）。

## License

[MIT](./LICENSE)
