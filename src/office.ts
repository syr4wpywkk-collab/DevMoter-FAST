import "./office.css";
import { apiModelLabel } from "./api-model-label.mjs";
import { createOfficeEditor, type EditorBlockData, type SaveInput } from "./office-editor";

type Doc = {
  id: string;
  name: string;
  revision: string;
  blocks: EditorBlockData[];
  warnings: string[];
  history: { revision: string; createdAt: string; source: string }[];
};
type DocMeta = { id: string; name: string; updatedAt: string; openedAt?: string };
type AiRun = {
  id: string;
  documentId?: string;
  revision?: string;
  status: string;
  edits?: { blockId: string; text: string }[];
  error?: string;
  sharing?: { excluded: number; truncated: boolean };
};
type Provider = { id: string; name: string; models: string[]; ready: boolean; projectId?: string };
type Pane = "list" | "editor" | "ai";

// Inline line icons (18px, 1.5 stroke) so the module also loads standalone in tests.
const svg = (paths: string) =>
  `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const H = '<path d="M2.5 4v10M8.5 4v10M2.5 9h6"/>';
const ICONS = {
  undo: svg('<path d="M6.5 4 3 7.5 6.5 11"/><path d="M3 7.5h7.5a3.75 3.75 0 0 1 0 7.5H8"/>'),
  redo: svg('<path d="M11.5 4 15 7.5 11.5 11"/><path d="M15 7.5H7.5a3.75 3.75 0 0 0 0 7.5H10"/>'),
  bold: svg('<path d="M5.5 3.5h4.25a2.75 2.75 0 0 1 0 5.5H5.5zM5.5 9h5a2.75 2.75 0 0 1 0 5.5h-5z"/>'),
  italic: svg('<path d="M11.5 3.5H7.5M10.5 14.5h-4M9.75 3.5l-1.5 11"/>'),
  underline: svg('<path d="M5 3v5.5a4 4 0 0 0 8 0V3M4 15.5h10"/>'),
  h1: svg(`${H}<path d="M12 6.5 14 5v9"/>`),
  h2: svg(`${H}<path d="M11.5 6.5a1.9 1.9 0 0 1 3.75.5c0 1.75-3.75 3.75-3.75 7h4"/>`),
  h3: svg(`${H}<path d="M11.5 5h3.75l-2 3.25a2.6 2.6 0 1 1-1.75 4.5"/>`),
  bullet: svg('<path d="M7 5h8M7 9h8M7 13h8"/><path d="M3.5 5h.01M3.5 9h.01M3.5 13h.01" stroke-width="2"/>'),
  ordered: svg('<path d="M8 5h7M8 9h7M8 13h7"/><path d="M3 3.75 4 3.25V7M3 11.25a1 1 0 0 1 2 .25c0 .75-2 1.5-2 2.25h2"/>'),
  left: svg('<path d="M3 4h12M3 7.5h8M3 11h12M3 14.5h8"/>'),
  center: svg('<path d="M3 4h12M5 7.5h8M3 11h12M5 14.5h8"/>'),
  right: svg('<path d="M3 4h12M7 7.5h8M3 11h12M7 14.5h8"/>'),
  justify: svg('<path d="M3 4h12M3 7.5h12M3 11h12M3 14.5h12"/>'),
  link: svg('<path d="M7.75 10.25a3 3 0 0 0 4.25 0l2.1-2.1a3 3 0 0 0-4.24-4.25L8.75 5"/><path d="M10.25 7.75a3 3 0 0 0-4.25 0l-2.1 2.1a3 3 0 0 0 4.24 4.25L9.25 13"/>'),
  close: svg('<path d="M4.5 4.5l9 9M13.5 4.5l-9 9"/>'),
  download: svg('<path d="M9 3v8.5M5.5 8 9 11.5 12.5 8M3.5 14.5h11"/>'),
  rename: svg('<path d="M11.5 3.5l3 3L6 15H3v-3z"/>'),
  remove: svg('<path d="M3.5 5h11M7.5 5V3.5h3V5M5 5l.7 9.5h6.6L13 5"/>'),
};
const TOOLS: [string, keyof typeof ICONS, string][] = [
  ["undo", "undo", "元に戻す"],
  ["redo", "redo", "やり直す"],
  ["|", "undo", ""],
  ["bold", "bold", "太字"],
  ["italic", "italic", "斜体"],
  ["underline", "underline", "下線"],
  ["|", "undo", ""],
  ["h1", "h1", "見出し1"],
  ["h2", "h2", "見出し2"],
  ["h3", "h3", "見出し3"],
  ["|", "undo", ""],
  ["bullet", "bullet", "箇条書き"],
  ["ordered", "ordered", "番号付きリスト"],
  ["|", "undo", ""],
  ["left", "left", "左揃え"],
  ["center", "center", "中央揃え"],
  ["right", "right", "右揃え"],
  ["justify", "justify", "両端揃え"],
  ["|", "undo", ""],
  ["link", "link", "リンク"],
];
const AUTOSAVE_MS = 1200;
const draftKey = (id: string) => `devmoter-office-draft:${id}`;

let mounted = false;
export function openOffice(options: { configureAi?: () => void } = {}) {
  if (mounted) {
    window.dispatchEvent(new Event("devmoter:show-office"));
    return;
  }
  mounted = true;
  const root = document.createElement("dialog");
  root.className = "dm-office";
  root.dataset.pane = "list";
  root.setAttribute("aria-labelledby", "office-title");
  root.setAttribute("data-i18n-skip", "");
  const tools = TOOLS.map(([id, icon, label]) =>
    id === "|"
      ? '<span class="office-tool-gap" aria-hidden="true"></span>'
      : `<button type="button" class="office-tool" data-tool="${id}" aria-label="${label}" title="${label}">${ICONS[icon]}</button>`,
  ).join("");
  // Header = title + primary + close, the same slots as the shared sheet header.
  root.innerHTML = `<header class="office-header" data-sheet-header><h1 id="office-title" class="office-title">Docs</h1><div class="office-header-actions"><button type="button" class="office-primary" data-new>新規</button><button type="button" class="office-icon-button" data-close aria-label="閉じる" title="閉じる">${ICONS.close}</button></div></header>
    <nav class="office-tabs" aria-label="表示の切り替え"><button type="button" data-pane-tab="list">文書</button><button type="button" data-pane-tab="editor">編集</button><button type="button" data-pane-tab="ai">AIに依頼</button></nav>
    <p class="office-error" data-error role="alert" hidden></p>
    <div class="office-layout">
      <aside class="office-side" aria-label="文書">
        <section class="office-section"><div class="office-section-head"><h2>文書</h2><button type="button" data-upload-open>DOCXを開く</button><input data-upload type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden></div><ul class="office-library" data-library></ul></section>
        <details class="office-section office-history"><summary>履歴と原本</summary><ul data-history></ul></details>
      </aside>
      <main class="office-main" aria-label="編集">
        <div class="office-doc-bar"><h2 data-name>文書が開かれていません</h2><span class="office-save-state" data-save-state role="status" aria-live="polite"></span><button type="button" class="office-retry" data-retry hidden>再試行</button><button type="button" class="office-icon-button" data-download aria-label="DOCXをダウンロード" title="DOCXをダウンロード" disabled>${ICONS.download}</button></div>
        <div class="office-toolbar" role="toolbar" aria-label="書式" data-toolbar>${tools}</div>
        <form class="office-link-form" data-link-form hidden><input type="url" inputmode="url" data-link-input placeholder="https://" aria-label="リンク先URL" autocomplete="off"><button type="submit">適用</button><button type="button" data-link-remove>解除</button><button type="button" data-link-cancel>キャンセル</button></form>
        <div class="office-scroll"><p class="office-note" data-note hidden></p><article class="office-page" data-page aria-label="文書本文" role="textbox" aria-multiline="true" spellcheck="true" hidden></article><div class="office-empty" data-empty><p>文書を選ぶか、新規作成してください。</p></div></div>
      </main>
      <aside class="office-ai" aria-label="AIに依頼">
        <h2>AIに依頼</h2>
        <div class="office-ai-setup" data-ai-unconfigured hidden><p>AIは未設定です。</p><button type="button" data-configure>AI設定を開く</button></div>
        <form data-ai-form hidden><label>依頼内容<textarea data-goal rows="3" placeholder="読みやすく簡潔な文章に整えて"></textarea></label><details><summary>使用するAIと共有対象</summary><label>Provider<select data-provider></select></label><label>Model<select data-model></select></label><label>Vault用Project<select data-project></select></label></details><p class="office-quiet" data-provider-notice></p><label class="office-consent"><input type="checkbox" data-share>必要な本文（最大24KB）を選択したAIへ共有する</label><div class="office-ai-actions"><button data-ai-send>変更案を作る</button><button type="button" data-stop hidden>停止</button></div></form>
        <p class="office-quiet" data-ai-status role="status" aria-live="polite"></p><div data-proposal></div>
      </aside>
    </div>`;
  document.body.append(root);
  const get = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const page = get("[data-page]");
  const provider = get<HTMLSelectElement>("[data-provider]");
  const model = get<HTMLSelectElement>("[data-model]");
  const project = get<HTMLSelectElement>("[data-project]");
  let doc: Doc | null = null;
  let providers: Provider[] = [];
  let run: AiRun | null = null;
  let busy = false;
  let poll: number | undefined;
  let dirty = false;
  let saving: Promise<void> | null = null;
  let saveError = "";
  let saveTimer: number | undefined;

  const error = (message = "") => {
    get("[data-error]").textContent = message;
    get("[data-error]").hidden = !message;
  };
  const api = async <T>(path: string, method = "GET", payload?: unknown): Promise<T> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = localStorage.getItem("devmoter-device-token");
    if (token) headers["x-devmoter-device-token"] = token;
    const response = await fetch(path, {
      method,
      headers,
      cache: "no-store",
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `操作に失敗しました (${response.status})`);
    return result;
  };
  const node = (tag: string, text = "", cls = "") => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const button = (text: string, action: () => void, cls = "") => {
    const e = document.createElement("button");
    e.type = "button";
    e.textContent = text;
    if (cls) e.className = cls;
    e.addEventListener("click", action);
    return e;
  };
  const iconButton = (icon: string, label: string, action: () => void) => {
    const e = button("", action, "office-icon-button");
    e.innerHTML = icon;
    e.setAttribute("aria-label", label);
    e.title = label;
    return e;
  };
  const task = async (action: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    error();
    controls();
    try {
      await action();
    } catch (e) {
      error((e as Error).message);
    } finally {
      busy = false;
      controls();
    }
  };
  const setPane = (pane: Pane) => {
    root.dataset.pane = pane;
    for (const tab of root.querySelectorAll<HTMLElement>("[data-pane-tab]"))
      tab.setAttribute("aria-current", String(tab.dataset.paneTab === pane));
  };

  // ------------------------------------------------------------ editor ---
  const editor = createOfficeEditor(page, {
    onChange: () => {
      if (!doc) return;
      dirty = true;
      saveError = "";
      try {
        sessionStorage.setItem(draftKey(doc.id), JSON.stringify({ revision: doc.revision, blocks: editor.payload().blocks }));
      } catch {
        /* storage full: autosave still runs */
      }
      scheduleSave();
      controls();
    },
    onLockedDelete: (label) => confirm(`この${label}を文書から削除しますか？（元に戻すで戻せます）`),
  });
  const scheduleSave = () => {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), AUTOSAVE_MS);
  };
  /** Save now (autosave, retry, before switching documents). Resolves when nothing is pending. */
  const save = async (): Promise<void> => {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = undefined;
    if (saving) {
      await saving;
      if (dirty && !saveError) return save();
      return;
    }
    if (!doc || !dirty) return;
    const current = doc;
    const { blocks, keys } = editor.payload();
    dirty = false;
    saveError = "";
    saving = (async () => {
      controls();
      try {
        const saved = await api<Doc>(`/api/office/documents/${current.id}`, "PATCH", { revision: current.revision, blocks });
        if (doc?.id !== current.id) return;
        doc = saved;
        if (!editor.remap(keys, saved.blocks) && !dirty) editor.load(saved.blocks);
        if (!dirty) sessionStorage.removeItem(draftKey(saved.id));
        renderHistory();
        void library().catch(() => {});
      } catch (e) {
        dirty = true;
        saveError = (e as Error).message;
      }
    })();
    await saving;
    saving = null;
    controls();
    if (dirty && !saveError) scheduleSave();
  };
  const settle = async () => {
    await save();
    if (saveError) {
      if (!confirm(`保存できていない変更があります（${saveError}）。破棄して続けますか？`)) return false;
      if (doc) sessionStorage.removeItem(draftKey(doc.id));
      dirty = false;
      saveError = "";
    }
    return true;
  };

  const updateToolbar = () => {
    const state = editor.state();
    const enabled = !!doc && !busy;
    for (const tool of root.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      const id = tool.dataset.tool!;
      tool.disabled = !enabled || (id === "undo" && !state.canUndo) || (id === "redo" && !state.canRedo);
      const pressed =
        id === "bold" ? state.bold
        : id === "italic" ? state.italic
        : id === "underline" ? state.underline
        : /^h[123]$/.test(id) ? state.heading === Number(id[1])
        : id === "bullet" || id === "ordered" ? state.list === id
        : ["left", "center", "right", "justify"].includes(id) ? state.align === id
        : id === "link" ? state.link
        : undefined;
      if (pressed === undefined) tool.removeAttribute("aria-pressed");
      else tool.setAttribute("aria-pressed", String(pressed));
    }
  };
  const controls = () => {
    get<HTMLButtonElement>("[data-new]").disabled = busy;
    get<HTMLButtonElement>("[data-upload-open]").disabled = busy;
    get<HTMLButtonElement>("[data-download]").disabled = busy || !doc;
    get<HTMLButtonElement>("[data-ai-send]").disabled = busy || !doc || ["planning", "stop_requested"].includes(run?.status || "");
    const state = get("[data-save-state]");
    const label = !doc ? "" : saveError ? "保存できませんでした" : saving ? "保存中" : dirty ? "未保存" : "保存済み";
    state.textContent = label;
    state.dataset.state = !doc ? "" : saveError ? "error" : saving ? "saving" : dirty ? "dirty" : "saved";
    state.title = saveError;
    get("[data-retry]").hidden = !saveError;
    updateToolbar();
  };
  root.querySelector("[data-toolbar]")!.addEventListener("pointerdown", (e) => {
    // keep the caret (and the iOS keyboard) in the page while tapping a tool
    if ((e.target as Element).closest("[data-tool]")) e.preventDefault();
  });
  root.querySelector("[data-toolbar]")!.addEventListener("mousedown", (e) => {
    if ((e.target as Element).closest("[data-tool]")) e.preventDefault();
  });
  root.querySelector("[data-toolbar]")!.addEventListener("click", (e) => {
    const tool = (e.target as Element).closest<HTMLButtonElement>("[data-tool]");
    if (!tool || tool.disabled || !doc) return;
    const id = tool.dataset.tool!;
    if (id === "undo") editor.undo();
    else if (id === "redo") editor.redo();
    else if (id === "bold" || id === "italic" || id === "underline") editor.inline(id);
    else if (/^h[123]$/.test(id)) editor.toggleHeading(Number(id[1]));
    else if (id === "bullet" || id === "ordered") editor.toggleList(id);
    else if (id === "left" || id === "center" || id === "right" || id === "justify") editor.align(id);
    else if (id === "link") openLinkForm();
    updateToolbar();
  });
  const linkForm = get<HTMLFormElement>("[data-link-form]");
  const linkInput = get<HTMLInputElement>("[data-link-input]");
  const openLinkForm = () => {
    linkInput.value = editor.linkHref();
    get("[data-link-remove]").hidden = !editor.state().link;
    linkForm.hidden = false;
    linkInput.focus();
  };
  const closeLinkForm = () => {
    linkForm.hidden = true;
    editor.focus();
  };
  linkForm.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      editor.setLink(linkInput.value.trim());
      closeLinkForm();
    } catch (err) {
      error((err as Error).message);
    }
  });
  get("[data-link-remove]").addEventListener("click", () => {
    editor.setLink(null);
    closeLinkForm();
  });
  get("[data-link-cancel]").addEventListener("click", closeLinkForm);
  document.addEventListener("selectionchange", () => {
    if (root.open && doc) updateToolbar();
  });
  get("[data-retry]").addEventListener("click", () => {
    saveError = "";
    void save();
  });

  // ----------------------------------------------------------- library ---
  const library = async () => {
    const docs = await api<DocMeta[]>("/api/office/documents");
    const list = get("[data-library]");
    list.replaceChildren();
    for (const item of docs) {
      const row = node("li", "", "office-doc-row");
      if (item.id === doc?.id) row.setAttribute("aria-current", "true");
      const open = button("", () => void openDocument(item.id), "office-doc-open");
      open.append(node("span", item.name, "office-doc-name"), node("span", when(item.openedAt || item.updatedAt), "office-doc-meta"));
      row.append(
        open,
        iconButton(ICONS.rename, `「${item.name}」の名前を変更`, () => startRename(row, item)),
        iconButton(ICONS.remove, `「${item.name}」を削除`, () => void removeDocument(item)),
      );
      list.append(row);
    }
    if (!docs.length) list.append(node("li", "まだ文書はありません。", "office-quiet"));
  };
  const when = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const diff = Date.now() - date.getTime();
    if (diff < 7 * 864e5)
      return new Intl.DateTimeFormat("ja-JP", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
    return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  };
  const startRename = (row: HTMLElement, item: DocMeta) => {
    const form = document.createElement("form");
    form.className = "office-rename";
    const input = document.createElement("input");
    input.value = item.name.replace(/\.docx$/i, "");
    input.setAttribute("aria-label", "新しい文書名");
    input.maxLength = 150;
    const submit = document.createElement("button");
    submit.textContent = "保存";
    form.append(input, submit, button("キャンセル", () => void library()));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void task(async () => {
        const meta = await api<DocMeta>(`/api/office/documents/${item.id}/rename`, "POST", { name: input.value });
        if (doc?.id === item.id) {
          doc.name = meta.name;
          get("[data-name]").textContent = meta.name;
        }
        await library();
      });
    });
    row.replaceChildren(form);
    input.focus();
    input.select();
  };
  const removeDocument = async (item: DocMeta) => {
    if (!confirm(`「${item.name}」を削除しますか？原本と履歴も削除され、元に戻せません。`)) return;
    await task(async () => {
      await api(`/api/office/documents/${item.id}`, "DELETE");
      sessionStorage.removeItem(draftKey(item.id));
      if (doc?.id === item.id) closeDocument();
      if (localStorage.getItem("devmoter-office-document") === item.id) localStorage.removeItem("devmoter-office-document");
      await library();
    });
  };
  const closeDocument = () => {
    doc = null;
    dirty = false;
    saveError = "";
    editor.clear();
    page.hidden = true;
    get("[data-empty]").hidden = false;
    get("[data-name]").textContent = "文書が開かれていません";
    get("[data-note]").hidden = true;
    get("[data-history]").replaceChildren();
    controls();
  };
  const openDocument = (id: string) =>
    task(async () => {
      if (doc && doc.id !== id && !(await settle())) return;
      showDoc(await api<Doc>(`/api/office/documents/${id}`));
      setPane("editor");
      await library();
    });

  const renderHistory = () => {
    const history = get("[data-history]");
    history.replaceChildren();
    if (!doc) return;
    const current = doc;
    for (const item of [...current.history].reverse()) {
      const row = node("li", "", "office-history-row");
      const label = `${item.source === "original" ? "原本" : item.source === "restore" ? "復元" : "保存"} · ${new Date(item.createdAt).toLocaleString("ja-JP")}`;
      row.append(button(label, () => download(item.revision), "office-history-open"));
      if (item.revision !== current.revision)
        row.append(
          button("この版に戻す", () =>
            void task(async () => {
              if (!confirm("この版を新しい履歴として復元しますか？未保存の変更は破棄されます。")) return;
              if (saveTimer) window.clearTimeout(saveTimer);
              if (saving) await saving;
              sessionStorage.removeItem(draftKey(current.id));
              dirty = false;
              showDoc(await api<Doc>(`/api/office/documents/${current.id}/restore`, "POST", { revision: doc!.revision, target: item.revision }));
              await library();
            }),
          ),
        );
      history.append(row);
    }
  };
  const showDoc = (data: Doc) => {
    doc = data;
    dirty = false;
    saveError = "";
    localStorage.setItem("devmoter-office-document", data.id);
    get("[data-name]").textContent = data.name;
    const note = data.warnings.filter((w) => !/プレビュー/.test(w)).join(" ");
    get("[data-note]").textContent = note;
    get("[data-note]").hidden = !note;
    get("[data-empty]").hidden = true;
    page.hidden = false;
    editor.load(data.blocks);
    renderHistory();
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey(data.id)) || "null");
      if (saved?.revision === data.revision && Array.isArray(saved.blocks)) {
        if (editor.loadDraft(saved.blocks as SaveInput[])) {
          dirty = true;
          scheduleSave();
        }
      } else if (saved?.blocks?.length) {
        sessionStorage.removeItem(draftKey(data.id));
        error("以前の下書きがありますが、保存版が変わったため適用していません。");
      }
    } catch {
      error("下書きを復元できませんでした。");
    }
    controls();
    if (run) renderRun();
  };
  const download = async (revision?: string) => {
    if (!doc) return;
    if (!revision && !(await settle())) return;
    window.location.assign(`/api/office/documents/${doc.id}/download${revision ? `?revision=${revision}` : ""}`);
  };

  // ---------------------------------------------------------------- AI ---
  const aiReady = () => providers.some((p) => p.ready);
  const renderAiSetup = () => {
    const ready = aiReady();
    get("[data-ai-unconfigured]").hidden = ready;
    get("[data-ai-form]").hidden = !ready;
  };
  const fillModels = () => {
    model.replaceChildren();
    const selected = providers.find((p) => p.id === provider.value);
    for (const value of selected?.models || []) model.append(new Option(apiModelLabel(value), value));
    const saved = localStorage.getItem(`devmoter-api-model:${provider.value}`);
    if (saved && [...model.options].some((o) => o.value === saved)) model.value = saved;
    get("[data-provider-notice]").textContent = selected?.ready
      ? `使用するAI: ${selected.name} / ${apiModelLabel(model.value)}`
      : "このProviderは未設定です。別のProviderを選んでください。";
  };
  provider.addEventListener("change", fillModels);
  model.addEventListener("change", fillModels);
  const renderRun = () => {
    const status = {
      planning: "AIが変更案を作っています…",
      proposed: "変更案ができました。確認して本文へ反映してください。",
      stop_requested: "停止を要求しました。",
      stopped: "停止しました。本文は変更していません。",
      failed: "変更案を作成できませんでした。",
      unknown: "実行状態を照合できません。",
    };
    get("[data-ai-status]").textContent = run
      ? (status[run.status as keyof typeof status] || run.status) + (run.error ? ` ${run.error}` : "")
      : "";
    get("[data-stop]").hidden = !["planning", "stop_requested"].includes(run?.status || "");
    const proposal = get("[data-proposal]");
    proposal.replaceChildren();
    if (run?.sharing && (run.sharing.excluded || run.sharing.truncated))
      proposal.append(node("p", "安全上、一部本文をAIへの共有対象から除外しました。", "office-sharing-notice"));
    if (run?.status === "proposed" && run.documentId === doc?.id) {
      for (const edit of run.edits || []) {
        const details = document.createElement("details");
        details.open = true;
        details.append(
          node("summary", "段落の変更案"),
          node("del", doc?.blocks.find((b) => b.id === edit.blockId)?.text || ""),
          node("ins", edit.text),
        );
        proposal.append(details);
      }
      proposal.append(
        button("本文へ反映", () => {
          if (!doc || run?.documentId !== doc.id || run.revision !== doc.revision || dirty || saving) {
            error("未保存の変更があるか、文書が更新されています。保存が終わってからもう一度反映してください。");
            return;
          }
          for (const edit of run.edits || []) {
            const key = editor.blockKeyFor(edit.blockId);
            if (key) editor.replaceText(key, edit.text);
          }
          run = null;
          localStorage.removeItem("devmoter-office-ai-run");
          renderRun();
          setPane("editor");
        }, "office-primary"),
      );
    } else if (run?.status === "proposed" && run.documentId) {
      const target = run.documentId;
      proposal.append(button("変更案の対象文書を開く", () => void openDocument(target).then(renderRun)));
    }
    controls();
  };
  let pollGeneration = 0;
  const pollRun = async () => {
    if (!run || !root.open) return;
    const generation = ++pollGeneration;
    const id = run.id;
    try {
      const value = await api<AiRun>(`/api/office/ai/runs/${id}`);
      if (!root.open || generation !== pollGeneration || run?.id !== id) return;
      run = value;
      renderRun();
      if (["planning", "stop_requested"].includes(run.status)) poll = window.setTimeout(() => void pollRun(), 700);
    } catch (e) {
      if (!root.open || generation !== pollGeneration || run?.id !== id) return;
      error((e as Error).message);
      poll = window.setTimeout(() => void pollRun(), 3000);
    }
  };
  get("[data-ai-form]").addEventListener("submit", (e) => {
    e.preventDefault();
    void task(async () => {
      if (!doc) return;
      await save();
      if (dirty) throw new Error("AIへ依頼する前に本文の変更を保存してください。");
      run = await api<AiRun>("/api/office/ai/runs", "POST", {
        documentId: doc.id,
        revision: doc.revision,
        goal: get<HTMLTextAreaElement>("[data-goal]").value,
        providerId: provider.value,
        model: model.value,
        projectId: project.value || null,
        share: get<HTMLInputElement>("[data-share]").checked,
      });
      localStorage.setItem("devmoter-office-ai-run", run.id);
      renderRun();
      void pollRun();
    });
  });
  get("[data-stop]").addEventListener("click", () => {
    if (run)
      void api<AiRun>(`/api/office/ai/runs/${run.id}/stop`, "POST", {})
        .then((value) => {
          run = value;
          renderRun();
        })
        .catch((e) => error(e.message));
  });
  get("[data-configure]").addEventListener("click", () => {
    if (options.configureAi) {
      void save().finally(() => {
        root.close();
        options.configureAi!();
      });
    } else error("API Chatの設定からProviderとModelを登録してください。");
  });

  // ------------------------------------------------------------- shell ---
  for (const tab of root.querySelectorAll<HTMLElement>("[data-pane-tab]"))
    tab.addEventListener("click", () => setPane(tab.dataset.paneTab as Pane));
  get("[data-upload-open]").addEventListener("click", () => get<HTMLInputElement>("[data-upload]").click());
  get("[data-new]").addEventListener("click", () =>
    void task(async () => {
      if (!(await settle())) return;
      showDoc(await api<Doc>("/api/office/documents", "POST", { blank: true, name: "無題の文書.docx" }));
      setPane("editor");
      await library();
      editor.focus();
    }),
  );
  get<HTMLInputElement>("[data-upload]").addEventListener("change", (e) =>
    void task(async () => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) throw new Error("12MB以下のDOCXを選択してください。");
      if (!(await settle())) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      showDoc(await api<Doc>("/api/office/documents", "POST", { name: file.name, base64: btoa(binary) }));
      input.value = "";
      setPane("editor");
      await library();
    }),
  );
  get("[data-download]").addEventListener("click", () => void download());
  get("[data-close]").addEventListener("click", () => {
    void save();
    root.close();
  });
  root.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
    else void save();
  });
  root.addEventListener("close", () => {
    pollGeneration++;
    if (poll) window.clearTimeout(poll);
    poll = undefined;
  });
  // iOS: keep the dialog (and its toolbar) inside the visible area above the keyboard
  const viewport = window.visualViewport;
  const syncViewport = () => {
    if (!viewport) return;
    root.style.setProperty("--office-vh", `${Math.round(viewport.height)}px`);
    root.style.setProperty("--office-vtop", `${Math.round(viewport.offsetTop)}px`);
  };
  viewport?.addEventListener("resize", syncViewport);
  viewport?.addEventListener("scroll", syncViewport);
  syncViewport();
  window.addEventListener("devmoter:show-office", () => {
    if (!root.open) root.showModal();
    if (run) void pollRun();
  });
  window.addEventListener("pagehide", () => void save());
  root.showModal();
  setPane("list");
  controls();
  void task(async () => {
    await library();
    const context = await api<{ providers: Provider[]; projects: { id: string; name: string }[] }>("/api/tools-ai/context");
    providers = context.providers;
    for (const p of providers) provider.append(new Option(p.name, p.id));
    const saved = localStorage.getItem("devmoter-api-provider");
    if (saved && providers.some((p) => p.id === saved)) provider.value = saved;
    else if (providers.some((p) => p.ready)) provider.value = providers.find((p) => p.ready)!.id;
    fillModels();
    renderAiSetup();
    project.append(new Option("指定なし", ""));
    for (const p of context.projects) project.append(new Option(p.name, p.id));
    const last = localStorage.getItem("devmoter-office-document");
    if (last) {
      try {
        showDoc(await api<Doc>(`/api/office/documents/${last}`));
        setPane("editor");
        await library();
      } catch {
        localStorage.removeItem("devmoter-office-document");
      }
    }
    const lastRun = localStorage.getItem("devmoter-office-ai-run");
    if (lastRun) {
      run = { id: lastRun, status: "planning" };
      void pollRun();
    }
  });
}
