type ThemeMode = "system" | "light" | "dark";
type Json = Record<string, any>;

const THEME_KEY = "devmoter-theme";
const CONTEXT_THRESHOLD_KEY = "devmoter-context-threshold";
const LAST_COMPACT_KEY = "devmoter-last-auto-compact";
const TRANSCRIPT_WINDOW = 180;
const RAW_OUTPUT_LIMIT = 12_000;
// Chat surfaces own Markdown and raw text state; never rehydrate them from DOM.
const TRANSCRIPT_SELECTOR = ".cx-transcript, .ocx-transcript";

function workspaceControlFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  return fetch(input, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store"
  });
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!
  ));
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
  window.dispatchEvent(new CustomEvent("devmoter:theme-changed", { detail: { mode, resolved } }));
}

function estimateTokens() {
  const selector = document.body.classList.contains("codex-mode") ? ".cx-transcript"
    : document.body.classList.contains("opencode-mode") ? ".ocx-transcript"
    : document.body.classList.contains("api-mode") ? ".api-transcript" : null;
  const text = selector ? document.querySelector<HTMLElement>(selector)?.innerText || "" : "";
  // A display-length heuristic only. Never reconstruct a prompt or claim backend usage from it.
  return Math.ceil(text.length / 4);
}

export type WorkspaceCommand = "theme" | "context" | "checkpoints" | "extensions";
export const WORKSPACE_COMMAND_EVENT = "devmoter:workspace-command";
const isWorkspaceCommand = (value: unknown): value is WorkspaceCommand =>
  value === "theme" || value === "context" || value === "checkpoints" || value === "extensions";

/**
 * Theme, display-history, checkpoint and extension controls are commands, not
 * a docked button group: the global ☰ menu and Settings dispatch
 * `devmoter:workspace-command` and the single body-level panel answers.
 */
