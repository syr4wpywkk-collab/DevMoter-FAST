import "./advanced.css";

type Project = { id: string; name: string; path: string; available?: boolean };
type Model = {
  id: string; label: string; providerId: string; local: boolean; available: boolean;
  capabilities?: { vision?: boolean; tools?: boolean; reasoning?: boolean; context?: number | null };
  limitation?: string;
};

type Preview =
  | { kind: "text"; name: string; path: string; size: number; language: string; content: string }
  | { kind: "image"; name: string; path: string; size: number; mime: string; data: string }
  | { kind: "binary"; name: string; path: string; size: number; reason: string };

function operationId() {
  return globalThis.crypto?.randomUUID?.() ??
    Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method || "GET").toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
      ...(mutating ? { "x-pocket-operation-id": operationId() } : {})
    }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || ("Request failed (" + res.status + ")"));
  return payload as T;
}

function element<K extends keyof HTMLElementTagNameMap>(name: K, className?: string) {
  const node = document.createElement(name);
  if (className) node.className = className;
  return node;
}

function setStatus(node: HTMLElement, value: unknown, isError = false) {
  node.textContent = String(value || "");
  node.classList.toggle("error", isError);
}

function highlightText(pre: HTMLElement, content: string, language: string) {
  pre.replaceChildren();
  const keywords: Record<string, Set<string>> = {
    javascript: new Set(["const", "let", "var", "function", "return", "async", "await", "if", "else", "for", "while", "class", "new", "import", "export", "from", "try", "catch", "throw"]),
    typescript: new Set(["const", "let", "var", "function", "return", "async", "await", "if", "else", "for", "while", "class", "new", "import", "export", "from", "type", "interface", "extends", "implements"]),
    python: new Set(["def", "return", "async", "await", "if", "else", "elif", "for", "while", "class", "import", "from", "try", "except", "raise", "with", "as"]),
    rust: new Set(["fn", "let", "mut", "pub", "impl", "struct", "enum", "match", "use", "mod", "trait", "where", "async", "await", "move", "return"])
  };
  const active = keywords[language];
  if (!active) {
    pre.textContent = content;
    return;
  }
  const tokens = content.split(/(\b[A-Za-z_][A-Za-z0-9_]*\b)/g);
  for (const token of tokens) {
    if (active.has(token)) {
      const span = element("span", "adv-token-keyword");
      span.textContent = token;
      pre.append(span);
    } else {
      pre.append(document.createTextNode(token));
    }
  }
}

function modelCompatible(model: Model, reqs: { vision: boolean; tools: boolean; reasoning: boolean }) {
  const caps = model.capabilities || {};
  return (!reqs.vision || caps.vision) &&
    (!reqs.tools || caps.tools) &&
    (!reqs.reasoning || caps.reasoning);
}

