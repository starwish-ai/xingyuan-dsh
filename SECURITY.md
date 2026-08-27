# 安全策略 · Security Policy

## 报告漏洞

请使用 GitHub 的 **Private vulnerability reporting**（仓库 Security 标签页 → Report a
vulnerability）私下报告，不要在公开 Issue 中描述可利用细节。维护者会在 7 天内响应。

For vulnerabilities, please use GitHub's private vulnerability reporting rather than
public issues. Expect a response within 7 days.

## 范围说明

星愿是本地插件：业务数据仅存于用户机器的 SQLite 文件（`~/.dsh/xingyuan/`），不内置任何
遥测或凭据收集。模型凭据完全复用 dsh 自带的「设置 → 模型」，不在本项目范围内存储。

值得报告的问题示例：HTTP 路由面（`/xingyuan/api/*`）的越权或注入、提示词注入导致未确认
写操作、打包产物与声明不符。样式错位、功能建议请走普通 Issue。

## 支持版本

最新的稳定 minor 版本接收安全修复（当前为 0.5.x）。
