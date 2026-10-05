import "./office.css";

type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  color?: string;
  sizeHalfPoints?: number;
};
type Block = {
  id: string;
  type: string;
  level?: number;
  list?: { kind: string; ilvl: number; numId: string };
  align?: string;
  editable: boolean;
  text: string;
  runs: Run[];
  label?: string;
  previewText?: string;
  imageDataUrl?: string;
  table?: { rows: { cells: { text: string; colSpan?: number }[] }[] };
};
type Doc = {
  id: string;
  name: string;
  revision: string;
  blocks: Block[];
  warnings: string[];
  history: { revision: string; createdAt: string; source: string }[];
};
type AiRun = {
  id: string;
  documentId?: string;
  revision?: string;
  status: string;
  edits?: { blockId: string; text: string }[];
  error?: string;
  sharing?: { excluded: number; truncated: boolean };
};
type Provider = {
  id: string;
  name: string;
  models: string[];
  ready: boolean;
  projectId?: string;
};
let mounted = false;
export function openOffice(options: { configureAi?: () => void } = {}) {
  if (mounted) {
    window.dispatchEvent(new Event("devmoter:show-office"));
    return;
  }
  mounted = true;
  const root = document.createElement("dialog");
  root.className = "dm-office";
  root.setAttribute("aria-labelledby", "office-title");
  root.setAttribute("data-i18n-skip", "");
  root.innerHTML = `<header class="office-header"><div><small>DEVMOTER FAST</small><h1 id="office-title">Office <span>Docs</span></h1></div><button type="button" data-close aria-label="Officeを閉じる">閉じる</button></header>
    <nav class="office-toolbar" aria-label="文書操作"><button data-new>新規文書</button><button data-upload-open>DOCXを開く</button><input data-upload type="file" accept=".docx" hidden><button data-save disabled>変更を保存</button><button data-download disabled>DOCXをダウンロード</button><button data-mobile-ai class="office-mobile-switch" aria-expanded="false">AIに依頼</button><button data-top-stop hidden>停止</button><span data-save-state role="status"></span></nav>
    <p class="office-error" data-error role="alert" hidden></p>
    <div class="office-layout"><aside class="office-assistant"><h2>文書を一緒に仕上げる</h2><p>推敲、要約、翻訳。変更案を確認してから本文へ反映できます。</p>
      <form data-ai-form><label>AIへの依頼<textarea data-goal rows="3" placeholder="読みやすく、簡潔な文章に整えて"></textarea></label><details><summary>使用するAIと共有対象</summary><label>Provider<select data-provider></select></label><label>Model<select data-model></select></label><label>Vault用Project<select data-project></select></label><button type="button" data-configure>AI設定を開く</button></details><p data-provider-notice></p><label class="office-consent"><input type="checkbox" data-share>必要な本文（最大24KB）を選択したAIへ共有する</label><div class="office-ai-actions"><button data-ai-send>変更案を作る</button><button type="button" data-stop hidden>停止</button></div></form>
      <p data-ai-status role="status" aria-live="polite"></p><div data-proposal></div>
      <details class="office-library" open><summary>保存した文書</summary><div data-library></div></details><details><summary>変更履歴・原本</summary><div data-history></div></details>
    </aside><main class="office-canvas"><div class="office-doc-heading"><h2 data-name>文書を開くところから。</h2><p data-note>DOCXの原本と履歴を保持しながら編集できます。</p></div><article class="office-page" data-page aria-label="文書本文"><div class="office-empty"><span aria-hidden="true">▤</span><h2>あなたの言葉を、かたちに。</h2><p>DOCXを開くか、新しい文書を作成してください。</p></div></article></main></div>`;
  document.body.append(root);
  const get = <T extends HTMLElement>(sel: string) =>
    root.querySelector<T>(sel)!;
  let doc: Doc | null = null;
  let draft = new Map<string, string>();
  let providers: Provider[] = [];
  let run: AiRun | null = null;
  let busy = false;
  let poll: number | undefined;
  const provider = get<HTMLSelectElement>("[data-provider]");
  const model = get<HTMLSelectElement>("[data-model]");
  const project = get<HTMLSelectElement>("[data-project]");
  const error = (message = "") => {
    get("[data-error]").textContent = message;
    get("[data-error]").hidden = !message;
  };
  const api = async <T>(
    path: string,
    method = "GET",
    payload?: unknown,
  ): Promise<T> => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const token = localStorage.getItem("devmoter-device-token");
    if (token) headers["x-devmoter-device-token"] = token;
    const response = await fetch(path, {
      method,
      headers,
      cache: "no-store",
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error || `操作に失敗しました (${response.status})`,
      );
    return result;
  };
  const node = (tag: string, text = "", cls = "") => {
    const e = document.createElement(tag);
    e.textContent = text;
    e.className = cls;
    return e;
  };
  const button = (text: string, action: () => void) => {
    const e = document.createElement("button");
    e.type = "button";
    e.textContent = text;
    e.addEventListener("click", action);
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
  const controls = () => {
    get<HTMLButtonElement>("[data-new]").disabled = busy;
    get<HTMLButtonElement>("[data-upload-open]").disabled = busy;
    get<HTMLButtonElement>("[data-save]").disabled =
      busy || !doc || !draft.size;
    get<HTMLButtonElement>("[data-download]").disabled = busy || !doc;
    get<HTMLButtonElement>("[data-ai-send]").disabled =
      busy ||
      !doc ||
      ["planning", "stop_requested"].includes(run?.status || "");
    get("[data-save-state]").textContent = busy
      ? "処理しています…"
      : draft.size
        ? `${draft.size}段落の未保存の変更`
        : doc
          ? "保存済み"
          : "";
  };
  const library = async () => {
    const docs = await api<Doc[]>("/api/office/documents");
    const list = get("[data-library]");
    list.replaceChildren();
    for (const item of docs)
      list.append(
        button(
          item.name,
          () =>
            void task(async () => {
              if (
                draft.size &&
                !confirm("未保存の変更を破棄して文書を開きますか？")
              )
                return;
              showDoc(await api<Doc>(`/api/office/documents/${item.id}`));
            }),
        ),
      );
    if (!docs.length) list.append(node("p", "まだ文書はありません。"));
  };
  const showDoc = (data: Doc) => {
    if (doc && draft.size)
      sessionStorage.removeItem(`devmoter-office-draft:${doc.id}`);
    doc = data;
    draft = new Map();
    localStorage.setItem("devmoter-office-document", data.id);
    get("[data-name]").textContent = data.name;
    get("[data-note]").textContent = data.warnings.join(" ");
    const page = get("[data-page]");
    page.replaceChildren();
    const counters = new Map<string, number>();
    for (const block of data.blocks) {
      const section = node("section", "", "office-block");
      section.dataset.blockId = block.id;
      if (block.editable) {
        const preview = node(
          block.type === "heading" ? `h${Math.min(block.level || 2, 6)}` : "p",
          "",
          "office-paragraph",
        );
        if (["left", "right", "center", "justify"].includes(block.align || ""))
          preview.style.textAlign = block.align!;
        if (block.list) {
          const key = `${block.list.numId}:${block.list.ilvl}`;
          const count = (counters.get(key) || 0) + 1;
          counters.set(key, count);
          preview.append(
            node(
              "span",
              block.list.kind === "bullet" ? "• " : `${count}. `,
              "office-list-marker",
            ),
          );
          preview.style.paddingLeft = `${Math.min(block.list.ilvl, 6) * 16}px`;
        }
        for (const r of block.runs) {
          const span = node("span", r.text);
          if (r.bold) span.style.fontWeight = "700";
          if (r.italic) span.style.fontStyle = "italic";
          if (r.underline) span.style.textDecoration = "underline";
          if (/^[a-f0-9]{6}$/i.test(r.color || ""))
            span.style.color = `#${r.color}`;
          if (
            r.sizeHalfPoints &&
            r.sizeHalfPoints >= 16 &&
            r.sizeHalfPoints <= 144
          )
            span.style.fontSize = `${r.sizeHalfPoints / 2}pt`;
          preview.append(span);
        }
        if (!block.text) preview.textContent = "空の段落";
        const edit = document.createElement("textarea");
        edit.value = block.text;
        edit.rows = Math.max(
          2,
          Math.min(12, block.text.split("\n").length + 1),
        );
        edit.hidden = true;
        edit.setAttribute("aria-label", "段落を編集");
        const toggle = button("編集", () => {
          preview.hidden = true;
          edit.hidden = false;
          toggle.hidden = true;
          edit.focus();
        });
        toggle.className = "office-edit";
        edit.addEventListener("input", () => {
          if (edit.value === block.text) draft.delete(block.id);
          else draft.set(block.id, edit.value);
          sessionStorage.setItem(
            `devmoter-office-draft:${data.id}`,
            JSON.stringify({ revision: data.revision, edits: [...draft] }),
          );
          controls();
        });
        section.append(preview, toggle, edit);
      } else if (block.table) {
        const wrap = node("div", "", "office-table-scroll");
        const table = document.createElement("table");
        for (const row of block.table.rows) {
          const tr = document.createElement("tr");
          for (const cell of row.cells) {
            const td = document.createElement("td");
            td.textContent = cell.text;
            td.colSpan = cell.colSpan || 1;
            tr.append(td);
          }
          table.append(tr);
        }
        wrap.append(table);
        section.append(wrap, node("small", "表：原本を保持"));
      } else if (block.imageDataUrl) {
        const image = document.createElement("img");
        image.src = block.imageDataUrl;
        image.alt = block.label || "文書内の画像";
        section.append(image, node("small", "画像：原本を保持"));
      } else
        section.append(
          node(
            "p",
            block.previewText || block.label || "原本を保持している要素",
            "office-protected",
          ),
        );
      page.append(section);
    }
    const history = get("[data-history]");
    history.replaceChildren();
    for (const item of [...data.history].reverse()) {
      const row = node("div");
      row.append(
        button(
          `${item.source === "original" ? "原本" : item.source === "restore" ? "復元" : "保存"} · ${new Date(item.createdAt).toLocaleString()}`,
          () => download(item.revision),
        ),
      );
      if (item.revision !== data.revision)
        row.append(
          button(
            "この版に戻す",
            () =>
              void task(async () => {
                if (
                  !confirm(
                    "この版を新しい履歴として復元しますか？未保存の変更は破棄されます。",
                  )
                )
                  return;
                sessionStorage.removeItem(`devmoter-office-draft:${data.id}`);
                showDoc(
                  await api<Doc>(
                    `/api/office/documents/${data.id}/restore`,
                    "POST",
                    { revision: data.revision, target: item.revision },
                  ),
                );
                await library();
              }),
          ),
        );
      history.append(row);
    }
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`devmoter-office-draft:${data.id}`) || "null",
      );
      if (saved?.revision === data.revision && Array.isArray(saved.edits))
        for (const [id, text] of saved.edits) {
          const block = data.blocks.find((b) => b.id === id && b.editable);
          if (!block || typeof text !== "string") continue;
          draft.set(id, text);
          const section = [
            ...page.querySelectorAll<HTMLElement>("[data-block-id]"),
          ].find((b) => b.dataset.blockId === id);
          const input = section?.querySelector("textarea");
          if (input) {
            input.value = text;
            input.hidden = false;
            const preview =
              section?.querySelector<HTMLElement>(".office-paragraph");
            if (preview) preview.hidden = true;
          }
        }
      else if (saved?.edits?.length)
        error(
          "以前の下書きがありますが、保存版が変わったため自動適用していません。",
        );
    } catch {
      error("下書きを復元できませんでした。");
    }
    controls();
    if (run) renderRun();
  };
  const download = (revision?: string) => {
    if (!doc) return;
    if (
      !revision &&
      draft.size &&
      !confirm(
        "未保存の変更は含まれません。保存済み文書をダウンロードしますか？",
      )
    )
      return;
    window.location.assign(
      `/api/office/documents/${doc.id}/download${revision ? `?revision=${revision}` : ""}`,
    );
  };
  const fillModels = () => {
    model.replaceChildren();
    const selected = providers.find((p) => p.id === provider.value);
    for (const value of selected?.models || [])
      model.append(new Option(value, value));
    const saved = localStorage.getItem(`devmoter-api-model:${provider.value}`);
    if (saved && [...model.options].some((o) => o.value === saved))
      model.value = saved;
    get("[data-provider-notice]").textContent = selected?.ready
      ? `使用するAI: ${selected.name} / ${model.value}`
      : "AIは未設定です。手動編集はそのまま利用できます。「使用するAIと共有対象」からAI設定を開いてください。";
  };
  provider.addEventListener("change", fillModels);
  model.addEventListener("change", () => {
    const selected = providers.find((p) => p.id === provider.value);
    if (selected?.ready)
      get("[data-provider-notice]").textContent =
        `使用するAI: ${selected.name} / ${model.value}`;
  });
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
      ? (status[run.status as keyof typeof status] || run.status) +
        (run.error ? ` ${run.error}` : "")
      : "";
    get("[data-stop]").hidden = !["planning", "stop_requested"].includes(
      run?.status || "",
    );
    get("[data-top-stop]").hidden = get("[data-stop]").hidden;
    const proposal = get("[data-proposal]");
    proposal.replaceChildren();
    if (run?.sharing && (run.sharing.excluded || run.sharing.truncated))
      proposal.append(
        node(
          "p",
          "安全上、一部本文をAIへの共有対象から除外しました。",
          "office-sharing-notice",
        ),
      );
    if (run?.status === "proposed" && run.documentId === doc?.id) {
      for (const edit of run.edits || []) {
        const details = document.createElement("details");
        details.open = true;
        details.append(
          node("summary", "段落の変更案"),
          node(
            "del",
            doc?.blocks.find((b) => b.id === edit.blockId)?.text || "",
          ),
          node("ins", edit.text),
        );
        proposal.append(details);
      }
      proposal.append(
        button("変更案を本文へ反映（まだ保存しません）", () => {
          if (
            !doc ||
            run?.documentId !== doc.id ||
            run.revision !== doc.revision ||
            draft.size
          ) {
            error(
              "未保存の変更があるか、文書が更新されています。先に保存・再読み込みしてください。",
            );
            return;
          }
          for (const edit of run.edits || []) {
            draft.set(edit.blockId, edit.text);
            const block = [
              ...root.querySelectorAll<HTMLElement>("[data-block-id]"),
            ].find((b) => b.dataset.blockId === edit.blockId);
            const input = block?.querySelector("textarea");
            if (input) {
              input.value = edit.text;
              input.hidden = false;
              const preview =
                block?.querySelector<HTMLElement>(".office-paragraph");
              if (preview) preview.hidden = true;
            }
          }
          sessionStorage.setItem(
            `devmoter-office-draft:${doc.id}`,
            JSON.stringify({ revision: doc.revision, edits: [...draft] }),
          );
          run = null;
          localStorage.removeItem("devmoter-office-ai-run");
          renderRun();
          controls();
        }),
      );
    } else if (run?.status === "proposed" && run.documentId) {
      const target = run.documentId;
      proposal.append(
        button(
          "変更案の対象文書を開く",
          () =>
            void task(async () => {
              if (
                draft.size &&
                !confirm("未保存の変更を破棄して対象文書を開きますか？")
              )
                return;
              showDoc(await api<Doc>(`/api/office/documents/${target}`));
              renderRun();
            }),
        ),
      );
    }
    controls();
  };
  const pollRun = async () => {
    if (!run) return;
    try {
      run = await api<AiRun>(`/api/office/ai/runs/${run.id}`);
      renderRun();
      if (["planning", "stop_requested"].includes(run.status))
        poll = window.setTimeout(() => void pollRun(), 700);
    } catch (e) {
      error((e as Error).message);
      poll = window.setTimeout(() => void pollRun(), 3000);
    }
  };
  get("[data-ai-form]").addEventListener("submit", (e) => {
    e.preventDefault();
    void task(async () => {
      if (!doc) return;
      if (draft.size)
        throw new Error("AIへ依頼する前に本文の変更を保存してください。");
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
  get("[data-top-stop]").addEventListener("click", () =>
    get("[data-stop]").click(),
  );
  get("[data-upload-open]").addEventListener("click", () =>
    get<HTMLInputElement>("[data-upload]").click(),
  );
  get("[data-configure]").addEventListener("click", () => {
    if (options.configureAi) {
      root.close();
      options.configureAi();
    } else error("API Chatの設定からProviderとModelを登録してください。");
  });
  get("[data-mobile-ai]").addEventListener("click", () => {
    const open = root.dataset.mobileAi !== "true";
    root.dataset.mobileAi = String(open);
    get("[data-mobile-ai]").setAttribute("aria-expanded", String(open));
    get("[data-mobile-ai]").textContent = open ? "文書に戻る" : "AIに依頼";
  });
  get("[data-new]").addEventListener(
    "click",
    () =>
      void task(async () => {
        if (
          draft.size &&
          !confirm("未保存の変更を破棄して新規文書を作成しますか？")
        )
          return;
        showDoc(
          await api<Doc>("/api/office/documents", "POST", {
            blank: true,
            name: "無題の文書.docx",
          }),
        );
        await library();
      }),
  );
  get<HTMLInputElement>("[data-upload]").addEventListener(
    "change",
    (e) =>
      void task(async () => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 12 * 1024 * 1024)
          throw new Error("12MB以下のDOCXを選択してください。");
        if (
          draft.size &&
          !confirm("未保存の変更を破棄してファイルを開きますか？")
        )
          return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        showDoc(
          await api<Doc>("/api/office/documents", "POST", {
            name: file.name,
            base64: btoa(binary),
          }),
        );
        input.value = "";
        await library();
      }),
  );
  get("[data-save]").addEventListener(
    "click",
    () =>
      void task(async () => {
        if (!doc || !draft.size) return;
        const saved = await api<Doc>(
          `/api/office/documents/${doc.id}`,
          "PATCH",
          {
            revision: doc.revision,
            edits: [...draft].map(([blockId, text]) => ({ blockId, text })),
          },
        );
        sessionStorage.removeItem(`devmoter-office-draft:${doc.id}`);
        showDoc(saved);
        await library();
      }),
  );
  get("[data-download]").addEventListener("click", () => download());
  get("[data-close]").addEventListener("click", () => root.close());
  root.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  root.addEventListener("close", () => {
    if (poll) window.clearTimeout(poll);
  });
  window.addEventListener("devmoter:show-office", () => {
    if (!root.open) root.showModal();
    if (run) void pollRun();
  });
  root.showModal();
  void task(async () => {
    await library();
    const context = await api<{
      providers: Provider[];
      projects: { id: string; name: string }[];
    }>("/api/tools-ai/context");
    providers = context.providers;
    for (const p of providers) provider.append(new Option(p.name, p.id));
    const saved = localStorage.getItem("devmoter-api-provider");
    if (saved && providers.some((p) => p.id === saved)) provider.value = saved;
    fillModels();
    project.append(new Option("指定なし", ""));
    for (const p of context.projects) project.append(new Option(p.name, p.id));
    const last = localStorage.getItem("devmoter-office-document");
    if (last) showDoc(await api<Doc>(`/api/office/documents/${last}`));
    const lastRun = localStorage.getItem("devmoter-office-ai-run");
    if (lastRun) {
      run = { id: lastRun, status: "planning" };
      void pollRun();
    }
  });
}