export function mountAdvancedTools() {
  const fab = element("button", "adv-fab");
  fab.type = "button";
  fab.textContent = "Tools";
  fab.setAttribute("aria-label", "Open DevMoter tools");
  document.body.append(fab);

  const drawer = element("aside", "adv-drawer hidden");
  drawer.setAttribute("aria-label", "DevMoter advanced tools");
  drawer.innerHTML =
    '<div class="adv-head"><div><strong>DevMoter Tools</strong><small>Preview · Models · Gallery · Sandbox</small></div><button type="button" data-close>×</button></div>' +
    '<div class="adv-scroll">' +
    '<section class="adv-section"><label>Project<select data-project></select></label><div class="adv-status" data-project-status></div></section>' +
    '<section class="adv-section"><h3>Project files</h3><div class="adv-row"><button type="button" data-browser-up>↑ Up</button><code data-browser-path>/</code><button type="button" data-browser-refresh>Refresh</button></div><div class="adv-list" data-file-browser></div></section>' +
    '<section class="adv-section"><h3>Safe file preview</h3><div class="adv-row"><input data-file-path placeholder="src/main.ts"/><button type="button" data-file-open>Preview</button></div><div class="adv-preview" data-preview></div></section>' +
    '<section class="adv-section"><h3>URL attachment</h3><div class="adv-row"><input data-url-input inputmode="url" placeholder="https://example.com/docs"/><button type="button" data-url-preview>Preview URL</button><button type="button" data-url-attach disabled>Fetch & attach</button></div><div class="adv-status" data-url-status>URL metadata is shown before any network fetch.</div></section>' +
    '<section class="adv-section"><h3>Generated outputs</h3><div class="adv-row"><input data-artifact-path placeholder="dist/report.json"/><button type="button" data-artifact-add>Add</button></div><input data-session placeholder="session id (optional)"/><div class="adv-list" data-artifacts></div></section>' +
    '<section class="adv-section"><h3>Live web preview</h3><div class="adv-row"><input data-preview-port inputmode="numeric" placeholder="3000"/><button type="button" data-preview-start>Start / restart</button><button type="button" data-preview-stop>Stop</button></div><div class="adv-status" data-live-status></div><iframe class="adv-frame hidden" data-live-frame sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"></iframe></section>' +
    '<section class="adv-section"><h3>Browser automation</h3><div class="adv-status">Opt-in · approved live preview only · isolated temporary profile · no personal browser cookies.</div><div class="adv-row"><button type="button" data-agent-browser-start>Start browser</button><button type="button" data-agent-browser-inspect>Inspect DOM</button><button type="button" data-agent-browser-stop>Stop</button></div><div class="adv-status" data-agent-browser-status>Checking…</div><pre class="adv-code hidden" data-agent-browser-result></pre></section>' +
    '<section class="adv-section"><h3>Models</h3><div class="adv-checks"><label><input type="checkbox" data-cap="vision"/>Vision</label><label><input type="checkbox" data-cap="tools"/>Tools</label><label><input type="checkbox" data-cap="reasoning"/>Reasoning</label></div><select data-model></select><div class="adv-row"><input data-model-prompt placeholder="Test prompt for selected route"/><button type="button" data-model-run>Run</button></div><div class="adv-status" data-model-status></div><pre class="adv-code hidden" data-model-result></pre></section>' +
    '<section class="adv-section"><h3>Directory grants</h3><div class="adv-row"><input data-grant-path placeholder="/home/me/shared"/><select data-grant-mode><option value="read">Read</option><option value="read-write">Read/write</option></select><button type="button" data-grant-add>Grant</button></div><div class="adv-list" data-grants></div></section>' +
    '<section class="adv-section"><h3>OS sandbox</h3><div class="adv-status" data-sandbox>Checking…</div></section>' +
    "</div>";
  document.body.append(drawer);

  const q = <T extends Element>(selector: string) => drawer.querySelector<T>(selector)!;
  const projectSelect = q<HTMLSelectElement>("[data-project]");
  const projectStatus = q<HTMLElement>("[data-project-status]");
  const previewBox = q<HTMLElement>("[data-preview]");
  const fileBrowser = q<HTMLElement>("[data-file-browser]");
  const browserPath = q<HTMLElement>("[data-browser-path]");
  const urlInput = q<HTMLInputElement>("[data-url-input]");
  const urlStatus = q<HTMLElement>("[data-url-status]");
  const urlAttach = q<HTMLButtonElement>("[data-url-attach]");
  const artifactList = q<HTMLElement>("[data-artifacts]");
  const grantList = q<HTMLElement>("[data-grants]");
  const modelSelect = q<HTMLSelectElement>("[data-model]");
  const modelStatus = q<HTMLElement>("[data-model-status]");
  const liveStatus = q<HTMLElement>("[data-live-status]");
  const liveFrame = q<HTMLIFrameElement>("[data-live-frame]");
  const agentBrowserStatus = q<HTMLElement>("[data-agent-browser-status]");
  const agentBrowserResult = q<HTMLPreElement>("[data-agent-browser-result]");
  let models: Model[] = [];
  let currentBrowserPath = "";
  let previewedUrl = "";

  const projectId = () => projectSelect.value;

  function appendUrlAttachmentToComposer(source: string, title: string, text: string) {
    const candidates = [
      document.querySelector<HTMLTextAreaElement>("#codexView #cxPromptInput"),
      document.querySelector<HTMLTextAreaElement>("#openCodeView #ocxPromptInput")
    ].filter((node): node is HTMLTextAreaElement => Boolean(node));
    const input = candidates.find(node => !node.closest(".hidden") && !node.disabled);
    if (!input) throw new Error("Open a Codex/OpenCode composer before attaching a URL");
    const block = "\n\n[URL attachment: " + (title || source) + "]\nSource: " + source + "\n" + text + "\n[/URL attachment]\n";
    input.value = input.value + block;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  async function loadFileBrowser(path = currentBrowserPath) {
    if (!projectId()) return;
    try {
      const data = await api<{
        browser: {
          path: string;
          parent: string | null;
          entries: Array<{ name: string; path: string; kind: string; size: number | null; previewable?: boolean }>;
          truncated: boolean;
        };
      }>("/api/projects/" + encodeURIComponent(projectId()) + "/files?path=" + encodeURIComponent(path));
      currentBrowserPath = data.browser.path;
      browserPath.textContent = "/" + currentBrowserPath;
      fileBrowser.replaceChildren();
      if (!data.browser.entries.length) fileBrowser.textContent = "No visible files in this directory.";
      for (const item of data.browser.entries) {
        const row = element("div", "adv-item");
        const open = element("button");
        open.type = "button";
        open.textContent = (item.kind === "directory" ? "📁 " : "📄 ") + item.name;
        open.addEventListener("click", () => {
          if (item.kind === "directory") void loadFileBrowser(item.path);
          else if (item.previewable) {
            q<HTMLInputElement>("[data-file-path]").value = item.path;
            void showPreview(item.path);
          }
        });
        if (item.kind !== "directory" && !item.previewable) open.disabled = true;
        const meta = element("small");
        meta.textContent = item.kind + (item.size == null ? "" : " · " + item.size.toLocaleString() + " B");
        row.append(open, meta);
        fileBrowser.append(row);
      }
      if (data.browser.truncated) {
        const note = element("div", "adv-status");
        note.textContent = "Directory list truncated for safety.";
        fileBrowser.append(note);
      }
    } catch (error) {
      fileBrowser.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function previewUrl() {
    previewedUrl = "";
    urlAttach.disabled = true;
    const raw = urlInput.value.trim();
    if (!raw) return;
    try {
      const data = await api<{ preview: { normalizedUrl: string; host: string; port: number; path: string } }>(
        "/api/attachments/url/preview",
        { method: "POST", body: JSON.stringify({ url: raw }) }
      );
      previewedUrl = data.preview.normalizedUrl;
      setStatus(urlStatus, data.preview.host + ":" + data.preview.port + data.preview.path + " · no network request made yet");
      urlAttach.disabled = false;
    } catch (error) {
      setStatus(urlStatus, error instanceof Error ? error.message : String(error), true);
    }
  }

  async function fetchAndAttachUrl() {
    if (!previewedUrl || previewedUrl !== urlInput.value.trim()) {
      await previewUrl();
      if (!previewedUrl) return;
    }
    urlAttach.disabled = true;
    setStatus(urlStatus, "Fetching bounded public webpage…");
    try {
      const data = await api<{
        attachment: { name: string; source: string; size: number; mime: string };
        text: string;
        redirects: unknown[];
      }>("/api/attachments/url/fetch", {
        method: "POST",
        body: JSON.stringify({ url: previewedUrl })
      });
      appendUrlAttachmentToComposer(data.attachment.source, data.attachment.name, data.text);
      setStatus(urlStatus, "Attached " + data.attachment.size.toLocaleString() + " B as inert extracted text · " + data.redirects.length + " redirect(s)");
    } catch (error) {
      setStatus(urlStatus, error instanceof Error ? error.message : String(error), true);
    } finally {
      urlAttach.disabled = false;
    }
  }

  async function loadProjects() {
    try {
      const data = await api<{ projects: Project[] }>("/api/projects");
      projectSelect.replaceChildren();
      for (const project of data.projects) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = project.name;
        option.disabled = project.available === false;
        projectSelect.append(option);
      }
      setStatus(projectStatus, data.projects.length ? (data.projects.length + " project(s)") : "Register a project first.");
      if (projectSelect.value) await Promise.all([loadArtifacts(), loadLivePreview(), loadFileBrowser(""), loadAgentBrowser()]);
    } catch (error) {
      setStatus(projectStatus, error instanceof Error ? error.message : String(error), true);
    }
  }

  async function showPreview(path: string) {
    previewBox.replaceChildren();
    if (!projectId()) return;
    try {
      const data = await api<{ preview: Preview }>(
        "/api/projects/" + encodeURIComponent(projectId()) + "/preview?path=" + encodeURIComponent(path)
      );
      const preview = data.preview;
      const meta = element("div", "adv-status");
      meta.textContent = preview.name + " · " + preview.size.toLocaleString() + " bytes";
      previewBox.append(meta);
      if (preview.kind === "image") {
        const img = element("img");
        img.alt = preview.name;
        img.src = "data:" + preview.mime + ";base64," + preview.data;
        previewBox.append(img);
      } else if (preview.kind === "text") {
        const pre = element("pre", "adv-code language-" + preview.language);
        highlightText(pre, preview.content, preview.language);
        previewBox.append(pre);
      } else {
        const fallback = element("div", "adv-binary");
        fallback.textContent = "Preview unavailable: " + preview.reason;
        previewBox.append(fallback);
      }
    } catch (error) {
      const message = element("div", "adv-status error");
      message.textContent = error instanceof Error ? error.message : String(error);
      previewBox.append(message);
    }
  }

  async function loadArtifacts() {
    if (!projectId()) return;
    const session = q<HTMLInputElement>("[data-session]").value.trim();
    try {
      const data = await api<{ artifacts: Array<{ id: string; name: string; path: string; size: number }> }>(
        "/api/projects/" + encodeURIComponent(projectId()) + "/artifacts?session=" + encodeURIComponent(session)
      );
      artifactList.replaceChildren();
      if (!data.artifacts.length) {
        artifactList.textContent = "No registered outputs for this session.";
        return;
      }
      for (const item of data.artifacts) {
        const row = element("div", "adv-item");
        const label = element("span");
        label.textContent = item.name + " · " + item.size.toLocaleString() + " B";
        const preview = element("button");
        preview.type = "button";
        preview.textContent = "Preview";
        preview.addEventListener("click", async () => {
          try {
            const payload = await api<{ preview: Preview }>(
              "/api/artifacts/" + encodeURIComponent(item.id) + "/preview"
            );
            previewBox.replaceChildren();
            if (payload.preview.kind === "text") {
              const pre = element("pre", "adv-code");
              highlightText(pre, payload.preview.content, payload.preview.language);
              previewBox.append(pre);
            } else if (payload.preview.kind === "image") {
              const img = element("img");
              img.alt = payload.preview.name;
              img.src = "data:" + payload.preview.mime + ";base64," + payload.preview.data;
              previewBox.append(img);
            } else {
              previewBox.textContent = "Preview unavailable: " + payload.preview.reason;
            }
          } catch (error) {
            setStatus(projectStatus, error instanceof Error ? error.message : String(error), true);
          }
        });
        const download = element("a");
        download.textContent = "Download";
        download.href = "/api/artifacts/" + encodeURIComponent(item.id) + "/download";
        row.append(label, preview, download);
        artifactList.append(row);
      }
    } catch (error) {
      artifactList.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadLivePreview() {
    if (!projectId()) return;
    try {
      const data = await api<{ preview: null | { host: string; port: number; url: string } }>(
        "/api/projects/" + encodeURIComponent(projectId()) + "/web-preview"
      );
      if (!data.preview) {
        setStatus(liveStatus, "Stopped");
        liveFrame.classList.add("hidden");
        liveFrame.removeAttribute("src");
        return;
      }
      setStatus(liveStatus, data.preview.host + ":" + data.preview.port + " · running");
      liveFrame.src = data.preview.url;
      liveFrame.classList.remove("hidden");
    } catch (error) {
      setStatus(liveStatus, error instanceof Error ? error.message : String(error), true);
    }
  }

  async function loadAgentBrowser() {
    if (!projectId()) {
      setStatus(agentBrowserStatus, "Select a project first.");
      return;
    }
    try {
      const data = await api<{
        capability: { enabled: boolean; available: boolean; binary?: string | null; version?: string | null };
        session: null | { active: boolean; sandboxed: boolean; startedAt: number };
      }>("/api/advanced/browser?projectId=" + encodeURIComponent(projectId()));
      const capability = data.capability;
      const session = data.session;
      if (!capability.enabled) {
        setStatus(agentBrowserStatus, "Disabled · set DEVMOTER_BROWSER_AUTOMATION=1 to opt in.");
      } else if (!capability.available) {
        setStatus(agentBrowserStatus, "Enabled, but Chromium/Chrome was not found.", true);
      } else if (session?.active) {
        setStatus(agentBrowserStatus, (capability.binary || "browser") + " · active · " + (session.sandboxed ? "bwrap" : "unsandboxed/preferred"));
      } else {
        setStatus(agentBrowserStatus, (capability.binary || "browser") + " · ready · start an approved live preview first.");
      }
    } catch (error) {
      setStatus(agentBrowserStatus, error instanceof Error ? error.message : String(error), true);
    }
  }

  async function startAgentBrowser() {
    if (!projectId()) return;
    agentBrowserResult.classList.add("hidden");
    try {
      const data = await api<{ session: { active: boolean; sandboxed: boolean } }>(
        "/api/advanced/browser/start",
        { method: "POST", body: JSON.stringify({ projectId: projectId() }) }
      );
      setStatus(agentBrowserStatus, "Active · " + (data.session.sandboxed ? "OS sandboxed" : "preferred mode / bwrap unavailable"));
      await loadAgentBrowser();
    } catch (error) {
      setStatus(agentBrowserStatus, error instanceof Error ? error.message : String(error), true);
    }
  }

  async function inspectAgentBrowser() {
    if (!projectId()) return;
    agentBrowserResult.classList.remove("hidden");
    agentBrowserResult.textContent = "Inspecting approved live preview…";
    try {
      const data = await api<{ inspection: { content: string; truncated: boolean; sandboxed: boolean } }>(
        "/api/advanced/browser/inspect",
        { method: "POST", body: JSON.stringify({ projectId: projectId() }) }
      );
      agentBrowserResult.textContent = data.inspection.content +
        (data.inspection.truncated ? "\n\n[DOM output truncated by DevMoter]" : "");
      setStatus(agentBrowserStatus, "Inspection complete · " + (data.inspection.sandboxed ? "OS sandboxed" : "preferred mode"));
    } catch (error) {
      agentBrowserResult.textContent = error instanceof Error ? error.message : String(error);
      setStatus(agentBrowserStatus, agentBrowserResult.textContent, true);
    }
  }

  async function stopAgentBrowser() {
    if (!projectId()) return;
    try {
      await api("/api/advanced/browser/stop", {
        method: "POST",
        body: JSON.stringify({ projectId: projectId() })
      });
      agentBrowserResult.classList.add("hidden");
      setStatus(agentBrowserStatus, "Stopped");
      await loadAgentBrowser();
    } catch (error) {
      setStatus(agentBrowserStatus, error instanceof Error ? error.message : String(error), true);
    }
  }

  function refreshModelOptions() {
    const reqs = {
      vision: q<HTMLInputElement>('[data-cap="vision"]').checked,
      tools: q<HTMLInputElement>('[data-cap="tools"]').checked,
      reasoning: q<HTMLInputElement>('[data-cap="reasoning"]').checked
    };
    const selected = modelSelect.value;
    modelSelect.replaceChildren();
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.providerId + "/" + model.id;
      option.textContent =
        (model.local ? "Local" : "Remote") + " · " + model.providerId + " · " + model.label +
        (model.available ? "" : " (discovery unavailable)");
      option.disabled = !modelCompatible(model, reqs);
      modelSelect.append(option);
    }
    if (Array.from(modelSelect.options).some(option => option.value === selected && !option.disabled)) {
      modelSelect.value = selected;
    }
    const compatible = models.filter(model => modelCompatible(model, reqs)).length;
    setStatus(
      modelStatus,
      compatible + "/" + models.length + " compatible · capability metadata comes from server config/discovery"
    );
  }

  async function loadModels() {
    try {
      const data = await api<{ models: Model[] }>("/api/advanced/models");
      models = data.models;
      refreshModelOptions();
    } catch (error) {
      setStatus(modelStatus, error instanceof Error ? error.message : String(error), true);
    }
  }

  async function loadGrants() {
    try {
      const data = await api<{ grants: Array<{ id: string; path: string; mode: string }> }>(
        "/api/advanced/grants"
      );
      grantList.replaceChildren();
      if (!data.grants.length) {
        grantList.textContent = "No extra directory grants.";
        return;
      }
      for (const grant of data.grants) {
        const row = element("div", "adv-item");
        const label = element("span");
        label.textContent = grant.mode + " · " + grant.path;
        const revoke = element("button");
        revoke.type = "button";
        revoke.textContent = "Revoke";
        revoke.addEventListener("click", async () => {
          await api("/api/advanced/grants/" + encodeURIComponent(grant.id), { method: "DELETE" });
          await loadGrants();
        });
        row.append(label, revoke);
        grantList.append(row);
      }
    } catch (error) {
      grantList.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadSandbox() {
    const node = q<HTMLElement>("[data-sandbox]");
    try {
      const data = await api<{
        mode: string; backend: string; available: boolean; enforced: boolean;
        scope: string; externalBackends: string; version?: string | null
      }>("/api/advanced/sandbox");
      setStatus(
        node,
        data.backend + ": " + (data.available ? "available" : "unavailable") +
          " · mode " + data.mode +
          " · " + (data.enforced ? "enforced for DevMoter-owned agent tools" : "not enforced") +
          " · external backends " + data.externalBackends +
          (data.version ? " · " + data.version : ""),
        data.mode === "required" && !data.available
      );
    } catch (error) {
      setStatus(node, error instanceof Error ? error.message : String(error), true);
    }
  }

  fab.addEventListener("click", async () => {
    drawer.classList.remove("hidden");
    await Promise.all([loadProjects(), loadModels(), loadGrants(), loadSandbox()]);
  });
  q<HTMLButtonElement>("[data-close]").addEventListener("click", () => drawer.classList.add("hidden"));
  projectSelect.addEventListener("change", () => {
    currentBrowserPath = "";
    void Promise.all([loadArtifacts(), loadLivePreview(), loadFileBrowser(""), loadAgentBrowser()]);
  });
  q<HTMLButtonElement>("[data-browser-refresh]").addEventListener("click", () => void loadFileBrowser());
  q<HTMLButtonElement>("[data-browser-up]").addEventListener("click", () => {
    const next = currentBrowserPath.includes("/")
      ? currentBrowserPath.slice(0, currentBrowserPath.lastIndexOf("/"))
      : "";
    void loadFileBrowser(next);
  });
  q<HTMLButtonElement>("[data-url-preview]").addEventListener("click", () => void previewUrl());
  urlAttach.addEventListener("click", () => void fetchAndAttachUrl());
  urlInput.addEventListener("input", () => {
    previewedUrl = "";
    urlAttach.disabled = true;
    setStatus(urlStatus, "URL changed · preview it before fetching.");
  });
  q<HTMLButtonElement>("[data-file-open]").addEventListener("click", () =>
    void showPreview(q<HTMLInputElement>("[data-file-path]").value.trim())
  );
  q<HTMLInputElement>("[data-session]").addEventListener("change", () => void loadArtifacts());
  q<HTMLButtonElement>("[data-artifact-add]").addEventListener("click", async () => {
    if (!projectId()) return;
    try {
      await api("/api/projects/" + encodeURIComponent(projectId()) + "/artifacts", {
        method: "POST",
        body: JSON.stringify({
          sessionId: q<HTMLInputElement>("[data-session]").value.trim() || "default",
          path: q<HTMLInputElement>("[data-artifact-path]").value.trim(),
          rootId: "project"
        })
      });
      await loadArtifacts();
    } catch (error) {
      setStatus(projectStatus, error instanceof Error ? error.message : String(error), true);
    }
  });
  q<HTMLButtonElement>("[data-preview-start]").addEventListener("click", async () => {
    if (!projectId()) return;
    try {
      await api("/api/projects/" + encodeURIComponent(projectId()) + "/web-preview", {
        method: "POST",
        body: JSON.stringify({
          port: Number(q<HTMLInputElement>("[data-preview-port]").value),
          host: "127.0.0.1"
        })
      });
      await loadLivePreview();
    } catch (error) {
      setStatus(liveStatus, error instanceof Error ? error.message : String(error), true);
    }
  });
  q<HTMLButtonElement>("[data-preview-stop]").addEventListener("click", async () => {
    if (!projectId()) return;
    await api("/api/projects/" + encodeURIComponent(projectId()) + "/web-preview", { method: "DELETE" });
    await loadLivePreview();
  });
  q<HTMLButtonElement>("[data-agent-browser-start]").addEventListener("click", () => void startAgentBrowser());
  q<HTMLButtonElement>("[data-agent-browser-inspect]").addEventListener("click", () => void inspectAgentBrowser());
  q<HTMLButtonElement>("[data-agent-browser-stop]").addEventListener("click", () => void stopAgentBrowser());
  drawer.querySelectorAll<HTMLInputElement>("[data-cap]").forEach(input =>
    input.addEventListener("change", refreshModelOptions)
  );
  q<HTMLButtonElement>("[data-model-run]").addEventListener("click", async () => {
    const prompt = q<HTMLInputElement>("[data-model-prompt]").value.trim();
    if (!prompt || !modelSelect.value) return;
    const [providerId, ...modelParts] = modelSelect.value.split("/");
    const model = modelParts.join("/");
    const requirements = {
      vision: q<HTMLInputElement>('[data-cap="vision"]').checked,
      tools: q<HTMLInputElement>('[data-cap="tools"]').checked,
      reasoning: q<HTMLInputElement>('[data-cap="reasoning"]').checked
    };
    const result = q<HTMLPreElement>("[data-model-result]");
    result.classList.remove("hidden");
    result.textContent = "Running…";
    try {
      const payload = await api<{
        text: string;
        handledBy: { providerId: string; model: string };
        routing: { reason?: string };
      }>("/api/advanced/models/run", {
        method: "POST",
        body: JSON.stringify({
          role: "coding",
          messages: [{ role: "user", content: prompt }],
          requirements,
          override: { providerId, model }
        })
      });
      result.textContent =
        payload.text + "\n\nHandled by: " +
        payload.handledBy.providerId + "/" + payload.handledBy.model;
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  q<HTMLButtonElement>("[data-grant-add]").addEventListener("click", async () => {
    try {
      await api("/api/advanced/grants", {
        method: "POST",
        body: JSON.stringify({
          path: q<HTMLInputElement>("[data-grant-path]").value.trim(),
          mode: q<HTMLSelectElement>("[data-grant-mode]").value
        })
      });
      q<HTMLInputElement>("[data-grant-path]").value = "";
      await loadGrants();
    } catch (error) {
      grantList.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}
