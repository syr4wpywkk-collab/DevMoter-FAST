# DevMoter FAST

**把编程代理装进一个口袋大小的控制平面。📱**

[![CI](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml/badge.svg)](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml)

[English](./README.md) · [日本語](./README.ja.md) · **简体中文**

> **Version track:** v3.0.0-alpha 系列  
> **Status:** active development / pre-release

Alpha 轨道表示产品/发布成熟度。`package.json` 中的 `0.2.0` 是独立的 npm 包版本，不代表 v3 产品轨道或稳定版发布。

DevMoter FAST 是一个用于统一控制编程代理与开发工具的**开源、自托管、移动优先控制平面**。

Codex、OpenCode、仓库、凭据、终端、Git 工作流和主机集成继续留在 Linux 主机上；手机、平板、PWA 或浏览器只负责控制。

这是新的产品世代，而不只是“远程聊天界面”加上更多按钮。DevMoter 正在成为连接你、编程代理、仓库与运行主机的**运营层**，把**代理会话、Projects、Git/GitHub、Reviewed Changes、模型路由、自动化、本地工具和显式安全边界**统一到一个 mobile-first 界面中。

> [!IMPORTANT]
> DevMoter FAST 是非官方社区项目，与 OpenAI、OpenCode、GitHub、Anthropic、Google、Tailscale 及其他提及的服务提供方不存在隶属、赞助或认可关系。

> [!WARNING]
> 当前 DevMoter 面向**单用户私有主机 / 私有网络**。默认保持 localhost；远程使用时推荐 Tailscale Serve 等私有 HTTPS。不要将 DevMoter 或代理后端直接暴露到公网。

## 为什么是 v3？

第一代验证了核心想法：在 Linux 主机上启动 Coding Agent，然后从手机远程控制。

v3 将这个想法扩展为真正的**控制平面**：

- 不再只有一个聊天界面，而是支持多个 Agent backend；
- 不接受浏览器任意传入的 cwd，而是围绕 Project 管理会话；
- 不再依赖复制粘贴 patch，而是进入 Git/GitHub 工作流；
- 引入 Reviewed Changes、worktree 与面向 PR 的任务流程；
- 支持 model/provider routing 与 API Chat；
- 提供 persistent terminal 与 project context 工具；
- 提供 host integration 与 bounded automation；
- 强化 Origin、filesystem、RPC、credential 与 approval 边界；
- 从一开始按 mobile-first 设计，而不是把桌面 UI 挤进手机屏幕。

目标很简单：

**让开发机继续运行，把控制平面带在身边。**

## 30 秒架构

```text
Phone / tablet / browser / PWA / iOS client
              │
              │ private HTTPS
              ▼
       ┌───────────────────┐
       │   DevMoter FAST   │
       │ mobile control    │
       │      plane        │
       └─────────┬─────────┘
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
     Codex    OpenCode   API Chat
       │         │         │
       └─────────┼─────────┘
                 ▼
     Projects · Git · Reviews
      Terminal · Tools · Tasks
                 │
                 ▼
             Linux host
```

浏览器是控制器，不是开发机。Local path、Agent process、provider credential、repository state 和 host tool 都保留在主机侧。

## 基本工作流

典型流程：

**在主机开始任务 → 离开电脑 → 检查进度 → 审批/中断 → 切换 Agent、Model 或 Project → 审查变更 → 从手机继续。**

尤其适合：

- Linux workstation；
- Chromebook + Crostini；
- home server；
- 常开开发机；
- 希望保留本地开发环境，但只随身携带控制界面的用户。

## 功能状态

DevMoter 明确区分 **Shipped / Experimental / Planned**。UI 中出现入口，或者仓库里存在设计文档，并不代表该能力已经 production ready。

