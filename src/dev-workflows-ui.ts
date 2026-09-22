type Json = Record<string, any>;

type ProjectRef = {
  id: string;
  name: string;
  path: string;
};

type PanelOptions = {
  modalBody: HTMLDivElement;
  openModal(title: string, subtitle?: string): void;
  closeSidebar(): void;
  getActiveProject(): ProjectRef | null;
  showToast(message: string): void;
  uid(): string;
};

function text(tag: string, value: string, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function details(title: string, value: string, open = false) {
  const wrapper = document.createElement("details");
  wrapper.className = "cx-dev-details";
  wrapper.open = open;
  const summary = document.createElement("summary");
  summary.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = value;
  wrapper.append(summary, pre);
  return wrapper;
}

function statusBadge(value: string) {
  const badge = text("span", value || "unknown", "cx-dev-badge");
  badge.dataset.state = String(value || "unknown").toLowerCase();
  return badge;
}

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export function createDevWorkflowPanel(options: PanelOptions) {
  const { modalBody, openModal, closeSidebar, getActiveProject, showToast, uid } = options;
  let prNumber = localStorage.getItem("devmoter-pr-number") || "";

  async function api<T = Json>(path: string, init: RequestInit = {}): Promise<T> {
    const method = String(init.method || "GET").toUpperCase();
    const mutating = !["GET", "HEAD"].includes(method);
    const response = await fetch("/api/dev" + path, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(mutating ? { "x-pocket-operation-id": uid() } : {}),
        ...(init.headers || {})
      },
      cache: method === "GET" ? "no-store" : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || ("HTTP " + response.status));
    return payload as T;
  }

  function projectRequired() {
    const project = getActiveProject();
    if (!project) throw new Error("先にProjectを選択してください");
    return project;
  }

  function makeAction(label: string, onClick: (button: HTMLButtonElement) => Promise<void>, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (primary) button.classList.add("primary");
    button.addEventListener("click", () => {
      button.disabled = true;
      void onClick(button).catch(error => {
        showToast(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        button.disabled = false;
      });
    });
    return button;
  }

  function section(titleValue: string, subtitle = "") {
    const node = document.createElement("section");
    node.className = "cx-settings-section cx-dev-section";
    const heading = text("h3", titleValue);
    node.appendChild(heading);
    if (subtitle) node.appendChild(text("p", subtitle, "cx-muted"));
    return node;
  }

  function renderReviewResult(result: Json, target: HTMLElement, requestedPr: string) {
    target.replaceChildren();
    const head = document.createElement("div");
    head.className = "cx-dev-result-head";
    head.append(
      text("strong", result.mode === "final" ? "Final review" : ("PR #" + requestedPr + " review")),
      statusBadge(result.findings?.length ? (result.policy === "block" ? "blocked" : "warning") : "success")
    );
    target.appendChild(head);

    if (result.diffTruncated) {
      target.appendChild(text("p", "差分が大きいため、レビュー入力は上限で切り詰められました。", "cx-muted"));
    }
    const findings = Array.isArray(result.findings) ? result.findings : [];
    if (!findings.length) {
      target.appendChild(text("p", "具体的な指摘はありませんでした。", "cx-dev-success"));
    }

    for (const finding of findings) {
      const card = document.createElement("article");
      card.className = "cx-dev-finding";
      const row = document.createElement("div");
      row.className = "cx-dev-result-head";
      row.append(
        text("strong", String(finding.summary || "Review finding")),
        statusBadge(String(finding.severity || "medium"))
      );
      card.appendChild(row);

      const location = [finding.file, finding.line ? ("L" + finding.line) : ""].filter(Boolean).join(":");
      if (location) {
        const locationRow = text("div", location + (finding.anchorMatched ? " · diff hunk matched" : ""), "cx-dev-location");
        card.appendChild(locationRow);
      }
      if (finding.evidence) card.appendChild(text("p", String(finding.evidence)));
      if (finding.suggestion) card.appendChild(text("p", "Fix: " + String(finding.suggestion), "cx-muted"));

      const actions = document.createElement("div");
      actions.className = "cx-dev-inline-actions";
      if (finding.locationUrl) {
        const link = document.createElement("a");
        link.href = String(finding.locationUrl);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "GitHubで位置を開く";
        actions.appendChild(link);
      }
      if (result.mode === "pr" && requestedPr) {
        actions.appendChild(makeAction("この指摘だけPRへ投稿", async button => {
          if (!confirm("このレビュー指摘をGitHub PRへコメント投稿しますか？")) return;
          const project = projectRequired();
          await api("/review/comment", {
            method: "POST",
            body: JSON.stringify({
              projectId: project.id,
              prNumber: requestedPr,
              finding
            })
          });
          button.textContent = "投稿済み";
          showToast("PRへコメントしました");
        }));
      }
      if (actions.childElementCount) card.appendChild(actions);
      target.appendChild(card);
    }

    if (result.raw) target.appendChild(details("Raw reviewer output", String(result.raw)));
    if (Array.isArray(result.deniedApprovals) && result.deniedApprovals.length) {
      target.appendChild(text("p", "Read-only保護により書き込み要求を拒否しました。", "cx-dev-warning"));
    }
  }

  function renderCiResult(result: Json, target: HTMLElement) {
    target.replaceChildren();
    const head = document.createElement("div");
    head.className = "cx-dev-result-head";
    head.append(text("strong", "CI / checks"), statusBadge(String(result.state || "unknown")));
    target.appendChild(head);

    if (!result.available) {
      target.appendChild(text("p", String(result.error || "GitHub checksを取得できませんでした。"), "cx-dev-warning"));
      return;
    }
    const checks = Array.isArray(result.checks) ? result.checks : [];
    if (!checks.length) target.appendChild(text("p", "このPRには取得できるcheckがありません。", "cx-muted"));

    for (const check of checks) {
      const row = document.createElement("div");
      row.className = "cx-dev-check-row";
      const copy = document.createElement("span");
      copy.append(
        text("strong", String(check.name || "check")),
        text("small", [check.workflow, check.conclusion || check.status].filter(Boolean).join(" · "))
      );
      row.append(copy, statusBadge(String(check.conclusion || check.status || "unknown")));
      target.appendChild(row);
    }
    for (const log of Array.isArray(result.logs) ? result.logs : []) {
      target.appendChild(details("Failed log · " + String(log.name || "workflow"), String(log.text || "")));
    }
  }

  function renderVerification(result: Json, target: HTMLElement, titleValue = "Verification") {
    target.replaceChildren();
    const head = document.createElement("div");
    head.className = "cx-dev-result-head";
    head.append(text("strong", titleValue), statusBadge(result.ok ? "success" : "failure"));
    target.appendChild(head);
    if (result.error) target.appendChild(text("p", String(result.error), "cx-dev-warning"));
    const verification = result.verification || result;
    for (const command of Array.isArray(verification.commands) ? verification.commands : []) {
      const card = document.createElement("div");
      card.className = "cx-dev-command-result";
      const row = document.createElement("div");
      row.className = "cx-dev-result-head";
      row.append(
        text("strong", String(command.name || "command")),
        statusBadge(command.ok ? "success" : "failure")
      );
      card.appendChild(row);
      card.appendChild(text("small", "exit " + String(command.exitCode) + " · " + String(command.durationMs || 0) + "ms", "cx-muted"));
      if (command.stdout) card.appendChild(details("stdout", String(command.stdout)));
      if (command.stderr) card.appendChild(details("stderr", String(command.stderr), !command.ok));
      target.appendChild(card);
    }
    if (Array.isArray(result.attempts) && result.attempts.length) {
      target.appendChild(details("Repair attempts", pretty(result.attempts)));
    }
  }

  async function editMcpServer(server: Json | null = null) {
    const project = projectRequired();
    openModal(server ? "MCPを編集" : "MCPを追加", "秘密値は画面に再表示されません。空欄なら既存envを保持します。");
    modalBody.replaceChildren();

    const form = document.createElement("form");
    form.className = "cx-project-form cx-dev-form";
    const field = (labelText: string, value = "", placeholder = "") => {
      const label = document.createElement("label");
      label.appendChild(text("span", labelText));
      const input = document.createElement("input");
      input.value = value;
      input.placeholder = placeholder;
      label.appendChild(input);
      return { label, input };
    };

    const name = field("名前", String(server?.name || ""), "workspace-tools");
    const scopeLabel = document.createElement("label");
    scopeLabel.appendChild(text("span", "Scope"));
    const scope = document.createElement("select");
    scope.innerHTML = '<option value="global">Global</option><option value="project">Project</option>';
    scope.value = String(server?.scope || "project");
    scopeLabel.appendChild(scope);

    const transportLabel = document.createElement("label");
    transportLabel.appendChild(text("span", "Transport"));
    const transport = document.createElement("select");
    transport.innerHTML = '<option value="stdio">stdio</option><option value="http">HTTP</option>';
    transport.value = String(server?.transport || "stdio");
    transportLabel.appendChild(transport);

    const target = field(
      "Command / Endpoint",
      String(server?.transport === "http" ? (server?.endpoint || "") : (server?.command || "")),
      "npx / https://example.test/mcp"
    );
    const args = field("Args（1行1引数）", Array.isArray(server?.args) ? server.args.join("\n") : "", "--stdio");

    const envLabel = document.createElement("label");
    envLabel.appendChild(text("span", "Env JSON（任意・秘密値OK）"));
    const env = document.createElement("textarea");
    env.rows = 4;
    env.placeholder = '{"API_KEY":"..."}';
    envLabel.appendChild(env);

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "cx-dev-checkbox";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = server?.enabled !== false;
    enabledLabel.append(enabled, text("span", "有効"));

    const error = text("div", "", "cx-form-error hidden");
    const actions = document.createElement("div");
    actions.className = "cx-dev-inline-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "戻る";
    cancel.addEventListener("click", () => void show());
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "primary";
    save.textContent = "保存";
    actions.append(cancel, save);

    form.append(name.label, scopeLabel, transportLabel, target.label, args.label, envLabel, enabledLabel, error, actions);
    modalBody.appendChild(form);

    const updateTargetLabel = () => {
      target.label.querySelector("span")!.textContent = transport.value === "http" ? "Endpoint" : "Command";
      args.label.classList.toggle("hidden", transport.value === "http");
    };
    transport.addEventListener("change", updateTargetLabel);
    updateTargetLabel();

    form.addEventListener("submit", event => {
      event.preventDefault();
      save.disabled = true;
      error.classList.add("hidden");
      void (async () => {
        const payload: Json = {
          id: server?.id || undefined,
          name: name.input.value.trim(),
          scope: scope.value,
          projectId: scope.value === "project" ? project.id : "",
          transport: transport.value,
          endpoint: transport.value === "http" ? target.input.value.trim() : "",
          command: transport.value === "stdio" ? target.input.value.trim() : "",
          args: transport.value === "stdio"
            ? args.input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
            : [],
          enabled: enabled.checked
        };
        if (env.value.trim()) {
          const parsed = JSON.parse(env.value);
          if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("EnvはJSON objectで入力してください");
          payload.env = parsed;
        }
        await api("/mcp", { method: "POST", body: JSON.stringify({ server: payload }) });
        showToast("MCP設定を保存しました");
        await show();
      })().catch(cause => {
        error.textContent = cause instanceof Error ? cause.message : String(cause);
        error.classList.remove("hidden");
      }).finally(() => {
        save.disabled = false;
      });
    });
  }

  function renderCapabilities(capabilities: Json, settings: Json) {
    const project = projectRequired();

    const mcpSection = section("MCP servers", "Global / Project scope、接続先、状態をここから管理できます。");
    const add = makeAction("＋ MCP server", async () => editMcpServer(null), true);
    add.classList.add("cx-dev-section-action");
    mcpSection.appendChild(add);

    const servers = Array.isArray(capabilities.mcp) ? capabilities.mcp : [];
    if (!servers.length) mcpSection.appendChild(text("p", "設定済みMCP serverはありません。", "cx-muted"));
    for (const server of servers) {
      const card = document.createElement("div");
      card.className = "cx-dev-mcp-card";
      const head = document.createElement("div");
      head.className = "cx-dev-result-head";
      head.append(text("strong", String(server.name || "MCP")), statusBadge(server.enabled === false ? "disabled" : "enabled"));
      card.appendChild(head);
      const target = server.transport === "http" ? server.endpoint : [server.command, ...(server.args || [])].filter(Boolean).join(" ");
      card.appendChild(text("small", String(server.scope || "global") + " · " + String(server.transport || "") + " · " + String(target || ""), "cx-muted"));
      if (server.env && Object.keys(server.env).length) card.appendChild(details("Env (masked)", pretty(server.env)));

      const actions = document.createElement("div");
      actions.className = "cx-dev-inline-actions";
      actions.append(
        makeAction("Test", async button => {
          const result = await api<Json>("/mcp/test", {
            method: "POST",
            body: JSON.stringify({ projectId: project.id, serverId: server.id })
          });
          button.textContent = result.ok ? "Connected ✓" : ("Error: " + String(result.error || result.state));
        }),
        makeAction("編集", async () => editMcpServer(server)),
        makeAction(server.enabled === false ? "有効化" : "無効化", async () => {
          await api("/mcp/enabled", {
            method: "PUT",
            body: JSON.stringify({ serverId: server.id, enabled: server.enabled === false })
          });
          await show();
        }),
        makeAction("削除", async () => {
          if (!confirm(String(server.name || "MCP") + " をDevMoter設定から削除しますか？")) return;
          await api("/mcp", {
            method: "DELETE",
            body: JSON.stringify({ serverId: server.id })
          });
          await show();
        })
      );
      card.appendChild(actions);
      mcpSection.appendChild(card);
    }
    modalBody.appendChild(mcpSection);

    const capabilitySection = section("Skills / Rules", "発見時にはコードを実行せず、source・scope・trustを表示します。");
    const skills = Array.isArray(capabilities.skills) ? capabilities.skills : [];
    const rules = Array.isArray(capabilities.rules) ? capabilities.rules : [];
    const skillDetails = skills.map((skill: Json) => ({
      name: skill.name,
      scope: skill.scope,
      source: skill.source,
      trusted: skill.trusted
    }));
    const ruleDetails = rules.map((rule: Json) => ({
      scope: rule.scope,
      source: rule.source,
      trusted: rule.trusted,
      precedence: rule.precedence,
      preview: String(rule.content || "").slice(0, 240)
    }));
    capabilitySection.append(
      details("Effective Skills · " + skills.length, pretty(skillDetails)),
      details("Effective Rules · " + rules.length, pretty(ruleDetails))
    );
    modalBody.appendChild(capabilitySection);

    const extensionSection = section("Extension manifest", "devmoter.extension.json · manifestVersion 1");
    if (!capabilities.extension?.present) {
      extensionSection.appendChild(text("p", "このProjectにmanifestはありません。", "cx-muted"));
    } else {
      extensionSection.append(
        statusBadge(capabilities.extension.valid ? "valid" : "invalid"),
        details(
          capabilities.extension.valid ? "Manifest" : "Validation errors",
          pretty(capabilities.extension.valid ? capabilities.extension.manifest : capabilities.extension.errors),
          !capabilities.extension.valid
        )
      );
    }
    modalBody.appendChild(extensionSection);

    const adapterSection = section("Agent adapters", "Native adaptersを優先し、ACPは明示設定時のみ有効になります。");
    for (const adapter of Array.isArray(capabilities.adapters) ? capabilities.adapters : []) {
      const row = document.createElement("div");
      row.className = "cx-dev-check-row";
      const copy = document.createElement("span");
      copy.append(
        text("strong", String(adapter.id || "adapter")),
        text("small", String(adapter.protocol || "") + " · " + (adapter.native ? "native" : "optional"))
      );
      row.append(copy, statusBadge(adapter.enabled ? "enabled" : "disabled"));
      adapterSection.appendChild(row);
    }
    const acpConfig = settings?.adapters?.acp;
    if (acpConfig?.enabled) {
      adapterSection.appendChild(makeAction("ACP接続テスト", async button => {
        const result = await api<Json>("/acp/probe", {
          method: "POST",
          body: JSON.stringify({ projectId: project.id })
        });
        button.textContent = result.ok ? "ACP connected ✓" : ("ACP: " + String(result.error || result.state));
      }));
    }
    adapterSection.appendChild(details("Negotiation", pretty(capabilities.negotiation)));
    modalBody.appendChild(adapterSection);
  }

  async function show() {
    closeSidebar();
    const project = getActiveProject();
    openModal("Developer workflows", project ? project.name : "Projectを選択してください");
    modalBody.innerHTML = '<div class="cx-modal-loading">読み込み中…</div>';

    if (!project) {
      modalBody.replaceChildren(text("p", "Review / CI / verification / MCPはProject単位で動きます。先にProjectsから作業対象を選んでください。", "cx-muted"));
      return;
    }

    try {
      const [capabilities, settingsPayload] = await Promise.all([
        api<Json>("/capabilities?projectId=" + encodeURIComponent(project.id)),
        api<Json>("/settings")
      ]);
      const settings = settingsPayload.settings || {};

      modalBody.replaceChildren();

      const reviewSection = section("Review & CI", "AI reviewはread-only。GitHubへのコメント投稿だけは別の明示操作です。");
      const prRow = document.createElement("div");
      prRow.className = "cx-dev-pr-row";
      const prInput = document.createElement("input");
      prInput.type = "number";
      prInput.min = "1";
      prInput.inputMode = "numeric";
      prInput.placeholder = "PR #";
      prInput.value = prNumber;
      prInput.addEventListener("input", () => {
        prNumber = prInput.value.trim();
        if (prNumber) localStorage.setItem("devmoter-pr-number", prNumber);
        else localStorage.removeItem("devmoter-pr-number");
      });
      const reviewButton = makeAction("AI Review", async () => {
        const value = prInput.value.trim();
        if (!/^\d+$/.test(value)) throw new Error("PR番号を入力してください");
        reviewResult.innerHTML = '<div class="cx-modal-loading">read-only reviewer実行中…</div>';
        const result = await api<Json>("/review", {
          method: "POST",
          body: JSON.stringify({ projectId: project.id, prNumber: value, mode: "pr" })
        });
        renderReviewResult(result, reviewResult, value);
      }, true);
      const ciButton = makeAction("CI", async () => {
        const value = prInput.value.trim();
        if (!/^\d+$/.test(value)) throw new Error("PR番号を入力してください");
        ciResult.innerHTML = '<div class="cx-modal-loading">checksを取得中…</div>';
        const result = await api<Json>("/ci", {
          method: "POST",
          body: JSON.stringify({ projectId: project.id, prNumber: value, includeLogs: true })
        });
        renderCiResult(result, ciResult);
      });
      prRow.append(prInput, reviewButton, ciButton);
      reviewSection.appendChild(prRow);

      const finalButton = makeAction("Local diffをFinal Review", async () => {
        reviewResult.innerHTML = '<div class="cx-modal-loading">final reviewer実行中…</div>';
        const result = await api<Json>("/review", {
          method: "POST",
          body: JSON.stringify({ projectId: project.id, mode: "final" })
        });
        renderReviewResult(result, reviewResult, "");
      });
      reviewSection.appendChild(finalButton);

      const reviewResult = document.createElement("div");
      reviewResult.className = "cx-dev-result";
      const ciResult = document.createElement("div");
      ciResult.className = "cx-dev-result";
      reviewSection.append(reviewResult, ciResult);
      modalBody.appendChild(reviewSection);

      const verifySection = section("Verification & repair", "実行コマンドはProjectから自動採用せず、信頼済みDevMoter設定だけを使います。");
      const verifyActions = document.createElement("div");
      verifyActions.className = "cx-dev-inline-actions";
      const verifyResult = document.createElement("div");
      verifyResult.className = "cx-dev-result";
      verifyActions.append(
        makeAction("Lint / Test / Typecheck", async () => {
          verifyResult.innerHTML = '<div class="cx-modal-loading">verification実行中…</div>';
          const result = await api<Json>("/verify", {
            method: "POST",
            body: JSON.stringify({ projectId: project.id })
          });
          renderVerification(result, verifyResult);
        }, true),
        makeAction("Auto repair", async () => {
          verifyResult.innerHTML = '<div class="cx-modal-loading">bounded repair loop実行中…</div>';
          const result = await api<Json>("/repair", {
            method: "POST",
            body: JSON.stringify({ projectId: project.id })
          });
          renderVerification(result, verifyResult, "Auto repair");
        })
      );
      verifySection.append(verifyActions, verifyResult);
      if (!Array.isArray(settings?.verification?.commands) || !settings.verification.commands.length) {
        verifySection.appendChild(text("p", "検証コマンドは未設定です。Project内のpackage.json等から勝手には実行しません。", "cx-dev-warning"));
      }
      modalBody.appendChild(verifySection);

      renderCapabilities(capabilities, settings);
    } catch (error) {
      modalBody.replaceChildren(text("p", error instanceof Error ? error.message : String(error), "cx-dev-warning"));
    }
  }

  return { show };
}
