type ThemeMode = "system" | "light" | "dark";
type Json = Record<string, any>;

const THEME_KEY = "devmoter-theme";
const CONTEXT_THRESHOLD_KEY = "devmoter-context-threshold";
const LAST_COMPACT_KEY = "devmoter-last-auto-compact";
const TRANSCRIPT_WINDOW = 180;
const RAW_OUTPUT_LIMIT = 12_000;
const RICH_SELECTOR =
  ".cx-message-row.assistant:not(.live) .cx-message-text, .ocx-message-row.assistant:not(.live) .ocx-assistant-text";
const TRANSCRIPT_SELECTOR = ".cx-transcript, .ocx-transcript";

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!
  ));
}

function operationId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

async function sharedApi(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const method = String(init.method || "GET").toUpperCase();
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD") headers.set("x-pocket-operation-id", "shared-" + operationId());
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Shared control request failed");
  return payload;
}

function safeUrl(value: string) {
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function renderInline(source: string) {
  let text = escapeHtml(source);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_all, label: string, href: string) => {
    const url = safeUrl(href);
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
  });
  return text;
}

function highlight(source: string, language: string) {
  let html = escapeHtml(source);
  const lang = language.toLowerCase();
  if (["js", "javascript", "ts", "typescript", "tsx", "jsx", "mjs"].includes(lang)) {
    html = html
      .replace(/\b(const|let|var|function|class|interface|type|return|if|else|for|while|async|await|import|from|export|new|throw|try|catch|extends|implements)\b/g, '<span class="dm-token-keyword">$1</span>')
      .replace(/\b(true|false|null|undefined|\d+(?:\.\d+)?)\b/g, '<span class="dm-token-literal">$1</span>')
      .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g, '<span class="dm-token-string">$1</span>');
  } else if (lang === "json") {
    html = html.replace(/(&quot;.*?&quot;)(\s*:)?/g, '<span class="dm-token-string">$1</span>$2');
  } else if (["py", "python"].includes(lang)) {
    html = html.replace(/\b(def|class|return|if|else|elif|for|while|async|await|import|from|as|try|except|raise|with|yield|lambda|True|False|None)\b/g, '<span class="dm-token-keyword">$1</span>');
  } else if (["sh", "bash", "shell", "zsh"].includes(lang)) {
    html = html.replace(/(^|\s)(cd|git|npm|pnpm|yarn|node|curl|export|systemctl|sudo|echo)(?=\s|$)/gm, '$1<span class="dm-token-keyword">$2</span>');
  }
  return html;
}