| 功能 | 状态 | 当前范围 |
| --- | --- | --- |
| OpenCode | ✅ Shipped | sessions、agents、models/providers、modes、commands、skills、streaming、permissions/questions、interrupt |
| Codex | ✅ Shipped | threads、resume/fork、动态 model discovery、reasoning effort、streaming、approvals、attachments、plugins/MCP inventory |
| Projects | ✅ Shipped | registered working directory、project switching、有边界的 Markdown 浏览/编辑 |
| GitHub workspace | 🧪 Experimental | host-`gh` repo discovery、managed clone/open、branch/fetch safety checks |
| Tools AI | 🧪 Experimental | 把自然语言目标路由到有边界的 Project / Host 观察（Git 变更、已保存索引搜索、project map、Markdown 读取、固定 host 诊断） |
| Session control | 🧪 Experimental | handoff、follow-up、checkpoint、rewind/fork、transcript search、background-run controls |
| Reviewed Changes / Tasks | 🧪 Experimental | proposal review、hunk decision、drift check、apply/commit、worktree、PR flow |
| Project context / local index | 🧪 Experimental | bounded project search、structure/symbol context、local indexing |
| Persistent terminal | 🧪 Experimental | authenticated project-scoped terminal、bounded replay、reconnect |
| Remote browser | 🧪 Experimental | 需 `DEVMOTER_BROWSER_AUTOMATION=1` 选择启用；仅限项目的 loopback live preview；手机端画面串流、点击/滚动/IME 输入、用户接管、经 `devmoter browser-mcp` 的 agent 操作。详见 [Remote browser](./docs/REMOTE_BROWSER.md) |
| API Chat / model routing | 🧪 Experimental | configurable provider/model、reasoning mode、routing/failover、image attachment |
| Qwen Code | 🧪 Experimental | 本地 Qwen Code CLI 聊天（streaming、stop、设备内聊天历史、model 选择、“Add API”）与 Local Integrations 启动卡；需要本地安装 Qwen Code CLI；UI 默认隐藏（feature flag） |
| Developer workflows | 🧪 Experimental | Skills、Rules、MCP 管理、可选 ACP、Extensions、验证/审查工作流；成熟度因功能而异 |
| Host protocol | 🧪 Experimental | 版本化 capability discovery；adapter 的支持程度不一 |
| Automation / control plane | 🧪 Experimental | host registry、schedule/trigger、bounded automation primitive |
| Antigravity / Claude 集成 | 🧪 Experimental | local integration discovery、部分 launch/remote handoff flow |
| PWA / mobile UI | ✅ Shipped | responsive UI、backend switching、reconnect、installable shell |
| Passkey / device controls | 🧪 Experimental | 辅助设备控制；不是公网 multi-user 授权系统 |
| GitHub / Google / Microsoft 登录 | 🧪 Experimental | 需要自行配置 OAuth 应用（OIDC + PKCE），默认未启用；另有 Passkey 与本地恢复。详见 [Auth v2](./docs/auth-v2.md) |
| iOS client | 🧪 Experimental | 通过 HTTPS 连接既有 DevMoter server 的原生 wrapper；需要真机验证 |
| Library | 🗺️ Planned | storage/library surface 尚未实现 |
| Apple 登录 | 🗺️ Planned | 尚未实现 |

> [!NOTE]
> 上游能力是动态的。例如 Codex model picker 使用本机安装的 Codex app-server 实际公布的模型，而不是由 DevMoter 虚构模型可用性。

## Agent surfaces

### Codex

DevMoter 通过 stdio/JSONL 与本地 Codex app-server 通信。

当前主要集成包括：

- thread 创建、history、resume、fork；
- streamed turn 与 interrupt；
- approval；
- attachment；
- dynamic model discovery；
- model-advertised reasoning effort；
- plugin/MCP inventory；
- 在 upstream app-server 提供的范围内显示 usage/rate-limit metadata。

Codex RPC 必须经过明确的 server-side allowlist。认证仍由本地 Codex CLI 负责。

### OpenCode

DevMoter 代理 localhost 上的 OpenCode runtime，同时避免把 backend credential 暴露给浏览器。

mobile surface 支持：

