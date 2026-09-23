import "./setup-wizard.css";

type Tool = {
  id: string;
  displayName: string;
  state: string;
  installed: boolean;
  version: string | null;
  authenticated: boolean | null;
  authState: string;
  providerAuth?: string;
  diagnostics: Array<{ code: string; message: string }>;
};

type SetupStatus = {
  phase: string;
  platform: {
    os: string;
    supported: boolean;
    node: { available: boolean; version: string };
    git: { installed: boolean; version: string | null };
  };
  tools: Tool[];
};

const groups = [
  { title: "Coding agents", ids: ["codex", "opencode", "claude", "antigravity"] },
  { title: "Developer tools", ids: ["github"] },
  { title: "Remote access", ids: ["tailscale"] }
];

const knownNames: Record<string, string> = {
  codex: "OpenAI Codex CLI",
  opencode: "OpenCode CLI",
  claude: "Claude Code",
  antigravity: "Antigravity CLI",
  github: "GitHub CLI",
  tailscale: "Tailscale"
};

function statusLabel(tool: Tool) {
  if (tool.state === "ready") return "Installed · Connected";
  if (tool.state === "auth_required") return "Installed · Sign-in required";
  if (tool.state === "broken") return "Installed · Check failed";
  if (tool.state === "unsupported") return "Unsupported on this platform";
  if (tool.installed && tool.id === "opencode") {
    if (tool.providerAuth === "configured") return "Installed · Provider credentials found";
    if (tool.providerAuth === "none") return "Installed · No provider credentials found";
    return "Installed · Provider status unknown";
  }
  if (tool.installed) return "Installed · Authentication status unknown";
  if (tool.state === "missing") return "Not installed";
  return "Status unknown";
}

function detailLabel(tool: Tool) {
  return tool.version ? `Version ${tool.version}` : "";
}

export function mountSetupWizard(root: HTMLDivElement) {
  root.innerHTML = `
    <main class="dm-setup" aria-labelledby="dm-setup-title">
      <header class="dm-setup-header">
        <a href="/" class="dm-setup-back">← DevMoter FAST</a>
        <span class="dm-setup-badge">EXPERIMENTAL · PHASE 1</span>
      </header>
      <section class="dm-setup-intro">
        <p class="dm-setup-eyebrow">DEV MOTER FAST SETUP</p>
        <h1 id="dm-setup-title">Your tools, one clear view.</h1>
        <p class="dm-setup-lede">Installation should cost time, not expertise.</p>
        <p class="dm-setup-note">This preview only checks your environment. It never installs software, starts sign-in, or changes Tailscale settings.</p>
        <div class="dm-setup-actions">
          <button class="dm-setup-rescan" type="button" data-rescan>Rescan</button>
          <span class="dm-setup-scan-state" aria-live="polite" data-scan-state></span>
        </div>
      </section>
      <section class="dm-setup-environment" aria-labelledby="dm-setup-environment-title">
        <h2 id="dm-setup-environment-title">Environment</h2>
        <div class="dm-setup-environment-grid" data-environment><div class="dm-setup-skeleton">Checking this machine…</div></div>
      </section>
      <div class="dm-setup-groups" data-tool-groups></div>
      <footer class="dm-setup-footer">Read-only preview · Install and Connect actions are planned for later phases.</footer>
    </main>
  `;

  const rescan = root.querySelector<HTMLButtonElement>("[data-rescan]")!;
  const scanState = root.querySelector<HTMLElement>("[data-scan-state]")!;
  const environment = root.querySelector<HTMLElement>("[data-environment]")!;
  const toolGroups = root.querySelector<HTMLElement>("[data-tool-groups]")!;

  function renderEnvironment(status: SetupStatus) {
    const items = [
      { label: status.platform.os === "linux" ? "Linux" : status.platform.os, value: status.platform.supported ? "Supported" : "Unsupported" },
      { label: "Node.js", value: status.platform.node.available ? status.platform.node.version : "Missing" },
      { label: "Git", value: status.platform.git.version || (status.platform.git.installed ? "Available" : "Not found") }
    ];
    environment.replaceChildren(...items.map(item => {
      const card = document.createElement("div");
      card.className = "dm-setup-env-card";
      const name = document.createElement("span");
      name.textContent = item.label;
      const value = document.createElement("strong");
      value.textContent = item.value;
      card.append(name, value);
      return card;
    }));
  }

  function renderTools(tools: Tool[]) {
    const byId = new Map(tools.map(tool => [tool.id, tool]));
    toolGroups.replaceChildren(...groups.map(group => {
      const section = document.createElement("section");
      section.className = "dm-setup-group";
      const heading = document.createElement("h2");
      heading.textContent = group.title;
      const list = document.createElement("div");
      list.className = "dm-setup-tool-list";
      for (const id of group.ids) {
        const tool = byId.get(id);
        const row = document.createElement("article");
        row.className = `dm-setup-tool dm-setup-state-${tool?.state || "unknown"}`;
        const indicator = document.createElement("span");
        indicator.className = "dm-setup-indicator";
        indicator.setAttribute("aria-hidden", "true");
        indicator.textContent = tool?.state === "ready" ? "✓" : tool?.installed ? "•" : "○";
        const copy = document.createElement("div");
        copy.className = "dm-setup-tool-copy";
        const name = document.createElement("strong");
        name.textContent = tool?.displayName || knownNames[id];
        const status = document.createElement("span");
        status.textContent = tool ? statusLabel(tool) : "Status unknown";
        copy.append(name, status);
        if (tool && detailLabel(tool)) {
          const version = document.createElement("small");
          version.textContent = detailLabel(tool);
          copy.append(version);
        }
        const planned = document.createElement("span");
        planned.className = "dm-setup-planned";
        planned.textContent = "Planned";
        planned.setAttribute("aria-label", "Install and connect actions planned for a later phase");
        row.append(indicator, copy, planned);
        list.append(row);
      }
      section.append(heading, list);
      return section;
    }));
  }

  async function scan() {
    rescan.disabled = true;
    scanState.textContent = "Scanning…";
    try {
      const response = await fetch("/api/setup/status", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to scan this machine." : `Scan failed (${response.status}).`);
      const status = await response.json() as SetupStatus;
      renderEnvironment(status);
      renderTools(status.tools);
      scanState.textContent = "Scan complete";
    } catch (error) {
      scanState.textContent = error instanceof Error ? error.message : "Scan failed.";
    } finally {
      rescan.disabled = false;
    }
  }

  rescan.addEventListener("click", () => void scan());
  void scan();
}