export function renderSafeMarkdown(source: string) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inFence = false;
  let fenceLang = "";
  let fence: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) html.push("</ul>");
    listOpen = false;
  };

  for (const line of lines) {
    const marker = line.match(/^```\s*([\w+-]*)\s*$/);
    if (marker) {
      if (!inFence) {
        closeList();
        inFence = true;
        fenceLang = marker[1] || "text";
        fence = [];
      } else {
        const raw = fence.join("\n");
        if (fenceLang.toLowerCase() === "mermaid") {
          html.push(
            `<div class="dm-mermaid-fallback" role="note"><strong>Mermaid preview disabled</strong><span>Diagram source is shown as text because no sandboxed Mermaid runtime is installed.</span><pre><code>${escapeHtml(raw)}</code></pre></div>`
          );
        } else {
          html.push(
            `<pre class="dm-code"><code data-language="${escapeHtml(fenceLang)}">${highlight(raw, fenceLang)}</code></pre>`
          );
        }
        inFence = false;
        fenceLang = "";
        fence = [];
      }
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const item = line.match(/^\s*[-*+]\s+(.+)$/);
    if (item) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInline(item[1])}</li>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }
  if (inFence) html.push(`<pre class="dm-code"><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  closeList();
  return html.join("\n");
}

function enhanceAssistantText(node: HTMLElement) {
  if (node.dataset.dmRich === "1") return;
  const source = node.textContent || "";
  if (!source.trim()) return;
  node.dataset.dmSource = source;
  node.innerHTML = renderSafeMarkdown(source);
  node.dataset.dmRich = "1";
}

function enhanceToolOutput(details: HTMLElement) {
  if (details.dataset.dmTool === "1") return;
  details.dataset.dmTool = "1";
  const summary = details.querySelector("summary");
  const urgent =
    details.classList.contains("error") ||
    details.classList.contains("failed") ||
    /error|failed|approval/i.test(summary?.textContent || "");
  if (!urgent && details instanceof HTMLDetailsElement) details.open = false;

  details.querySelectorAll("pre").forEach(pre => {
    const raw = pre.textContent || "";
    pre.dataset.dmRaw = raw;
    if (raw.length > RAW_OUTPUT_LIMIT) {
      pre.textContent =
        `${raw.slice(0, RAW_OUTPUT_LIMIT)}\n\n… ${raw.length - RAW_OUTPUT_LIMIT} more characters hidden`;
      pre.classList.add("dm-output-bounded");
    }
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "dm-copy-raw";
    copy.textContent = "Copy raw";
    copy.addEventListener("click", () => void navigator.clipboard?.writeText(raw));
    pre.insertAdjacentElement("beforebegin", copy);
  });
}

function virtualizeTranscript(transcript: HTMLElement) {
  const children = Array.from(transcript.children).filter(
    child => !child.classList.contains("dm-virtual-placeholder")
  );
  if (children.length <= TRANSCRIPT_WINDOW) return;
  const excess = children.length - TRANSCRIPT_WINDOW;
  children.slice(0, excess).forEach(child => child.remove());
  let placeholder = transcript.querySelector<HTMLButtonElement>(".dm-virtual-placeholder");
  if (!placeholder) {
    placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = "dm-virtual-placeholder";
    placeholder.addEventListener("click", () => {
      placeholder!.textContent =
        "Older transcript remains canonical on the server. Reopen/reload the session to replay it.";
    });
    transcript.prepend(placeholder);
  }
  const previous = Number(placeholder.dataset.hidden || 0);
  placeholder.dataset.hidden = String(previous + excess);
  placeholder.textContent =
    `${previous + excess} earlier transcript items virtualized · tap for replay note`;
}

function applyTheme(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode);
  const resolved =
    mode === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.dataset.devmoterTheme = resolved;
  document.documentElement.dataset.devmoterThemeMode = mode;
}

function estimateTokens() {
  const transcripts = Array.from(document.querySelectorAll<HTMLElement>(TRANSCRIPT_SELECTOR));
  return Math.max(0, Math.ceil(transcripts.map(item => item.innerText).join("\n").length / 4));
}

