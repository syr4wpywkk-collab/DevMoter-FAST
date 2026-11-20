import { getAppDefinition, SYSTEM_ICONS } from "./app-registry";
import { formatNumber, t, translateServerMessage } from "./i18n";
import { apiErrorMessage } from "./api-error.mjs";

function devError(error: unknown) {
  return translateServerMessage(error instanceof Error ? error.message : String(error));
}

const BADGE_KEY_MAP: Record<string, string> = {
  unknown: "devWorkflows.badge.unknown",
  blocked: "devWorkflows.badge.blocked",
  warning: "devWorkflows.badge.warning",
  success: "devWorkflows.badge.success",
  failure: "devWorkflows.badge.failure",
  enabled: "devWorkflows.badge.enabled",
  disabled: "devWorkflows.badge.disabled",
  trusted: "devWorkflows.badge.trusted",
  untrusted: "devWorkflows.badge.untrusted",
  approved: "devWorkflows.badge.approved",
  "approval required": "devWorkflows.badge.approvalRequired",
  invalid: "devWorkflows.badge.invalid",
  high: "devWorkflows.badge.high",
  medium: "devWorkflows.badge.medium",
  low: "devWorkflows.badge.low",
  critical: "devWorkflows.badge.critical",
  info: "devWorkflows.badge.info"
};

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
  /** Resolves once the owner has loaded the saved Project selection. */
  whenProjectReady?(): Promise<unknown>;
  getActiveThreadId(): string | null;
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

// JSON is reference material: it stays folded under one 「Details」 per section.
function jsonDetails(blocks: Array<[string, string]>) {
  const wrapper = document.createElement("details");
  wrapper.className = "cx-dev-details";
  const summary = document.createElement("summary");
  summary.textContent = t("devWorkflows.detailsSummary");
  wrapper.appendChild(summary);
  for (const [label, value] of blocks) {
    wrapper.appendChild(text("strong", label, "cx-dev-details-label"));
    const pre = document.createElement("pre");
    pre.textContent = value;
    wrapper.appendChild(pre);
  }
  return wrapper;
}

// One empty / loading / error presentation for every section and result.
type ViewState = "empty" | "loading" | "error";
function stateView(kind: ViewState, message: string) {
  const node = text("p", message, "cx-dev-state");
  node.dataset.state = kind;
  if (kind === "loading") node.setAttribute("aria-busy", "true");
  if (kind === "error") node.setAttribute("role", "alert");
  return node;
}

function statusBadge(value: string) {
  const raw = String(value || "unknown").toLowerCase();
  const label = BADGE_KEY_MAP[raw] ? t(BADGE_KEY_MAP[raw]) : translateServerMessage(value || "unknown");
  const badge = text("span", label, "cx-dev-badge");
  badge.dataset.state = raw;
  return badge;
}

type SkillSelection = {
  id: string;
  name: string;
  path: string;
};

function skillStorageKey(scope: "project" | "thread", id: string) {
  return "devmoter-active-skills:" + scope + ":" + id;
}

function readSkillSelections(key: string): SkillSelection[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item.path === "string" && item.path)
      .map(item => ({
        id: String(item.id || item.path),
        name: String(item.name || "Skill"),
        path: String(item.path)
      }));
  } catch {
    return [];
  }
}