function createWorkspacePanel() {
  const panel = document.createElement("div");
  panel.className = "dm-panel hidden";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "DevMoter controls");
  document.body.appendChild(panel);

  const activeSessionId = () => {
    const backend = localStorage.getItem("opencode-pocket-backend");
    if (backend === "codex") {
      return localStorage.getItem("opencode-pocket-codex-thread") || "browser";
    }
    if (backend === "opencode") {
      return localStorage.getItem("opencode-pocket-opencode-session") || "browser";
    }
    return (
      (backend === "api" ? "api-browser" : localStorage.getItem("opencode-pocket-opencode-session")) ||
      localStorage.getItem("opencode-pocket-codex-thread") ||
      "browser"
    );
  };

  const closePanel = () => panel.classList.add("hidden");
  const panelHead = (title: string) =>
    `<div class="dm-panel-head"><strong>${escapeHtml(title)}</strong><button type="button" data-close aria-label="閉じる">×</button></div>`;
  const wireClose = () => panel.querySelector("[data-close]")?.addEventListener("click", closePanel);

  const themeModes: ThemeMode[] = ["system", "light", "dark"];
  const cycleTheme = () => {
    const current = (localStorage.getItem(THEME_KEY) as ThemeMode) || "system";
    applyTheme(themeModes[(themeModes.indexOf(current) + 1) % themeModes.length]);
  };

  let compactInFlight = false;
  async function requestCompaction(mode: "manual" | "auto", status?: HTMLElement) {
    if (compactInFlight) return;
    compactInFlight = true;
    try {
      const res = await workspaceControlFetch("/api/workspace-control/events/compact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId(), mode })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Compaction failed");
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
    const used = estimateTokens();
    const max = 128_000;
    const threshold = Number(localStorage.getItem(CONTEXT_THRESHOLD_KEY)) || 0.82;
    const ratio = Math.min(1, used / max);
    const lastCompactAt = Number(localStorage.getItem(LAST_COMPACT_KEY)) || 0;
    const eventViewSupported = (document.body.classList.contains("codex-mode") || document.body.classList.contains("opencode-mode")) && activeSessionId() !== "browser";
    if (eventViewSupported && ratio >= threshold && Date.now() - lastCompactAt > 5 * 60_000) {
      void requestCompaction("auto");
    }
    return { used, max, threshold, ratio, lastCompactAt, eventViewSupported };
  }

  const openContext = () => {
    const state = renderContext();
    panel.classList.remove("hidden");
    panel.innerHTML =
      panelHead("表示履歴の目安") +
      `<p>表示テキストからの概算: <strong>${state.used.toLocaleString()}</strong> token相当。実際にAIへ送信したtoken数やモデルの上限は、この画面では取得していません。</p>
       <label>表示整理の基準（${state.max.toLocaleString()} token相当）の割合 <input data-threshold type="range" min="0.5" max="0.95" step="0.01" value="${state.threshold}" ${state.eventViewSupported ? "" : "disabled"}><span>${Math.round(state.threshold * 100)}%</span></label>
       <button type="button" data-compact ${state.eventViewSupported ? "" : "disabled"}>イベント表示を整理</button>
       ${state.eventViewSupported ? "" : "<p>イベント整理はCodex / OpenCodeの会話を選択した場合に利用できます。API Chatの会話履歴はこの機能の対象外です。</p>"}
       <small>Last compaction: ${state.lastCompactAt ? new Date(state.lastCompactAt).toLocaleString() : "not yet"}</small>
       <small data-status>イベントの表示を整理する機能です。AIへ送る会話の圧縮、token削減、料金削減は行いません。元のイベント記録はサーバーに保持され、API Chatの会話履歴とは別です。</small>`;
    wireClose();
    const threshold = panel.querySelector<HTMLInputElement>("[data-threshold]")!;
    threshold.addEventListener("input", () => {
      localStorage.setItem(CONTEXT_THRESHOLD_KEY, threshold.value);
      threshold.nextElementSibling!.textContent =
        `${Math.round(Number(threshold.value) * 100)}%`;
      renderContext();
    });
    panel.querySelector("[data-compact]")?.addEventListener("click", () => {
      const status = panel.querySelector<HTMLElement>("[data-status]")!;
      void requestCompaction("manual", status);
    });
  };

  const openCheckpoints = async () => {
    const parentId = activeSessionId();
    panel.classList.remove("hidden");
    panel.innerHTML = panelHead("Task checkpoints") + "<p>Loading current micro-task…</p>";
    wireClose();
    try {
      const res = await workspaceControlFetch(
        `/api/workspace-control/microtasks?parentId=${encodeURIComponent(parentId)}`
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Could not load task plan");
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
          const save = await workspaceControlFetch("/api/workspace-control/microtasks", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              parentId,
              title: plan.title,
              current,
              status,
              steps
            })
          });
          const saved = await save.json();
          if (!save.ok) throw new Error(saved?.error || "Checkpoint update failed");
          void openCheckpoints();
        });
        actions.appendChild(button);
      }
    } catch (error) {
      panel.append(error instanceof Error ? error.message : String(error));
    }
  };

  const openExtensions = async () => {
    panel.classList.remove("hidden");
    panel.innerHTML = panelHead("Extensions") + "<p>Loading approved catalog…</p>";
    wireClose();
    try {
      const res = await workspaceControlFetch("/api/workspace-control");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load extensions");
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
          const change = await workspaceControlFetch(
            `/api/workspace-control/extensions/${encodeURIComponent(String(item.id))}`,
            { method: active ? "DELETE" : "POST" }
          );
          if (!change.ok) {
            const error = await change.json().catch(() => ({}));
            throw new Error(error?.error || "Extension update failed");
          }
          void openExtensions();
        });
        row.append(copy, button);
        list.appendChild(row);
      }
    } catch (error) {
      panel.append(error instanceof Error ? error.message : String(error));
    }
  };

  const onCommand = (event: Event) => {
    const command = (event as CustomEvent<{ command?: unknown }>).detail?.command;
    if (!isWorkspaceCommand(command)) return;
    if (command === "theme") cycleTheme();
    else if (command === "context") openContext();
    else if (command === "checkpoints") void openCheckpoints();
    else void openExtensions();
  };
  window.addEventListener(WORKSPACE_COMMAND_EVENT, onCommand);
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !panel.classList.contains("hidden")) closePanel();
  };
  const ownerDocument = document;
  ownerDocument.addEventListener("keydown", onKeydown);

  applyTheme((localStorage.getItem(THEME_KEY) as ThemeMode) || "system");
  renderContext();
  const contextTimer = window.setInterval(renderContext, 5000);
  const colorScheme = matchMedia("(prefers-color-scheme: dark)");
  const onColorScheme = () => {
    if ((localStorage.getItem(THEME_KEY) || "system") === "system") applyTheme("system");
  };
  colorScheme.addEventListener("change", onColorScheme);
  return () => {
    window.removeEventListener(WORKSPACE_COMMAND_EVENT, onCommand);
    ownerDocument.removeEventListener("keydown", onKeydown);
    window.clearInterval(contextTimer);
    colorScheme.removeEventListener?.("change", onColorScheme);
    panel.remove();
  };
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .dm-panel { position:fixed; z-index:95; right:max(12px,env(safe-area-inset-right)); bottom:max(12px,env(safe-area-inset-bottom)); width:min(380px,calc(100vw - 24px)); max-height:min(70dvh,620px); overflow:auto; overscroll-behavior:contain; padding:14px; border:1px solid color-mix(in srgb,currentColor 10%,transparent); border-radius:16px; background:var(--surface-card,Canvas); color:var(--text-primary,CanvasText); }
    .dm-panel.hidden { display:none; }
    .dm-panel-head { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .dm-panel-head { position:sticky; top:-14px; background:inherit; }
    .dm-panel button { min-height:44px; padding:0 12px; border:1px solid color-mix(in srgb,currentColor 10%,transparent); border-radius:8px; background:color-mix(in srgb,currentColor 6%,transparent); color:inherit; font:inherit; touch-action:manipulation; -webkit-tap-highlight-color:transparent; user-select:none; transition:transform 120ms cubic-bezier(0.23,1,0.32,1); }
    .dm-panel button:active { transform:scale(.97); }
    .dm-panel .dm-panel-head button { width:44px; padding:0; border:0; background:transparent; font-size:20px; }
    .dm-panel label,.dm-panel small { display:block; margin:8px 0; }
    .dm-panel p,.dm-panel li,.dm-panel small { color:inherit; }
    .dm-extension-list,.dm-task-list { display:grid; gap:8px; margin:10px 0; }
    .dm-extension-row,.dm-task-row { display:flex; gap:10px; justify-content:space-between; align-items:flex-start; padding:10px; border:1px solid color-mix(in srgb,currentColor 14%,transparent); border-radius:12px; }
    .dm-extension-row div,.dm-task-row div { display:grid; gap:2px; min-width:0; }
    .dm-extension-row small,.dm-task-row small { opacity:.72; overflow-wrap:anywhere; }
    .dm-task-row.current { outline:1px solid color-mix(in srgb,currentColor 35%,transparent); }
    .dm-task-actions { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
    .ocx-assistant-text p { margin:.35em 0; white-space:normal; }
    .ocx-assistant-text h1,.ocx-assistant-text h2,.ocx-assistant-text h3 { margin:.7em 0 .35em; }
    .dm-code { overflow:auto; max-height:50vh; padding:12px; border-radius:10px; background:color-mix(in srgb,currentColor 8%,transparent); }
    .dm-token-keyword { font-weight:700; }
    .dm-token-string { opacity:.82; }
    .dm-token-literal { text-decoration:underline dotted; }
    .dm-mermaid-fallback { display:grid; gap:6px; padding:10px; border:1px dashed color-mix(in srgb,currentColor 28%,transparent); border-radius:10px; }
    .dm-mermaid-fallback span { font-size:.82em; opacity:.72; }
    .dm-copy-raw { float:right; margin:4px 0; border:0; border-radius:8px; padding:5px 8px; }
    .dm-output-bounded { max-height:46vh; overflow:auto; }
    .dm-virtual-placeholder { width:100%; min-height:40px; border:1px dashed color-mix(in srgb,currentColor 25%,transparent); border-radius:10px; background:transparent; color:inherit; opacity:.78; }
  `;
  document.head.appendChild(style);
}

function enhanceNow(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLElement>(".ocx-tool-card, details[data-tool], .tool-call details")
    .forEach(enhanceToolOutput);
  root.querySelectorAll<HTMLElement>(TRANSCRIPT_SELECTOR).forEach(virtualizeTranscript);
}

export function startWorkspaceControl() {
  injectStyles();
  const stopPanel = createWorkspacePanel();
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
  return () => {
    observer.disconnect();
    stopPanel();
  };
}
