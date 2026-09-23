# DevMoter FAST v2

**把编程代理装进一个口袋大小的控制平面。📱**

[![CI](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml/badge.svg)](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml)

[English](./README.md) · [日本語](./README.ja.md) · **简体中文**

> **Version track:** v2.0.0-alpha 系列  
> **Status:** active development / pre-release

DevMoter FAST 是一个用于统一控制编程代理与开发工具的**开源、自托管、移动优先控制平面**。

Codex、OpenCode、仓库、凭据、终端、Git 工作流和主机集成继续留在 Linux 主机上；手机、平板、PWA 或浏览器只负责控制。

DevMoter v2 已经不再只是“远程聊天界面”。它正在演进为一个 host-local 控制平面，把**代理会话、Projects、Git/GitHub、Reviewed Changes、模型路由、自动化、本地工具和显式安全边界**统一到一个 mobile-first 界面中。

> [!IMPORTANT]
> DevMoter FAST 是非官方社区项目，与 OpenAI、OpenCode、GitHub、Anthropic、Google、Tailscale 及其他提及的服务提供方不存在隶属、赞助或认可关系。

> [!WARNING]
> 当前 DevMoter 面向**单用户私有主机 / 私有网络**。默认保持 localhost；远程使用时推荐 Tailscale Serve 等私有 HTTPS。不要将 DevMoter 或代理后端直接暴露到公网。

## 为什么是 v2？

第一代验证了核心想法：在 Linux 主机上启动 Coding Agent，然后从手机远程控制。

v2 将这个想法扩展为真正的**控制平面**：

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
Phone / tablet / browser / PWA
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
| GitHub workspace | ✅ Shipped | host-`gh` repo discovery、managed clone/open、branch/fetch safety checks |
| Session control | 🧪 Experimental | handoff、follow-up、checkpoint、rewind/fork、transcript search、background-run controls |
| Reviewed Changes / Tasks | 🧪 Experimental | proposal review、hunk decision、drift check、apply/commit、worktree、PR flow |
| Project context / local index | 🧪 Experimental | bounded project search、structure/symbol context、local indexing |
| Persistent terminal | 🧪 Experimental | authenticated project-scoped terminal、bounded replay、reconnect |
| API Chat / model routing | 🧪 Experimental | configurable provider/model、reasoning mode、routing/failover、image attachment |
| Automation / control plane | 🧪 Experimental | host registry、schedule/trigger、bounded automation primitive |
| Antigravity / Claude 集成 | 🧪 Experimental | local integration discovery、部分 launch/remote handoff flow |
| PWA / mobile UI | ✅ Shipped | responsive UI、backend switching、reconnect、installable shell |
| Passkey / device controls | 🧪 Experimental | 辅助设备控制；不是公网 multi-user 授权系统 |
| Library | 🗺️ Planned | storage/library surface 尚未实现 |
| Google / Microsoft / Apple 登录 | 🗺️ Planned | 仅 roadmap；尚未实现 |

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

v2 也加入了聊天之外的 host-local developer surface。

Experimental 能力包括：

- project structure / symbol context；
- bounded local full-text index；
- sensitive/vendor path exclusion；
- 可 reconnect 的 project-scoped terminal；
- bounded terminal output replay；
- mobile-friendly terminal control。

这些能力围绕 registered project boundary 设计，而不是提供 unrestricted browser-side shell。

## Automation / Integrations

v2 architecture 包含一层 Experimental control-plane，用于 host integration 与 automation。

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

v2.0.0-alpha 系列仍然是 development software。

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
- Tailscale：private phone access。

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

安装 Tailscale 后：

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

在同一 tailnet 的设备上打开输出的 private HTTPS URL。

> [!CAUTION]
> 当前 Alpha 不推荐 Tailscale Funnel 或任意 public tunnel。DevMoter login 是 single-user access boundary，不是公网 SaaS 授权系统。

## 文档

| Document | 内容 |
| --- | --- |
| [Architecture](./ARCHITECTURE.md) | process / browser / agent / filesystem boundary |
| [Security](./SECURITY.md) | deployment assumption / vulnerability reporting |
| [Threat model](./THREAT_MODEL.md) | trust boundary / attacker model |
| [Fast Install](./fastinstall.MD) | 最短安装路径 |
| [Operations](./docs/operations.md) | systemd / update / operation |
| [Developer workflows](./docs/developer-workflows.md) | extensions / MCP / ACP / skills / rules |
| [Browser automation sandbox](./docs/BROWSER_AUTOMATION_SANDBOX.md) | browser automation boundary |
| [Remote-control security](./docs/remote-control-security.md) | host registry / automation security |
| [Release smoke](./RELEASE_SMOKE.md) | 真机 release checklist |
| [Roadmap](./ROADMAP.md) | 当前方向 / maturity gate |

## 开发

```bash
npm install
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

**DevMoter FAST v2 — 让开发机继续运行，把控制平面带在身边。**