- sessions / agents；
- Plan / Ask / Build；
- provider / model selection；
- commands / skills；
- live text / reasoning / tool activity；
- permission request / question；
- interrupt。

### Qwen Code

Experimental 的 Qwen Code 集成使用本地安装的 [Qwen Code](https://github.com/QwenLM/qwen-code) CLI（`qwen`；可通过 `QWEN_BIN` 覆盖二进制路径）。它不使用 API Chat 的 provider store。

> **当前默认：** Qwen Code 的 UI 默认被 feature flag `QWEN_UI_ENABLED`（`src/feature-flags.mjs`，当前为 `false`）隐藏。下述集成已经实现，但在启用该 flag 之前，不会出现在 AI 选择器、导航或 Local Integrations 中。

- **AI 选择器聊天：** 在 AI 选择器中选择 *Qwen Code*。server 在所选 registered project 中以 headless 方式运行 `qwen`（`--output-format stream-json`）并流式返回回复。可从 UI 停止，单次运行上限 30 分钟；每个聊天保留自己的 Qwen session 并通过 `--resume` 恢复。聊天历史保存在设备上。若 `qwen` 未安装或未登录，界面会显示简短提示和一个打开 Local Integrations 的按钮。
- **Model 选择：** Qwen 聊天界面的 model chip 会列出 “Qwen Code default” 以及 Qwen Code 自身 `settings.json`（`modelProviders`）中定义的模型。不可用的模型会带原因禁用显示。client 只发送 auth type 与 model ID；server 会重新校验，并且只把 `--auth-type` 与 `--model` 传给 `qwen`。
- **Add API：** 提供与 Qwen Code `/auth` 相同的 provider preset，并像 `/auth` 一样把 provider 与 key 写入 Qwen Code 自身的设置。API key 不会出现在命令行参数中，也不会返回浏览器。
- **Local Integrations：** Qwen Code 卡片可在主机终端中启动本地 `qwen` CLI（“在 PC 上打开”）。子进程只接收 allowlist 内的环境变量。

并非所有 Qwen Code 版本与 provider 组合都经过验证；请把这个 surface 当作 experimental。

### API Chat

Experimental 的 multi-provider 界面，用一个紧凑 surface 处理 model、reasoning control、routing 与 attachment。

保存后的 provider credential 保留在 server-side，不会再次返回 frontend。

## Projects / Git / Reviewed Changes

DevMoter 不接受浏览器任意传入的 `cwd`，而是使用已注册的 **Project ID**。

主要边界包括：

- registered project 限制在用户 home directory 内；
- 拒绝 traversal / project-root escape；
- 敏感文件操作检查 symlink boundary；
- local project read 有明确上限；
- mobile editor write 被刻意限制；
- GitHub clone 限制在 managed repository root；
- dirty worktree 会在必要时阻止危险复用或破坏性操作。

Experimental 的 Reviewed Changes 工作流包括：

1. proposed changes；
2. file / hunk 级 review；
3. context drift validation；
4. explicit apply；
5. commit validation；
6. managed task worktree；
7. 面向 PR 的 task flow。

目标不是把自主修改藏起来，而是让关键 mutation **可检查、有限制**。

## Local context / Terminal

v3 还加入了聊天之外的 host-local developer surface。

Experimental 能力包括：

- project structure / symbol context；
- bounded local full-text index；
- sensitive/vendor path exclusion；
- 可 reconnect 的 project-scoped terminal；
- bounded terminal output replay；
- mobile-friendly terminal control。

这些能力围绕 registered project boundary 设计，而不是提供 unrestricted browser-side shell。

Tools AI 接受自然语言目标，并把它路由到受支持的有边界观察，例如 Git 变更、已保存索引搜索、project map、Markdown 读取与固定 host 诊断。它不是 unrestricted autonomous shell。运行状态、取消行为、重连行为与限制见 [Tools AI v1 契约](./docs/tools-ai-v1.md)。

## Host protocol

经认证的 `GET /api/host` endpoint 会返回版本化的 capability snapshot。Client 必须依据公布的 capability state，而不是从操作系统推断支持情况。

Host Protocol v1 是**发现契约（discovery contract）**，不是对所有既有 API 的统一替代。某些 capability family 在特定 adapter 上不可用或只部分实现。例如，当前文档标明了 Linux 支持、受约束的 WSL 行为，以及尚未实现的原生 macOS adapter。Secret Vault 管理面也有已记录的限制，还不是通用的 provider/agent secret 注入系统。

确切契约与限制见 [Host Protocol v1](./docs/HOST_PROTOCOL.md)。

## Automation / Integrations

v3 architecture 包含一层 Experimental control-plane，用于 host integration 与 automation。

例如：

- host registry；
- bounded schedule / trigger；
- explicit integration discovery；
- selected launch / remote handoff；
- 在受支持的 agent/model surface 之间 routing。

Automation 不是绕过 authorization boundary 的理由。影响越大的操作，越应该 explicit、scoped、auditable。

## 安全模型

DevMoter 当前假设**已认证用户就是主机所有者**。它不是公网 multi-tenant SaaS 授权系统。

主要安全边界：

- 默认 localhost bind；
- DevMoter 自身认证；
- state-changing request 的 exact-origin check；
- secret-bearing/API response 使用 `no-store`；
- provider credential 保留 server-side；
- OpenCode credential 不返回浏览器；
- Codex 使用 stdio + RPC allowlist；
- registered-project filesystem boundary；
- 敏感路径上的 realpath/symlink containment check；
- attachment 保留在 host-local；
- GitHub credential 保留在主机 `gh` session；
- host integration 使用 fixed-argument launcher，而不是接受浏览器任意 shell command；
- bounded approval / task workflow。

远程部署前，请阅读 **[SECURITY.md](./SECURITY.md)** 与 **[THREAT_MODEL.md](./THREAT_MODEL.md)**。

### 关于 Alpha

v3.0.0-alpha 系列仍然是 development software。

Security / integration audit 仍在持续。Experimental surface 可能发生变化，而 Codex/OpenCode/CLI 等上游行为也可能独立于 DevMoter 演进。

请把 `main` 当作 development branch，而不是 hardened public service。

## 最快启动

### 要求

- Linux
- Node.js 22 + npm
- Git
- Python 3
- `curl`
- OpenCode CLI
- OpenAI Codex CLI

可选：

- GitHub CLI (`gh`)：repository integration；
- Tailscale：private phone access；
- Qwen Code CLI (`qwen`)：Qwen Code 集成（UI 默认隐藏）。

启动 DevMoter 前，请先按照各 upstream CLI 自己支持的方式完成认证。

### Install

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
npm ci
bash scripts/start-pocket.sh
```

然后打开：

```text
http://127.0.0.1:8787
```

正常 launcher 会完成 build、local auth 准备、必要的 local runtime 启动、DevMoter 启动与 readiness check。

最短安装流程见 **[Fast Install](./fastinstall.MD)**；systemd 与更新操作见 **[Operations](./docs/operations.md)**。

## 手机私有访问

DevMoter 以 localhost 运行为默认模式。

安装 Tailscale 后，**先检查现有 Serve/Funnel 路由**，不要重置其他服务的配置：

```bash
tailscale serve status
tailscale serve get-config --all
```

确认没有冲突的路由后，再配置 DevMoter 的私有 Serve：

```bash
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status --json
```

如果路由冲突，请保留已有配置，并由所有者确认如何处理。

在同一 tailnet 的设备上打开输出的 private HTTPS URL。

> [!CAUTION]
> 当前 Alpha 不推荐 Tailscale Funnel 或任意 public tunnel。DevMoter login 是 single-user access boundary，不是公网 SaaS 授权系统。

## iOS client

仓库包含一个 iOS client，通过 HTTPS 连接已经在运行的 DevMoter server。它**不会**在 iPhone 上运行 Linux server 或 coding agent。IPA 由 GitHub Actions 生成；安装/签名与真机检查是独立步骤。详见 [iPhone / AltStore 说明](./docs/ios-altstore.md) 与 [Linux 到 iPhone 指南](./docs/iphone-linux.ja.md)。不要把 Linux build 成功或 IPA artifact 生成当作真机兼容性的证明。

## 文档

| Document | 内容 |
| --- | --- |
| [Architecture](./ARCHITECTURE.md) | process / browser / agent / filesystem boundary |
| [Security](./SECURITY.md) | deployment assumption / vulnerability reporting |
| [Threat model](./THREAT_MODEL.md) | trust boundary / attacker model |
| [Fast Install](./fastinstall.MD) | 最短安装路径 |
| [Operations](./docs/operations.md) | systemd / update / operation |
| [Host Protocol v1](./docs/HOST_PROTOCOL.md) | capability discovery 与 adapter 限制 |
| [Tools AI v1](./docs/tools-ai-v1.md) | Tools AI 契约、cancel、数据处理、限制 |
| [Developer workflows](./docs/developer-workflows.md) | extensions / MCP / ACP / skills / rules |
| [iOS / AltStore](./docs/ios-altstore.md) | iOS client build / install |
| [Linux to iPhone](./docs/iphone-linux.ja.md) | 从 Linux 向 iPhone 导入的 walkthrough |
| [Browser automation sandbox](./docs/BROWSER_AUTOMATION_SANDBOX.md) | browser automation boundary |
| [Remote-control security](./docs/remote-control-security.md) | host registry / automation security |
| [Auth v2](./docs/auth-v2.md) | owner sign-in：GitHub / Google / Microsoft、passkey、local recovery |
| [Release smoke](./RELEASE_SMOKE.md) | 真机 release checklist |
| [Roadmap](./ROADMAP.md) | 当前方向 / maturity gate |

## 开发

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Coverage:

```bash
npm run test:coverage
```

CI 负责自动化检查。Chromebook/Crostini + iPhone 的真实设备行为仍通过手动 [Release Smoke](./RELEASE_SMOKE.md) 验证。

## Compatibility

DevMoter 集成的 upstream tool 协议可能发生变化。

兼容性处理覆盖例如：

- event envelope；
- streaming；
- approval；
- image / attachment；
- model change；
- plugin / MCP inventory；
- provider metadata；
- version-sensitive RPC behavior。

报告兼容性问题时，请附上：

- DevMoter commit；
- relevant Codex/OpenCode version；
- browser/PWA environment；
- exact error text；
- 触发问题的操作。

请勿附带 API key、token、generated password、private repository 内容或其他 secret。

## Project principles

1. **Host-local by default.** Credential 与 coding process 保留在自己的机器上。
2. **Mobile is a first-class control surface.** 不把桌面页面简单挤进手机屏幕。
3. **Agent actions need boundaries.** Filesystem、Git、RPC、automation、approval 与 host integration 应默认 fail closed。
4. **Important mutations should be inspectable.** 与不可见自动化相比，优先 review 与 explicit consent。
5. **No fake capability.** Planned 或 upstream-dependent 的能力应诚实标注。
6. **Interoperability over lock-in.** 优先连接现有 developer tool，而不是假装替代一切。

## AI-assisted development

DevMoter FAST 大量使用 AI 辅助实现、debug、protocol research、test、review 与 iteration。

产品方向、需求、真实设备 validation、release 决策与 maintenance 仍由人类主导。

## Contributing

欢迎 Issue、compatibility finding、documentation improvement、security report 与 Pull Request。

安全漏洞请按照 **[SECURITY.md](./SECURITY.md)** 的流程报告，不要在公开 Issue 中发布 exploit detail。

## License

MIT。详见 [LICENSE](./LICENSE)。

---

**DevMoter FAST v3 — 让开发机继续运行，把控制平面带在身边。**
