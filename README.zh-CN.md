# DevMoter FAST

**把编程代理装进一个口袋大小的控制平面。📱**

[English](./README.md) · [日本語](./README.ja.md) · **简体中文**

DevMoter FAST 是一个**开源、自托管、移动优先的编程代理控制平面**。Codex、OpenCode、仓库、凭据和工具继续运行在 Linux 主机上，手机、平板或浏览器只作为控制界面。

它不只是聊天包装器：DevMoter 把代理会话、Projects、Git/GitHub、Reviewed Changes、API Chat、主机集成、自动化和安全边界放到同一个 UI 中。

> [!IMPORTANT]
> **Alpha / active development.** 本项目是非官方社区项目，与 OpenAI、OpenCode、GitHub、Anthropic、Google、Tailscale 等服务提供方不存在隶属、赞助或认可关系。

> [!WARNING]
> 当前面向**单用户私有主机 / 私有网络**。默认保持 localhost；远程使用时推荐 Tailscale Serve 等私有 HTTPS。不要把 DevMoter 或代理后端直接暴露到公网。

## 30 秒架构

```text
Phone / tablet / PWA
        │
        ▼
   DevMoter FAST
 mobile control plane
   │      │      │
   ▼      ▼      ▼
Codex  OpenCode  API Chat
   └──────┼──────┘
          ▼
    Projects · Git
          ▼
      Linux host
```

核心工作流：**在主机开始任务 → 离开电脑 → 从手机检查、审批、中断、切换上下文或继续工作。**

## 功能状态

UI 中出现一个入口并不等于功能已经完成。

| 功能 | 状态 | 当前范围 |
| --- | --- | --- |
| OpenCode | ✅ Shipped | sessions、agents、models/providers、modes、commands、skills、streaming、permissions/questions、interrupt |
| Codex | ✅ Shipped | threads、resume/fork、动态模型发现、reasoning effort、streaming、approvals、attachments、plugins/MCP |
| Projects | ✅ Shipped | 项目注册/切换、有边界的 Markdown 浏览与编辑 |
| GitHub workspace | ✅ Shipped | host `gh` 仓库发现、managed clone/open、branch/fetch 安全检查 |
| API Chat | 🧪 Experimental | 多 provider/model、reasoning mode、图片附件 |
| Reviewed Changes / Tasks | 🧪 Experimental | proposal、hunk review、drift checks、apply/commit、worktree/PR |
| Automation / Control plane | 🧪 Experimental | host registry、schedule/trigger、bounded automation |
| Antigravity / Claude 集成 | 🧪 Experimental | 本地发现和部分 launch/remote handoff |
| PWA / mobile UI | ✅ Shipped | responsive UI、backend switching、reconnect、installable shell |
| Passkey / device controls | 🧪 Experimental | 辅助设备控制；不是公网多用户授权系统 |
| Library | 🗺️ Planned | 尚未实现 |
| Google / Microsoft / Apple 登录 | 🗺️ Planned | 尚未实现 |

Codex 模型等上游能力由本机安装的 app-server 动态提供；DevMoter 不伪造不存在的模型可用性。

## 最快启动

要求：Linux、Node.js 22 + npm、Git、Python 3、curl、OpenCode CLI、OpenAI Codex CLI。

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
npm ci
bash scripts/start-pocket.sh
```

打开 `http://127.0.0.1:8787`。

更多内容见 [Fast Install](./fastinstall.MD) 和 [Operations](./docs/operations.md)。

## 手机私有访问

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

从同一 tailnet 的设备打开显示的 HTTPS URL。当前 Alpha 不推荐 Funnel 或任意公网 tunnel。

## 三个代理界面

**Codex** — 通过 stdio/JSONL 与本地 Codex app-server 通信，支持 threads、streaming、approvals、interrupt、attachments、动态 models、model-advertised reasoning effort 和 plugins/MCP。RPC 经过服务器 allowlist。

**OpenCode** — 通过 DevMoter 代理 localhost OpenCode。支持 sessions、agents、Plan/Ask/Build、provider/model、commands/skills、reasoning/tool activity、permissions/questions 和 interrupt。OpenCode 凭据不会返回浏览器。

**API Chat** — Experimental 多 provider UI。保存后的 API key 不会重新返回 frontend。

## Projects / Git / Reviewed Changes

浏览器提交 Project ID，由服务器解析工作目录，而不是接受任意 cwd。项目限制在 home directory 内，敏感文件操作检查 traversal/symlink 边界，移动编辑器只允许有大小限制的 Markdown 写入。

GitHub 集成使用主机的 `gh` session，clone 目标限制在 managed root。Reviewed Changes 以 Experimental 状态提供 proposal → hunk review → drift check → apply/commit → worktree/PR 流程。

## 安全模型

DevMoter 假设**已认证用户就是主机所有者**，不是多租户服务。

主要边界包括 localhost 默认绑定、DevMoter 自身认证、mutation exact-origin 检查、API/secret response `no-store`、server-side OpenCode credentials、Codex stdio + RPC allowlist、registered-project filesystem boundary、host-local attachments 和 host `gh` credentials。

远程部署前请阅读 [SECURITY.md](./SECURITY.md) 与 [THREAT_MODEL.md](./THREAT_MODEL.md)。

## 文档

- [Architecture](./ARCHITECTURE.md)
- [Security](./SECURITY.md)
- [Threat model](./THREAT_MODEL.md)
- [Fast Install](./fastinstall.MD)
- [Operations](./docs/operations.md)
- [Developer workflows](./docs/developer-workflows.md)
- [Remote-control security](./docs/remote-control-security.md)
- [Release smoke](./RELEASE_SMOKE.md)
- [Roadmap](./ROADMAP.md)

## 开发

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

CI 不能代替真实设备验证。发布前仍应执行 Chromebook/Crostini + iPhone 的 [Release Smoke](./RELEASE_SMOKE.md)。

## 项目原则

1. **Host-local by default**
2. **Mobile first**
3. **代理操作必须有安全边界**
4. **不把占位功能当成已完成能力**
5. **优先与现有工具互操作**

## AI-assisted development

项目大量使用 AI 辅助实现、调试、协议研究、测试与迭代；产品方向、需求、真实设备验证、发布决定和维护由人类负责。

## Contributing / Security

欢迎 Issue、兼容性报告、文档改进和 Pull Request。安全漏洞请按照 [SECURITY.md](./SECURITY.md) 私下报告，不要在公开 Issue 中发布利用细节、token、API key、密码或私有仓库内容。

## License

MIT License。详见 [LICENSE](./LICENSE)。

---

**DevMoter FAST — 让开发机继续运行，把控制平面带在身边。**
