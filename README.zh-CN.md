# DevMoter FAST

**随时随地控制你的 AI 编程代理。📱**

[English](./README.md) | [日本語](./README.ja.md) | **简体中文**

DevMoter FAST 是一个面向移动设备的 **Codex 与 OpenCode 远程界面**。编程代理运行在你的 Linux 主机上，你可以通过手机、平板或桌面浏览器使用同一个轻量 Web UI 进行控制。

**Codex + OpenCode · PWA · English / 日本語 / 简体中文 · Open source**

> [!IMPORTANT]
> DevMoter FAST 是一个**实验性的非官方社区项目**。它与 OpenAI、OpenCode 或软件中提到的其他上游项目 / 服务提供方不存在隶属、赞助或官方认可关系。

> [!WARNING]
> DevMoter 面向**单用户私有主机 / 私有网络**场景。DevMoter 现在要求独立的 HTTP 登录，但它仍是私有部署的单用户访问边界，而不是面向公网多用户服务的授权系统。请不要把 DevMoter、OpenCode 或代理后端直接暴露到公网。

## 开始使用

- ⚡ **快速安装:** [fastinstall.MD](./fastinstall.MD)
- 🔐 **安全策略与漏洞报告:** [SECURITY.md](./SECURITY.md)
- 📜 **第三方许可与互操作说明:** [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

> [!CAUTION]
> **Alpha 安全提示:** 安全审查仍在进行中，并且当前存在已知限制。请仅在可信的私有网络中使用。如果发现安全问题，请不要在公开 Issue 中发布利用细节、密钥或其他敏感信息，并按照 [SECURITY.md](./SECURITY.md) 进行报告。

## 当前功能

- OpenCode：会话、代理、模型选择、命令、skills、实时事件、推理 / 工具活动、权限请求、问题流程和中断
- Codex：线程历史、新建 / 恢复 / fork、模型选择、推理强度、流式响应、中断、审批、附件、插件 / MCP 状态
- Projects：注册 / 创建项目、选择工作目录、安全浏览与编辑 Markdown
- GitHub：使用主机上的 `gh` 登录状态浏览并打开仓库
- PWA：移动优先、可安装、在线 / 离线状态
- UI 语言：English / 日本語 / 简体中文
- 自动化测试、coverage、build 与 GitHub Actions CI

DevMoter FAST 目前处于 **Alpha / active development**。上游协议变化、粗糙的 UI 边角以及版本相关兼容问题仍可能出现。

## 快速启动

### 环境要求

Linux 环境需要：

- Node.js 与 npm
- OpenCode CLI
- OpenAI Codex CLI
- Python 3
- `curl`

如需使用 GitHub 仓库功能，请安装并使用你自己的 GitHub 账号登录 GitHub CLI：

```bash
gh auth login
gh auth status
```

本地 Codex / OpenCode CLI 应按照各自上游工具支持的正式方式完成认证与配置。

### 上游账号与条款

DevMoter FAST **不会提供、转售、共享或捆绑**任何上游账号、订阅、API key、登录 token 或其他凭据。

每位用户都应：

- 使用自己具有使用资格的账号
- 使用上游工具支持的认证流程
- 遵守适用的服务条款、年龄要求、使用政策与账号规则
- 不共享或借用他人的账号凭据

### 1. Clone

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
```

### 2. 启动

```bash
bash scripts/start-pocket.sh
```

默认本地地址：

```text
DevMoter:  http://127.0.0.1:8787
OpenCode:  http://127.0.0.1:49374
```

Codex app-server 由 DevMoter 通过本地 stdio 启动和通信，不直接作为公网 socket 暴露。

DevMoter 默认用户名为 `devmoter`。启动脚本会把生成的密码以仅 owner 可读的权限保存到 `~/.config/opencode-pocket/devmoter-auth-password`，首次打开 DevMoter 时浏览器会要求登录。

## 手机私有访问

推荐保持 DevMoter 绑定 localhost，并使用 Tailscale Serve：

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

然后从同一 tailnet 中的设备打开显示的 HTTPS 地址。

> [!CAUTION]
> 即使启用了 DevMoter HTTP 登录，当前 Alpha 版本仍不建议通过公共 tunnel 或 Tailscale Funnel 暴露服务。推荐保持 localhost，并通过 Tailscale Serve 等 HTTPS 私有网络入口访问。

## 架构

```text
Phone / tablet / desktop browser / PWA
                  │
                  │ HTTPS via Tailscale Serve (optional)
                  ▼
          DevMoter FAST :8787
            127.0.0.1 default
              │       │
              ▼       ▼
          OpenCode   Codex
            HTTP     stdio
          :49374   app-server
              │       │
              └───┬───┘
                  │
             local projects
```

浏览器只与 DevMoter 通信。代理进程、本地路径以及后端凭据保留在主机侧。

## 安全模型

当前主要安全边界包括：

- DevMoter 默认仅绑定 `127.0.0.1`
- DevMoter 要求独立 HTTP 登录
- 状态变更请求必须通过严格的同源 Origin 检查
- API 响应使用 `no-store`，已配置的秘密会从错误响应中脱敏
- OpenCode 仅绑定 localhost
- Codex app-server 使用 stdio
- 后端凭据保留在服务端
- Codex RPC 使用 allowlist
- 项目路径被限制在用户 home 目录内
- 移动编辑器只能在已注册项目内写入 Markdown
- GitHub token 不会返回给浏览器

**重要限制：** DevMoter 登录是单用户访问边界。通过登录的客户端可以使用代理已经获得的权限。远程访问必须使用 HTTPS，推荐 localhost + Tailscale Serve；如果反向代理改变了外部 Origin，请显式设置 `DEVMOTER_PUBLIC_ORIGIN`。

## 测试

```bash
npm test
npm run test:coverage
npm run build
```

GitHub Actions 也会执行自动检查。项目尽量让 backend safety、bridge 与兼容性测试在不需要真实 Codex / OpenCode 账号的情况下运行。

## 开发

```bash
npm install
npm run dev:server
```

另一个终端：

```bash
npm run dev:web
```

当前 package version: **0.2.0**

## 兼容性

DevMoter 依赖 OpenCode 和 Codex app-server 的上游协议，因此上游版本变化可能导致兼容问题。提交 Issue 时，请提供 DevMoter commit、OpenCode / Codex 版本、浏览器 / PWA 环境以及准确错误信息。

## 参与贡献

欢迎 Issue、bug 报告、协议 / 兼容性信息、文档改进和 Pull Request。

请勿在公开 Issue 中发布 API key、登录 token、Tailscale 凭据、生成的 OpenCode password、DevMoter login password 或其他秘密信息。

## AI-assisted development

本项目大量使用 AI 辅助实现、调试、协议研究、测试和迭代；产品方向、需求、真实设备测试、发布决策和维护由人类负责。

## 许可证

DevMoter FAST 使用 **MIT License**。详见 [LICENSE](./LICENSE)。