function createToolbar() {
  const host = document.createElement("section");
  host.className = "dm-controlbar";
  host.setAttribute("aria-label", "DevMoter control plane");
  host.innerHTML = `
    <button type="button" class="dm-theme" aria-label="Theme">◐ <span>System</span></button>
    <button type="button" class="dm-context" aria-label="Context usage">◒ <span>Context</span></button>
    <button type="button" class="dm-tasks" aria-label="Task checkpoints">✓ <span>Tasks</span></button>
    <button type="button" class="dm-extensions" aria-label="Extensions">＋ <span>Extensions</span></button>
    <div class="dm-panel hidden" role="dialog" aria-label="DevMoter controls"></div>
  `;
  document.body.appendChild(host);

  const themeButton = host.querySelector<HTMLButtonElement>(".dm-theme")!;
  const contextButton = host.querySelector<HTMLButtonElement>(".dm-context")!;
  const tasksButton = host.querySelector<HTMLButtonElement>(".dm-tasks")!;
  const extensionsButton = host.querySelector<HTMLButtonElement>(".dm-extensions")!;
  const panel = host.querySelector<HTMLDivElement>(".dm-panel")!;

  const activeBackendKind = (): "codex" | "opencode" =>
    document.body.classList.contains("codex-mode") ? "codex" : "opencode";

  const activeSessionId = () => {
    const backend = activeBackendKind();
    return (
      backend === "codex"
        ? localStorage.getItem("opencode-pocket-codex-thread")
        : localStorage.getItem("opencode-pocket-opencode-session")
    ) || "browser";
  };

  const closePanel = () => panel.classList.add("hidden");
  const panelHead = (title: string) =>
    `<div class="dm-panel-head"><strong>${escapeHtml(title)}</strong><button type="button" data-close>×</button></div>`;
  const wireClose = () => panel.querySelector("[data-close]")?.addEventListener("click", closePanel);

  const themeModes: ThemeMode[] = ["system", "light", "dark"];
  themeButton.addEventListener("click", () => {
    const current = (localStorage.getItem(THEME_KEY) as ThemeMode) || "system";
    const next = themeModes[(themeModes.indexOf(current) + 1) % themeModes.length];
    applyTheme(next);
    themeButton.querySelector("span")!.textContent =
      next[0].toUpperCase() + next.slice(1);
  });

  let compactInFlight = false;
  let contextConfig = {
    threshold: Number(localStorage.getItem(CONTEXT_THRESHOLD_KEY)) || 0.82,
    maxTokens: 128000
  };
  let contextTelemetry = { tokens: 0, approximate: true };

  void sharedApi("/api/shared-control").then(data => {
    const threshold = Number(data?.context?.threshold);
    const maxTokens = Number(data?.context?.maxTokens);
    if (Number.isFinite(threshold)) contextConfig.threshold = threshold;
    if (Number.isFinite(maxTokens)) contextConfig.maxTokens = maxTokens;
  }).catch(() => {});

  async function refreshContextTelemetry() {
    const sessionId = activeSessionId();
    if (sessionId === "browser") return;
    try {
      const params = new URLSearchParams({
        backend: activeBackendKind(),
        sessionId
      });
      const payload = await sharedApi("/api/shared-control/context/status?" + params.toString());
      const tokens = Number(payload?.tokens);
      if (Number.isFinite(tokens) && tokens >= 0) {
        contextTelemetry = { tokens, approximate: Boolean(payload?.approximate ?? true) };
      }
      const threshold = Number(payload?.threshold);
      const maxTokens = Number(payload?.maxTokens);
      if (Number.isFinite(threshold)) contextConfig.threshold = threshold;
      if (Number.isFinite(maxTokens)) contextConfig.maxTokens = maxTokens;
    } catch {
      contextTelemetry = { tokens: estimateTokens(), approximate: true };
    }
  }

  async function requestCompaction(mode: "manual" | "auto", status?: HTMLElement) {
    if (compactInFlight) return;
    compactInFlight = true;
    try {
      const payload = await sharedApi("/api/shared-control/events/compact", {
        method: "POST",
        body: JSON.stringify({
          sessionId: activeSessionId(),
          backend: activeBackendKind(),
          mode
        })
      });
      localStorage.setItem(LAST_COMPACT_KEY, String(Date.now()));
      if (status) {
        status.textContent =
          `Compacted view created at cursor ${payload?.event?.cursor || "unknown"}.`;
      }
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      compactInFlight = false;
    }
  }

  function renderContext() {
    const fallback = estimateTokens();
    const used = contextTelemetry.tokens > 0 ? contextTelemetry.tokens : fallback;
    const max = Math.max(8000, contextConfig.maxTokens);
    const threshold = contextConfig.threshold;
    const ratio = Math.min(1, used / max);
    const lastCompactAt = Number(localStorage.getItem(LAST_COMPACT_KEY)) || 0;
    contextButton.querySelector("span")!.textContent = `${Math.round(ratio * 100)}% ctx`;
    contextButton.dataset.pressure =
      ratio >= threshold ? "high" : ratio >= threshold * 0.8 ? "medium" : "low";
    if (activeSessionId() !== "browser" && ratio >= threshold && Date.now() - lastCompactAt > 5 * 60_000) {
      void requestCompaction("auto");
    }
    return {
      used,
      max,
      threshold,
      ratio,
      lastCompactAt,
      approximate: contextTelemetry.approximate || contextTelemetry.tokens <= 0
    };
  }

  contextButton.addEventListener("click", () => {
    const state = renderContext();
    panel.classList.remove("hidden");
    panel.innerHTML =
      panelHead("Context") +
      `<p>Estimated usage: <strong>${state.used.toLocaleString()}</strong> / ${state.max.toLocaleString()} tokens (${Math.round(state.ratio * 100)}%). ${state.approximate ? "Approximate." : "Backend-reported."}</p>
       <label>Auto-compact threshold <input data-threshold type="range" min="0.5" max="0.95" step="0.01" value="${state.threshold}"><span>${Math.round(state.threshold * 100)}%</span></label>
       <button type="button" data-compact>Compact event view</button>
       <small>Last compaction: ${state.lastCompactAt ? new Date(state.lastCompactAt).toLocaleString() : "not yet"}</small>
       <small data-status>Canonical transcript remains server-side; compacting never deletes it.</small>`;
    wireClose();
    const threshold = panel.querySelector<HTMLInputElement>("[data-threshold]")!;
    threshold.addEventListener("input", () => {
      const value = Number(threshold.value);
      localStorage.setItem(CONTEXT_THRESHOLD_KEY, threshold.value);
      contextConfig.threshold = value;
      threshold.nextElementSibling!.textContent =
        `${Math.round(value * 100)}%`;
      renderContext();
    });
    threshold.addEventListener("change", () => {
      void sharedApi("/api/shared-control/context", {
        method: "PUT",
        body: JSON.stringify({ threshold: Number(threshold.value), maxTokens: contextConfig.maxTokens })
      }).catch(() => {});
    });
    panel.querySelector("[data-compact]")?.addEventListener("click", () => {
      const status = panel.querySelector<HTMLElement>("[data-status]")!;
      void requestCompaction("manual", status);
    });
  });

  tasksButton.addEventListener("click", async () => {
    const parentId = activeSessionId();
    panel.classList.remove("hidden");
    panel.innerHTML = panelHead("Task checkpoints") + "<p>Loading current micro-task…</p>";
    wireClose();
    try {
      const payload = await sharedApi(
        `/api/shared-control/microtasks?parentId=${encodeURIComponent(parentId)}`
      );
      const plan = payload?.plan as Json | null;
      if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
        panel.innerHTML =
          panelHead("Task checkpoints") +
          "<p>No checkpoint plan is active for this session.</p><small>Agents can create one through the micro-task API; reconnect preserves it.</small>";
        wireClose();
        return;
      }
      const currentIndex = Math.max(
        0,
        Math.min(Number(plan.current) || 0, plan.steps.length - 1)
      );
      panel.innerHTML =
        panelHead(String(plan.title || "Task")) +
        `<div class="dm-task-list"></div><div class="dm-task-actions"></div><small>Step ${currentIndex + 1} of ${plan.steps.length}</small>`;
      wireClose();
      const list = panel.querySelector<HTMLElement>(".dm-task-list")!;
      plan.steps.forEach((step: Json, index: number) => {
        const row = document.createElement("div");
        row.className = `dm-task-row ${index === currentIndex ? "current" : ""}`;
        row.innerHTML =
          `<span>${index + 1}</span><div><strong>${escapeHtml(String(step.title || `Step ${index + 1}`))}</strong><small>${escapeHtml(String(step.status || "pending"))}${step.verification ? ` · ${escapeHtml(String(step.verification))}` : ""}</small></div>`;
        list.appendChild(row);
      });

      const actions = panel.querySelector<HTMLElement>(".dm-task-actions")!;
      const choices = [
        ["Continue", "running"],
        ["Looks good", "done"],
        ["Retry", "running"],
        ["Needs fix", "failed"],
        ["Stop", "stopped"]
      ] as const;
      for (const [label, statusValue] of choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", async () => {
          const steps = plan.steps.map((step: Json) => ({ ...step }));
          steps[currentIndex].status = statusValue;
          let current = currentIndex;
          let status = statusValue === "stopped" ? "stopped" : "running";
          if (statusValue === "done" && currentIndex < steps.length - 1) {
            current += 1;
            steps[current].status = "waiting";
          } else if (statusValue === "done") {
            status = "completed";
          }
          await sharedApi("/api/shared-control/microtasks", {
            method: "PUT",
            body: JSON.stringify({
              parentId,
              title: plan.title,
              current,
              status,
              steps
            })
          });
          tasksButton.click();
        });
        actions.appendChild(button);
      }
    } catch (error) {
      panel.append(error instanceof Error ? error.message : String(error));
    }
  });

  extensionsButton.addEventListener("click", async () => {
    panel.classList.remove("hidden");
    panel.innerHTML = panelHead("Extensions") + "<p>Loading approved catalog…</p>";
    wireClose();
    try {
      const data = await sharedApi("/api/shared-control");
      const installed = data.extensions?.installed || {};
      const items = data.extensions?.catalog || [];
      panel.innerHTML =
        panelHead("Extensions") + '<div class="dm-extension-list"></div>';
      wireClose();
      const list = panel.querySelector<HTMLElement>(".dm-extension-list")!;
      for (const item of items) {
        const active = Boolean(installed[item.id]);
        const row = document.createElement("div");
        row.className = "dm-extension-row";
        const copy = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = String(item.name || item.id);
        const meta = document.createElement("small");
        meta.textContent = `${item.version || ""} · ${item.source || ""}`;
        const permissions = document.createElement("small");
        permissions.textContent =
          `Permissions: ${Array.isArray(item.permissions) ? item.permissions.join(", ") : "none"}`;
        copy.append(name, meta, permissions);
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = active ? "Remove" : "Install";
        button.addEventListener("click", async () => {
          await sharedApi(
            `/api/shared-control/extensions/${encodeURIComponent(String(item.id))}`,
            { method: active ? "DELETE" : "POST" }
          );
          extensionsButton.click();
        });
        row.append(copy, button);
        list.appendChild(row);
      }
    } catch (error) {
      panel.append(error instanceof Error ? error.message : String(error));
    }
  });

  const initialTheme =
    ((localStorage.getItem(THEME_KEY) as ThemeMode) || "system");
  applyTheme(initialTheme);
  themeButton.querySelector("span")!.textContent =
    initialTheme[0].toUpperCase() + initialTheme.slice(1);
  void refreshContextTelemetry().finally(renderContext);
  window.setInterval(() => {
    void refreshContextTelemetry().finally(renderContext);
  }, 5000);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem(THEME_KEY) || "system") === "system") {
      applyTheme("system");
    }
  });
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    :root[data-devmoter-theme="light"] { color-scheme: light; }
    :root[data-devmoter-theme="dark"] { color-scheme: dark; }
    :root[data-devmoter-theme="light"] body { background:#f7f7f8 !important; color:#171717 !important; }
    :root[data-devmoter-theme="dark"] body { background:#111214 !important; color:#f5f5f5 !important; }
    .dm-controlbar { position:fixed; z-index:1100; right:max(10px,env(safe-area-inset-right)); bottom:max(10px,env(safe-area-inset-bottom)); display:flex; gap:6px; padding:6px; border:1px solid color-mix(in srgb,currentColor 18%,transparent); border-radius:14px; background:color-mix(in srgb,Canvas 92%,transparent); backdrop-filter:blur(14px); box-shadow:0 8px 30px rgba(0,0,0,.16); }
    .dm-controlbar>button { min-height:38px; border:0; border-radius:10px; padding:0 10px; background:color-mix(in srgb,currentColor 8%,transparent); color:inherit; }
    .dm-context[data-pressure="high"] { outline:2px solid currentColor; }
    .dm-panel { position:absolute; right:0; bottom:52px; width:min(380px,calc(100vw - 20px)); max-height:min(70vh,620px); overflow:auto; padding:14px; border:1px solid color-mix(in srgb,currentColor 18%,transparent); border-radius:16px; background:Canvas; color:CanvasText; box-shadow:0 18px 50px rgba(0,0,0,.25); }
    .dm-panel.hidden { display:none; }
    .dm-panel-head { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .dm-panel-head button { border:0; background:transparent; color:inherit; font-size:20px; }
    .dm-panel label,.dm-panel small { display:block; margin:8px 0; }
    .dm-extension-list,.dm-task-list { display:grid; gap:8px; margin:10px 0; }
    .dm-extension-row,.dm-task-row { display:flex; gap:10px; justify-content:space-between; align-items:flex-start; padding:10px; border:1px solid color-mix(in srgb,currentColor 14%,transparent); border-radius:12px; }
    .dm-extension-row div,.dm-task-row div { display:grid; gap:2px; min-width:0; }
    .dm-extension-row small,.dm-task-row small { opacity:.72; overflow-wrap:anywhere; }
    .dm-task-row.current { outline:1px solid color-mix(in srgb,currentColor 35%,transparent); }
    .dm-task-actions { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
    .dm-task-actions button { min-height:38px; border:0; border-radius:9px; padding:0 10px; }
    .cx-message-text p,.ocx-assistant-text p { margin:.35em 0; white-space:normal; }
    .cx-message-text h1,.cx-message-text h2,.cx-message-text h3,.ocx-assistant-text h1,.ocx-assistant-text h2,.ocx-assistant-text h3 { margin:.7em 0 .35em; }
    .dm-code { overflow:auto; max-height:50vh; padding:12px; border-radius:10px; background:color-mix(in srgb,currentColor 8%,transparent); }
    .dm-token-keyword { font-weight:700; }
    .dm-token-string { opacity:.82; }
    .dm-token-literal { text-decoration:underline dotted; }
    .dm-mermaid-fallback { display:grid; gap:6px; padding:10px; border:1px dashed color-mix(in srgb,currentColor 28%,transparent); border-radius:10px; }
    .dm-mermaid-fallback span { font-size:.82em; opacity:.72; }
    .dm-copy-raw { float:right; margin:4px 0; border:0; border-radius:8px; padding:5px 8px; }
    .dm-output-bounded { max-height:46vh; overflow:auto; }
    .dm-virtual-placeholder { width:100%; min-height:40px; border:1px dashed color-mix(in srgb,currentColor 25%,transparent); border-radius:10px; background:transparent; color:inherit; opacity:.78; }
    @media (max-width:640px) {
      .dm-controlbar>button span { display:none; }
      .dm-controlbar>button { width:40px; padding:0; }
    }
  `;
  document.head.appendChild(style);
}

function enhanceNow(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(RICH_SELECTOR).forEach(enhanceAssistantText);
  root
    .querySelectorAll<HTMLElement>(".ocx-tool-card, details[data-tool], .tool-call details")
    .forEach(enhanceToolOutput);
  root.querySelectorAll<HTMLElement>(TRANSCRIPT_SELECTOR).forEach(virtualizeTranscript);
}

export function startSharedControlPlane() {
  injectStyles();
  createToolbar();
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    window.setTimeout(() => {
      queued = false;
      enhanceNow();
    }, 250);
  };
  const observer = new MutationObserver(queue);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  enhanceNow();
  return () => observer.disconnect();
}