function writeSkillSelection(key: string, skill: Json, enabled: boolean) {
  const selections = readSkillSelections(key);
  const id = String(skill.id || skill.path || skill.name || "");
  const next = selections.filter(item => item.id !== id);
  if (enabled && skill.path) {
    next.push({
      id,
      name: String(skill.name || "Skill"),
      path: String(skill.path)
    });
  }
  localStorage.setItem(key, JSON.stringify(next));
}

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export function createDevWorkflowPanel(options: PanelOptions) {
  const { modalBody, openModal, closeSidebar, getActiveProject, getActiveThreadId, showToast, uid } = options;
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
    if (!response.ok) throw new Error(apiErrorMessage(payload, response.status));
    return payload as T;
  }

  function projectRequired() {
    const project = getActiveProject();
    if (!project) throw new Error(t("devWorkflows.selectProjectFirst"));
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
        showToast(devError(error));
      }).finally(() => {
        button.disabled = false;
      });
    });
    return button;
  }

  // Title row: heading + optional action on one line. The explanation is a
  // tooltip, not body text.
  function section(titleValue: string, icon: string, subtitle = "", action?: HTMLButtonElement) {
    const node = document.createElement("section");
    node.className = "cx-settings-section cx-dev-section";
    const head = document.createElement("div");
    head.className = "cx-dev-section-head";
    const heading = document.createElement("h3");
    const iconBox = document.createElement("span");
    iconBox.className = "cx-dev-section-icon";
    iconBox.setAttribute("aria-hidden", "true");
    iconBox.innerHTML = icon; // static, code-owned SVG from the icon registry
    heading.append(iconBox, document.createTextNode(titleValue));
    if (subtitle) heading.title = subtitle;
    head.appendChild(heading);
    if (action) head.appendChild(action);
    node.appendChild(head);
    return node;
  }

  function renderReviewResult(result: Json, target: HTMLElement, requestedPr: string) {
    target.replaceChildren();
    const head = document.createElement("div");
    head.className = "cx-dev-result-head";
    head.append(
      text("strong", result.mode === "final" ? t("devWorkflows.finalReviewTitle") : t("devWorkflows.prReviewTitle", { pr: requestedPr })),
      statusBadge(result.allowed === false ? "blocked" : (result.findings?.length ? "warning" : "success"))
    );
    target.appendChild(head);
    if (result.allowed === false) {
      target.appendChild(text("p", t("devWorkflows.reviewBlockedNotice"), "cx-dev-warning"));
    }

    if (result.diffTruncated) {
      target.appendChild(text("p", t("devWorkflows.diffTruncatedNotice"), "cx-muted"));
    }
    const findings = Array.isArray(result.findings) ? result.findings : [];
    if (!findings.length) {
      target.appendChild(text("p", t("devWorkflows.noFindings"), "cx-dev-success"));
    }

    for (const finding of findings) {
      const card = document.createElement("article");
      card.className = "cx-dev-finding";
      const row = document.createElement("div");
      row.className = "cx-dev-result-head";
      row.append(
        text("strong", String(finding.summary || t("devWorkflows.reviewFindingFallback"))),
        statusBadge(String(finding.severity || "medium"))
      );
      card.appendChild(row);

      const location = [finding.file, finding.line ? ("L" + finding.line) : ""].filter(Boolean).join(":");
      if (location) {
        const locationRow = text("div", location + (finding.anchorMatched ? t("devWorkflows.diffHunkMatched") : ""), "cx-dev-location");
        card.appendChild(locationRow);
      }
      if (finding.evidence) card.appendChild(text("p", String(finding.evidence)));
      if (finding.suggestion) card.appendChild(text("p", t("devWorkflows.fixPrefix", { suggestion: String(finding.suggestion) }), "cx-muted"));

      const actions = document.createElement("div");
      actions.className = "cx-dev-inline-actions";
      if (finding.locationUrl && /^https?:\/\//i.test(String(finding.locationUrl))) {
        const link = document.createElement("a");
        link.href = String(finding.locationUrl);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = t("devWorkflows.openOnGithub");
        actions.appendChild(link);
      }
      if (result.mode === "pr" && requestedPr) {
        actions.appendChild(makeAction(t("devWorkflows.postToPrBtn"), async button => {
          if (!confirm(t("devWorkflows.postToPrConfirm"))) return;
          const project = projectRequired();
          await api("/review/comment", {
            method: "POST",
            body: JSON.stringify({
              projectId: project.id,
              prNumber: requestedPr,
              finding
            })
          });
          button.textContent = t("devWorkflows.postedBtn");
          showToast(t("devWorkflows.postedToPrToast"));
        }));
      }
      if (actions.childElementCount) card.appendChild(actions);
      target.appendChild(card);
    }

    if (result.raw) target.appendChild(details(t("devWorkflows.rawReviewerOutput"), String(result.raw)));
    if (Array.isArray(result.deniedApprovals) && result.deniedApprovals.length) {
      target.appendChild(text("p", t("devWorkflows.readOnlyDenied"), "cx-dev-warning"));
    }
  }

  function renderCiResult(result: Json, target: HTMLElement) {
    target.replaceChildren();
    const head = document.createElement("div");
    head.className = "cx-dev-result-head";
    head.append(text("strong", t("devWorkflows.ciChecksTitle")), statusBadge(String(result.state || "unknown")));
    target.appendChild(head);

    if (!result.available) {
      target.appendChild(text("p", translateServerMessage(String(result.error || t("devWorkflows.ciUnavailableFallback"))), "cx-dev-warning"));
      return;
    }
    const checks = Array.isArray(result.checks) ? result.checks : [];
    if (!checks.length) target.appendChild(stateView("empty", t("devWorkflows.ciNoChecks")));

    for (const check of checks) {
      const row = document.createElement("div");
      row.className = "cx-dev-check-row";
      const copy = document.createElement("span");
      const checkName = text("strong", String(check.name || t("devWorkflows.checkFallback")));
      if (check.detailsUrl && /^https?:\/\//i.test(String(check.detailsUrl))) {
        const link = document.createElement("a");
        link.href = String(check.detailsUrl);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.appendChild(checkName);
        copy.appendChild(link);
      } else {
        copy.appendChild(checkName);
      }
      copy.appendChild(text("small", [check.workflow, check.conclusion || check.status].filter(Boolean).join(" · ")));
      row.append(copy, statusBadge(String(check.conclusion || check.status || "unknown")));
      target.appendChild(row);
    }
    for (const log of Array.isArray(result.logs) ? result.logs : []) {
      target.appendChild(details(
        t("devWorkflows.failedLogTitle", { name: String(log.name || t("devWorkflows.workflowFallback")) }),
        String(log.text || "")
      ));
    }
  }

  function renderVerification(result: Json, target: HTMLElement, titleValue = t("devWorkflows.verificationTitle")) {
    target.replaceChildren();
    const head = document.createElement("div");
    head.className = "cx-dev-result-head";
    head.append(text("strong", titleValue), statusBadge(result.ok ? "success" : "failure"));
    target.appendChild(head);
    if (result.error) target.appendChild(text("p", translateServerMessage(String(result.error)), "cx-dev-warning"));
    const verification = result.verification || result;
    for (const command of Array.isArray(verification.commands) ? verification.commands : []) {
      const card = document.createElement("div");
      card.className = "cx-dev-command-result";
      const row = document.createElement("div");
      row.className = "cx-dev-result-head";
      row.append(
        text("strong", String(command.name || t("devWorkflows.commandFallback"))),
        statusBadge(command.ok ? "success" : "failure")
      );
      card.appendChild(row);
      card.appendChild(text(
        "small",
        t("devWorkflows.commandStats", { code: String(command.exitCode), ms: formatNumber(command.durationMs || 0) }),
        "cx-muted"
      ));
      if (command.stdout) card.appendChild(details(t("devWorkflows.stdoutLabel"), String(command.stdout)));
      if (command.stderr) card.appendChild(details(t("devWorkflows.stderrLabel"), String(command.stderr), !command.ok));
      target.appendChild(card);
    }
    if (Array.isArray(result.attempts) && result.attempts.length) {
      target.appendChild(details(t("devWorkflows.repairAttemptsTitle"), pretty(result.attempts)));
    }
  }

  async function editMcpServer(server: Json | null = null) {
    const project = projectRequired();
    openModal(
      server ? t("devWorkflows.editMcpTitle") : t("devWorkflows.addMcpTitle"),
      t("devWorkflows.mcpSecretNote")
    );
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

    const name = field(t("devWorkflows.nameLabel"), String(server?.name || ""), "workspace-tools");
    const scopeLabel = document.createElement("label");
    scopeLabel.appendChild(text("span", t("devWorkflows.scopeLabel")));
    const scope = document.createElement("select");
    scope.innerHTML = `<option value="global">${t("devWorkflows.scopeGlobal")}</option><option value="project">${t("devWorkflows.scopeProject")}</option>`;
    scope.value = String(server?.scope || "project");
    scopeLabel.appendChild(scope);

    const transportLabel = document.createElement("label");
    transportLabel.appendChild(text("span", t("devWorkflows.transportLabel")));
    const transport = document.createElement("select");
    transport.innerHTML = '<option value="stdio">stdio</option><option value="http">HTTP</option>';
    transport.value = String(server?.transport || "stdio");
    transportLabel.appendChild(transport);

    const target = field(
      t("devWorkflows.commandEndpointLabel"),
      String(server?.transport === "http" ? (server?.endpoint || "") : (server?.command || "")),
      "npx / https://example.test/mcp"
    );
    const args = field(t("devWorkflows.argsLabel"), Array.isArray(server?.args) ? server.args.join("\n") : "", "--stdio");

    const envLabel = document.createElement("label");
    envLabel.appendChild(text("span", t("devWorkflows.envJsonLabel")));
    const env = document.createElement("textarea");
    env.rows = 4;
    env.placeholder = '{"API_KEY":"..."}';
    envLabel.appendChild(env);

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "cx-dev-checkbox";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = server?.enabled !== false;
    enabledLabel.append(enabled, text("span", t("devWorkflows.enabledLabel")));

    const error = text("div", "", "cx-form-error hidden");
    const actions = document.createElement("div");
    actions.className = "cx-dev-inline-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t("devWorkflows.backBtn");
    cancel.addEventListener("click", () => void show());
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "primary";
    save.textContent = t("devWorkflows.saveBtn");
    actions.append(cancel, save);

    form.append(name.label, scopeLabel, transportLabel, target.label, args.label, envLabel, enabledLabel, error, actions);
    modalBody.appendChild(form);

    const updateTargetLabel = () => {
      target.label.querySelector("span")!.textContent = transport.value === "http"
        ? t("devWorkflows.endpointLabel")
        : t("devWorkflows.commandLabel");
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
          if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(t("devWorkflows.envMustBeObject"));
          payload.env = parsed;
        }
        await api("/mcp", { method: "POST", body: JSON.stringify({ server: payload }) });
        showToast(t("devWorkflows.mcpSavedToast"));
        await show();
      })().catch(cause => {
        error.textContent = devError(cause);
        error.classList.remove("hidden");
      }).finally(() => {
        save.disabled = false;
      });
    });
  }

  function renderCapabilities(capabilities: Json, settings: Json) {
    const project = projectRequired();

    const add = makeAction(t("devWorkflows.addBtn"), async () => editMcpServer(null));
    add.setAttribute("aria-label", t("devWorkflows.addMcpAria"));
    const mcpSection = section(t("devWorkflows.mcpSectionTitle"), SYSTEM_ICONS.hosts, t("devWorkflows.mcpSectionSubtitle"), add);

    const servers = Array.isArray(capabilities.mcp) ? capabilities.mcp : [];
    if (!servers.length) mcpSection.appendChild(stateView("empty", t("devWorkflows.noMcpServers")));
    for (const server of servers) {
      const card = document.createElement("div");
      card.className = "cx-dev-mcp-card";
      const head = document.createElement("div");
      head.className = "cx-dev-result-head";
      head.append(text("strong", String(server.name || "MCP")), statusBadge(server.enabled === false ? "disabled" : "enabled"));
      card.appendChild(head);
      const target = server.transport === "http" ? server.endpoint : [server.command, ...(server.args || [])].filter(Boolean).join(" ");
      card.appendChild(text("small", String(server.scope || "global") + " · " + String(server.transport || "") + " · " + String(target || ""), "cx-muted"));
      if (server.env && Object.keys(server.env).length) card.appendChild(details(t("devWorkflows.envMasked"), pretty(server.env)));

      const actions = document.createElement("div");
      actions.className = "cx-dev-inline-actions";
      actions.append(
        makeAction(t("devWorkflows.testBtn"), async button => {
          const result = await api<Json>("/mcp/test", {
            method: "POST",
            body: JSON.stringify({ projectId: project.id, serverId: server.id })
          });
          button.textContent = result.ok
            ? t("devWorkflows.connectedCheck")
            : t("devWorkflows.errorWithReason", { reason: translateServerMessage(String(result.error || result.state)) });
        }),
        makeAction(t("devWorkflows.editBtn"), async () => editMcpServer(server)),
        makeAction(server.enabled === false ? t("devWorkflows.enableBtn") : t("devWorkflows.disableBtn"), async () => {
          await api("/mcp/enabled", {
            method: "PUT",
            body: JSON.stringify({ serverId: server.id, enabled: server.enabled === false })
          });
          await show();
        }),
        makeAction(t("devWorkflows.deleteBtn"), async () => {
          if (!confirm(t("devWorkflows.deleteMcpConfirm", { name: String(server.name || "MCP") }))) return;
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

    const capabilitySection = section(t("devWorkflows.skillsRulesTitle"), SYSTEM_ICONS.guide, t("devWorkflows.skillsRulesSubtitle"));
    const skills = Array.isArray(capabilities.skills) ? capabilities.skills : [];
    const rules = Array.isArray(capabilities.rules) ? capabilities.rules : [];
    const activeThreadId = getActiveThreadId();
    const projectSkillKey = skillStorageKey("project", project.id);
    const threadSkillKey = activeThreadId ? skillStorageKey("thread", activeThreadId) : "";
    const projectSelected = new Set(readSkillSelections(projectSkillKey).map(item => item.id));
    const threadSelected = new Set(threadSkillKey ? readSkillSelections(threadSkillKey).map(item => item.id) : []);

    for (const skill of skills) {
      const card = document.createElement("div");
      card.className = "cx-dev-skill-card";
      const head = document.createElement("div");
      head.className = "cx-dev-result-head";
      head.append(
        text("strong", String(skill.name || t("devWorkflows.skillFallbackName"))),
        statusBadge(skill.trusted ? "trusted" : "untrusted")
      );
      card.appendChild(head);
      card.appendChild(text(
        "small",
        [
          skill.scope,
          skill.source,
          skill.path || t("devWorkflows.noFilePath"),
          t("devWorkflows.precedenceLabel", { value: String(skill.precedence ?? "?") })
        ].filter(Boolean).join(" · "),
        "cx-muted"
      ));
      if (skill.description) card.appendChild(text("p", String(skill.description), "cx-muted"));

      if (skill.path) {
        const toggles = document.createElement("div");
        toggles.className = "cx-dev-inline-actions";

        const projectToggle = document.createElement("label");
        projectToggle.className = "cx-dev-checkbox cx-dev-skill-toggle";
        const projectBox = document.createElement("input");
        projectBox.type = "checkbox";
        projectBox.checked = projectSelected.has(String(skill.id));
        projectBox.addEventListener("change", () => {
          writeSkillSelection(projectSkillKey, skill, projectBox.checked);
          showToast(t(projectBox.checked ? "devWorkflows.projectSkillEnabledToast" : "devWorkflows.projectSkillDisabledToast"));
        });
        projectToggle.append(projectBox, text("span", t("devWorkflows.projectDefaultLabel")));

        const sessionToggle = document.createElement("label");
        sessionToggle.className = "cx-dev-checkbox cx-dev-skill-toggle";
        const sessionBox = document.createElement("input");
        sessionBox.type = "checkbox";
        sessionBox.disabled = !activeThreadId;
        sessionBox.checked = Boolean(activeThreadId && threadSelected.has(String(skill.id)));
        sessionBox.addEventListener("change", () => {
          if (!threadSkillKey) return;
          writeSkillSelection(threadSkillKey, skill, sessionBox.checked);
          showToast(t(sessionBox.checked ? "devWorkflows.sessionSkillEnabledToast" : "devWorkflows.sessionSkillDisabledToast"));
        });
        sessionToggle.append(
          sessionBox,
          text("span", activeThreadId ? t("devWorkflows.currentSessionLabel") : t("devWorkflows.currentSessionAfterChat"))
        );

        toggles.append(projectToggle, sessionToggle);
        card.appendChild(toggles);
      } else {
        card.appendChild(text("p", t("devWorkflows.inspectOnlySkillWarning"), "cx-dev-warning"));
      }
      capabilitySection.appendChild(card);
    }

    const skillDetails = skills.map((skill: Json) => ({
      name: skill.name,
      scope: skill.scope,
      source: skill.source,
      path: skill.path,
      trusted: skill.trusted,
      precedence: skill.precedence
    }));
    const ruleDetails = rules.map((rule: Json) => ({
      scope: rule.scope,
      source: rule.source,
      trusted: rule.trusted,
      precedence: rule.precedence,
      preview: String(rule.content || "").slice(0, 240)
    }));
    capabilitySection.append(jsonDetails([
      [t("devWorkflows.effectiveSkillsLabel", { count: formatNumber(skills.length) }), pretty({ precedence: capabilities.skillsPrecedence, skills: skillDetails })],
      [t("devWorkflows.effectiveRulesLabel", { count: formatNumber(rules.length) }), pretty({ precedence: capabilities.rulesPrecedence, rules: ruleDetails })]
    ]));
    modalBody.appendChild(capabilitySection);

    const extensionSection = section(t("devWorkflows.extensionTitle"), SYSTEM_ICONS.extensions, "devmoter.extension.json · manifestVersion 1");
    if (!capabilities.extension?.present) {
      extensionSection.appendChild(stateView("empty", t("devWorkflows.noExtensionManifest")));
    } else {
      const extension = capabilities.extension;
      extensionSection.append(
        statusBadge(extension.valid ? (extension.approved ? "approved" : "approval required") : "invalid"),
        text("p", t("devWorkflows.extensionSource", { source: String(extension.source || "devmoter.extension.json") }), "cx-muted"),
        details(
          extension.valid ? t("devWorkflows.manifestPermissionsSummary") : t("devWorkflows.validationErrorsSummary"),
          pretty(extension.valid ? extension.manifest : extension.errors),
          !extension.valid
        )
      );
      if (extension.valid && extension.approvalRequired) {
        extensionSection.appendChild(text(
          "p",
          t("devWorkflows.explicitPermissionsWarning"),
          "cx-dev-warning"
        ));
        extensionSection.appendChild(makeAction(t("devWorkflows.approvePermissionsBtn"), async button => {
          if (!confirm(t("devWorkflows.approvePermissionsConfirm"))) return;
          await api("/extension/approve", {
            method: "POST",
            body: JSON.stringify({ projectId: project.id })
          });
          button.textContent = t("devWorkflows.approvedBtn");
          await show();
        }, true));
      } else if (extension.valid) {
        extensionSection.appendChild(text("p", t("devWorkflows.permissionsApprovedNote"), "cx-dev-success"));
      }
    }
    modalBody.appendChild(extensionSection);

    const adapterSection = section(t("devWorkflows.adaptersTitle"), getAppDefinition("agents").icon, t("devWorkflows.adaptersSubtitle"));
    for (const adapter of Array.isArray(capabilities.adapters) ? capabilities.adapters : []) {
      const row = document.createElement("div");
      row.className = "cx-dev-check-row";
      const copy = document.createElement("span");
      copy.append(
        text("strong", String(adapter.id || "adapter")),
        text("small", String(adapter.protocol || "") + " · " + (adapter.native ? t("devWorkflows.adapterNative") : t("devWorkflows.adapterOptional")))
      );
      row.append(copy, statusBadge(adapter.enabled ? "enabled" : "disabled"));
      adapterSection.appendChild(row);
    }
    const acpConfig = settings?.adapters?.acp;
    if (acpConfig?.enabled) {
      adapterSection.appendChild(makeAction(t("devWorkflows.connectionTestBtn"), async button => {
        const result = await api<Json>("/acp/probe", {
          method: "POST",
          body: JSON.stringify({ projectId: project.id })
        });
        button.textContent = result.ok
          ? t("devWorkflows.acpConnectedCheck")
          : t("devWorkflows.acpStatus", { status: translateServerMessage(String(result.error || result.state)) });
      }));
    }
    adapterSection.appendChild(jsonDetails([[t("devWorkflows.negotiationLabel"), pretty(capabilities.negotiation)]]));
    modalBody.appendChild(adapterSection);
  }

  async function show() {
    closeSidebar();
    // Opened from ☰ / Home right after the chat surface mounts, the saved
    // Project may still be loading. Decide only after the owner has resolved it,
    // so a selected Project never flashes "select a project".
    openModal(t("devWorkflows.panelTitle"), getActiveProject()?.name || "");
    modalBody.replaceChildren(stateView("loading", t("devWorkflows.loading")));
    if (!getActiveProject() && options.whenProjectReady) await options.whenProjectReady().catch(() => undefined);
    const project = getActiveProject();
    openModal(t("devWorkflows.panelTitle"), project ? project.name : t("devWorkflows.selectProjectSubtitle"));

    if (!project) {
      modalBody.replaceChildren(text("p", t("devWorkflows.selectProjectBody"), "cx-muted"));
      return;
    }

    try {
      const [capabilities, settingsPayload] = await Promise.all([
        api<Json>("/capabilities?projectId=" + encodeURIComponent(project.id)),
        api<Json>("/settings")
      ]);
      const settings = settingsPayload.settings || {};

      modalBody.replaceChildren();

      const reviewSection = section(t("devWorkflows.reviewCiTitle"), getAppDefinition("review").icon, t("devWorkflows.reviewCiSubtitle"));
      const prRow = document.createElement("div");
      prRow.className = "cx-dev-pr-row";
      const prInput = document.createElement("input");
      prInput.type = "number";
      prInput.min = "1";
      prInput.inputMode = "numeric";
      prInput.placeholder = t("devWorkflows.prPlaceholder");
      prInput.value = prNumber;
      prInput.addEventListener("input", () => {
        prNumber = prInput.value.trim();
        if (prNumber) localStorage.setItem("devmoter-pr-number", prNumber);
        else localStorage.removeItem("devmoter-pr-number");
      });
      const reviewButton = makeAction(t("devWorkflows.aiReviewBtn"), async () => {
        const value = prInput.value.trim();
        if (!/^\d+$/.test(value)) throw new Error(t("devWorkflows.enterPrNumberError"));
        reviewResult.replaceChildren(stateView("loading", t("devWorkflows.runningReadOnlyReview")));
        const result = await api<Json>("/review", {
          method: "POST",
          body: JSON.stringify({ projectId: project.id, prNumber: value, mode: "pr" })
        });
        renderReviewResult(result, reviewResult, value);
      }, true);
      const ciButton = makeAction(t("devWorkflows.ciBtn"), async () => {
        const value = prInput.value.trim();
        if (!/^\d+$/.test(value)) throw new Error(t("devWorkflows.enterPrNumberError"));
        ciResult.replaceChildren(stateView("loading", t("devWorkflows.fetchingChecks")));
        const result = await api<Json>("/ci", {
          method: "POST",
          body: JSON.stringify({ projectId: project.id, prNumber: value, includeLogs: true })
        });
        renderCiResult(result, ciResult);
      });
      prRow.append(prInput, reviewButton, ciButton);
      reviewSection.appendChild(prRow);

      const finalButton = makeAction(t("devWorkflows.reviewDiffBtn"), async () => {
        reviewResult.replaceChildren(stateView("loading", t("devWorkflows.runningFinalReview")));
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

      const verifySection = section(t("devWorkflows.verificationTitle"), SYSTEM_ICONS.check, t("devWorkflows.verificationSubtitle"));
      const verifyActions = document.createElement("div");
      verifyActions.className = "cx-dev-inline-actions";
      const verifyResult = document.createElement("div");
      verifyResult.className = "cx-dev-result";
      verifyActions.append(
        makeAction(t("devWorkflows.verifyBtn"), async () => {
          verifyResult.replaceChildren(stateView("loading", t("devWorkflows.runningVerification")));
          const result = await api<Json>("/verify", {
            method: "POST",
            body: JSON.stringify({ projectId: project.id })
          });
          renderVerification(result, verifyResult);
        }, true),
        makeAction(t("devWorkflows.autoRepairBtn"), async () => {
          verifyResult.replaceChildren(stateView("loading", t("devWorkflows.runningRepairLoop")));
          const result = await api<Json>("/repair", {
            method: "POST",
            body: JSON.stringify({ projectId: project.id })
          });
          renderVerification(result, verifyResult, t("devWorkflows.autoRepairTitle"));
        })
      );
      verifySection.append(verifyActions, verifyResult);
      if (!Array.isArray(settings?.verification?.commands) || !settings.verification.commands.length) {
        verifySection.appendChild(text("p", t("devWorkflows.noVerifyCommandsWarning"), "cx-dev-warning"));
      }
      modalBody.appendChild(verifySection);

      renderCapabilities(capabilities, settings);
    } catch (error) {
      modalBody.replaceChildren(stateView("error", devError(error)));
    }
  }

  return { show };
}
