# 贡献指南 · Contributing

感谢关注星愿！欢迎 Issue 与 PR。开始前请读一遍 [AGENTS.md](./AGENTS.md) —— 它是本仓库的权威开发文档（分层架构、领域口径、客户端纪律都在里面）。

Thanks for your interest! Issues and PRs are welcome. Please read [AGENTS.md](./AGENTS.md) first — it is the authoritative development doc for this repo (architecture layers, domain semantics, client-side discipline). This guide below is available in Chinese only; PR descriptions in English or Chinese are both fine.

## 开发环境

- Node ≥ 22.5、pnpm 10

```sh
pnpm install
pnpm build      # tsc + tsdown，产出 lib/
pnpm typecheck
pnpm test       # vitest；集成测试依赖 lib/，务必先 build 后 test
```

提交前的最低门禁：`pnpm typecheck && pnpm build && pnpm test` 全绿。

## 改动注意

- 业务写入必须走 `src/store.ts` 用例收口，工具面与路由面不得各写一份。
- 读侧统一「新鲜化」口径：状态与进度按今日重算，按钮态与写路径校验一致。
- 客户端视觉改动走 mock 验证回路（`npx vite-node debug/gen-mock.ts`，见 AGENTS.md §5.10）。
- 新增工具请同步 AGENTS.md §6 清单、prompts 能力段与 README 功能列表。

## 提交与发布

- Commit 风格：Conventional Commits（如 `feat(ui): …`、`fix(store): …`）。
- 发布由维护者执行：推送 `v*` tag 触发 CI 构建、测试并发布到 npm
  （预发布版本挂 `alpha` dist-tag）。

## License

提交即表示同意以 [MIT](./LICENSE) 许可证授权你的贡献。
