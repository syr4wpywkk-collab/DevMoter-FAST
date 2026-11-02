// Whole-document editor for Office/Docs.
//
// One contenteditable page holds every block of the document. Paragraphs,
// headings and list items are editable elements; tables, pictures, fields and
// other content the editor cannot rewrite are locked (contenteditable=false)
// and travel by id. Each block element carries a client key (data-key) that
// survives saves; the server id for a key lives in `ids`, so autosave can
// re-map ids without re-rendering under the caret.

export type EditorRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
  color?: string;
  sizeHalfPoints?: number;
};
export type EditorBlockData = {
  id: string;
  type: string;
  level?: number;
  list?: { kind: string; ilvl: number; numId?: string };
  align?: string;
  editable: boolean;
  required?: boolean;
  runs: EditorRun[];
  text?: string;
  label?: string;
  previewText?: string;
  imageDataUrl?: string;
  table?: { rows: { cells: { text: string; colSpan?: number }[] }[] };
};
export type BlockType = "paragraph" | "heading" | "listItem";
export type ParagraphModel = {
  type: BlockType;
  level?: number;
  list?: "bullet" | "ordered";
  ilvl?: number;
  align?: "left" | "center" | "right" | "justify";
  runs: { text: string; bold: boolean; italic: boolean; underline: boolean; href?: string }[];
};
/** What the server receives: keep-by-id, or a paragraph model (with id = rewrite, base = new paragraph copied from). */
export type SaveInput = { id: string } | (ParagraphModel & { id?: string; base?: string });
type Entry =
  | { key: string; locked: true }
  | { key: string; baseKey?: string; locked?: false; model: ParagraphModel };
type Caret = { block: number; offset: number; endBlock: number; endOffset: number } | null;
type Snapshot = { entries: Entry[]; caret: Caret };

const ALIGNS = ["left", "center", "right", "justify"] as const;
const SAFE_HREF = /^(?:https?:\/\/|mailto:)/i;
const INLINE = new Set(["B", "STRONG", "I", "EM", "U", "A", "BR", "SPAN"]);
const HIDDEN_MARKERS = /^w:(?:bookmarkStart|bookmarkEnd|permStart|permEnd|proofErr|commentRangeStart|commentRangeEnd|customXmlInsRangeStart|customXmlInsRangeEnd)$/;
const HISTORY_LIMIT = 100;

export type OfficeEditorOptions = {
  onChange: () => void;
  onLockedDelete?: (label: string) => boolean;
};

export function createOfficeEditor(page: HTMLElement, options: OfficeEditorOptions) {
  const doc = page.ownerDocument;
  const win = doc.defaultView!;
  let nextKey = 1;
  let ids = new Map<string, string>();
  const locked = new Map<string, HTMLElement>();
  const required = new Map<string, number>();
  let history: Snapshot[] = [];
  let at = -1;
  let composing = false;
  let pendingSnapshot: number | undefined;
  let savedRange: Range | null = null;

  const newKey = () => `k${nextKey++}`;
  const isLocked = (el: Element) => (el as HTMLElement).dataset.locked === "true";
  const blocks = () => [...page.children] as HTMLElement[];
  const editableBlocks = () => blocks().filter((el) => !isLocked(el));

  // ------------------------------------------------------------- render ---
  const formatChain = (run: EditorRun | ParagraphModel["runs"][number], text: string) => {
    let node: Node = doc.createTextNode(text);
    const color = (run as EditorRun).color;
    const size = (run as EditorRun).sizeHalfPoints;
    if ((color && /^[a-f0-9]{6}$/i.test(color)) || (size && size >= 16 && size <= 144)) {
      const span = doc.createElement("span");
      if (color && /^[a-f0-9]{6}$/i.test(color)) span.style.color = `#${color}`;
      if (size && size >= 16 && size <= 144) span.style.fontSize = `${size / 2}pt`;
      span.append(node);
      node = span;
    }
    for (const [flag, tag] of [["underline", "u"], ["italic", "i"], ["bold", "b"]] as const) {
      if (!run[flag]) continue;
      const el = doc.createElement(tag);
      el.append(node);
      node = el;
    }
    if (run.href) {
      const a = doc.createElement("a");
      if (SAFE_HREF.test(run.href)) a.setAttribute("href", run.href);
      a.dataset.href = run.href;
      a.append(node);
      node = a;
    }
    return node;
  };
  const fillRuns = (el: HTMLElement, runs: (EditorRun | ParagraphModel["runs"][number])[]) => {
    el.replaceChildren();
    for (const run of runs) {
      const lines = run.text.split("\n");
      lines.forEach((line, i) => {
        if (i > 0) el.append(doc.createElement("br"));
        if (line) el.append(formatChain(run, line));
      });
    }
    // a trailing line break needs a second <br> to show; an empty block needs one to keep its height
    if (!el.childNodes.length || el.lastChild?.nodeName === "BR") el.append(doc.createElement("br"));
  };
  const blockElement = (model: Pick<ParagraphModel, "type" | "level" | "list" | "ilvl" | "align">) => {
    const level = Math.min(Math.max(model.level || 1, 1), 9);
    const el = doc.createElement(model.type === "heading" ? `h${Math.min(level, 6)}` : "p");
    el.className = "office-block";
    if (model.type === "heading") el.dataset.level = String(level);
    if (model.type === "listItem") {
      el.dataset.list = model.list === "ordered" ? "ordered" : "bullet";
      el.dataset.ilvl = String(model.ilvl || 0);
    }
    if (model.align) {
      el.dataset.align = model.align;
      el.style.textAlign = model.align;
    }
    return el;
  };
  const renderEditable = (entry: Extract<Entry, { model: ParagraphModel }>, runs?: EditorRun[]) => {
    const el = blockElement(entry.model);
    el.dataset.key = entry.key;
    if (entry.baseKey) el.dataset.baseKey = entry.baseKey;
    fillRuns(el, runs || entry.model.runs);
    return el;
  };
  const icon = (paths: string) =>
    `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const renderLocked = (block: EditorBlockData, key: string) => {
    const el = doc.createElement("div");
    el.className = "office-locked";
    el.contentEditable = "false";
    el.dataset.locked = "true";
    el.dataset.key = key;
    if (block.type === "passthrough" && !block.previewText && HIDDEN_MARKERS.test(block.label || "")) {
      el.hidden = true;
      el.dataset.marker = "true";
      return el;
    }
    let label = "要素";
    if (block.required) {
      label = "セクション区切り";
      const text = doc.createElement("p");
      text.className = "office-protected";
      text.textContent = "ここでページ設定が切り替わります";
      el.append(text);
    } else if (block.table) {
      label = "表";
      const wrap = doc.createElement("div");
      wrap.className = "office-table-scroll";
      const table = doc.createElement("table");
      for (const row of block.table.rows) {
        const tr = doc.createElement("tr");
        for (const cell of row.cells) {
          const td = doc.createElement("td");
          td.textContent = cell.text;
          td.colSpan = cell.colSpan || 1;
          tr.append(td);
        }
        table.append(tr);
      }
      wrap.append(table);
      el.append(wrap);
    } else if (block.imageDataUrl && /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(block.imageDataUrl)) {
      label = "画像";
      const image = doc.createElement("img");
      image.src = block.imageDataUrl;
      image.alt = block.label || "文書内の画像";
      el.append(image);
    } else {
      const text = doc.createElement("p");
      text.className = "office-protected";
      text.textContent = block.previewText || block.text || block.label || "原本を保持している要素";
      el.append(text);
    }
    const bar = doc.createElement("div");
    bar.className = "office-locked-bar";
    const caption = doc.createElement("small");
    caption.textContent = block.required ? label : `${label}・原本を保持`;
    bar.append(caption);
    if (!block.required) {
      const remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "office-icon-button";
      remove.setAttribute("aria-label", `${label}を削除`);
      remove.title = `${label}を削除`;
      remove.innerHTML = icon('<path d="M3.5 5h11M7.5 5V3.5h3V5M5 5l.7 9.5h6.6L13 5"/>');
      remove.addEventListener("click", () => {
        if (options.onLockedDelete && !options.onLockedDelete(label)) return;
        commit(() => el.remove());
      });
      bar.append(remove);
    }
    el.append(bar);
    return el;
  };

  // --------------------------------------------------------------- read ---
  const readRuns = (el: HTMLElement) => {
    const runs: ParagraphModel["runs"] = [];
    const walk = (node: Node, fmt: { bold: boolean; italic: boolean; underline: boolean; href?: string }) => {
      if (node.nodeType === 3) {
        const text = node.nodeValue || "";
        if (text) runs.push({ text, ...fmt });
        return;
      }
      if (node.nodeType !== 1) return;
      const child = node as HTMLElement;
      if (child.nodeName === "BR") {
        if (child !== el.lastChild) runs.push({ text: "\n", ...fmt });
        return;
      }
      const next = { ...fmt };
      if (["B", "STRONG"].includes(child.nodeName)) next.bold = true;
      if (["I", "EM"].includes(child.nodeName)) next.italic = true;
      if (child.nodeName === "U") next.underline = true;
      if (child.nodeName === "A") next.href = child.getAttribute("href") || child.dataset.href || undefined;
      const style = child.style;
      if (style?.fontWeight) {
        const weight = style.fontWeight === "bold" ? 700 : style.fontWeight === "normal" ? 400 : Number(style.fontWeight);
        if (weight) next.bold = weight >= 600;
      }
      if (style?.fontStyle) next.italic = style.fontStyle === "italic";
      if (style?.textDecoration || style?.textDecorationLine) {
        const line = style.textDecorationLine || style.textDecoration;
        if (/underline/.test(line)) next.underline = true;
        else if (/none/.test(line)) next.underline = false;
      }
      for (const grand of child.childNodes) walk(grand, next);
    };
    for (const node of el.childNodes) walk(node, { bold: false, italic: false, underline: false });
    const merged: ParagraphModel["runs"] = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline && last.href === run.href)
        last.text += run.text;
      else merged.push({ ...run });
    }
    return merged.map((run) => (run.href ? run : { text: run.text, bold: run.bold, italic: run.italic, underline: run.underline }));
  };
  const readModel = (el: HTMLElement): ParagraphModel => {
    const heading = /^H[1-6]$/.test(el.nodeName);
    const list = el.dataset.list === "ordered" ? "ordered" : el.dataset.list === "bullet" ? "bullet" : undefined;
    const align = ALIGNS.find((value) => value === el.dataset.align);
    const model: ParagraphModel = { type: heading ? "heading" : list ? "listItem" : "paragraph", runs: readRuns(el) };
    if (heading) model.level = Number(el.dataset.level) || Number(el.nodeName.slice(1));
    if (list && !heading) {
      model.list = list;
      model.ilvl = Number(el.dataset.ilvl) || 0;
    }
    if (align) model.align = align;
    return model;
  };
  const entries = (): Entry[] =>
    blocks().map((el) =>
      isLocked(el)
        ? { key: el.dataset.key!, locked: true }
        : { key: el.dataset.key!, ...(el.dataset.baseKey ? { baseKey: el.dataset.baseKey } : {}), model: readModel(el) },
    );

  // ---------------------------------------------------------- normalize ---
  const sanitizeInline = (root: HTMLElement) => {
    for (const el of [...root.querySelectorAll<HTMLElement>("*")]) {
      if (!el.isConnected || !root.contains(el)) continue;
      if (!INLINE.has(el.nodeName)) {
        // nested blocks from browser editing: keep the text, mark the line break
        if (/^(?:P|DIV|H[1-6]|LI)$/.test(el.nodeName) && el.previousSibling) el.before(doc.createElement("br"));
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const attr of [...el.attributes]) {
        const keep =
          (el.nodeName === "A" && ["href", "data-href"].includes(attr.name)) ||
          (el.nodeName === "SPAN" && attr.name === "style");
        if (!keep) el.removeAttribute(attr.name);
      }
      if (el.nodeName === "A") {
        const href = el.getAttribute("href") || el.dataset.href || "";
        if (!SAFE_HREF.test(href)) el.removeAttribute("href");
        if (!href) el.replaceWith(...el.childNodes);
      }
      if (el.nodeName !== "BR" && el.isConnected && !el.textContent && !el.querySelector("br")) el.remove();
    }
  };
  const setType = (el: HTMLElement, model: Pick<ParagraphModel, "type" | "level" | "list" | "ilvl" | "align">) => {
    const next = blockElement(model);
    next.dataset.key = el.dataset.key!;
    if (el.dataset.baseKey) next.dataset.baseKey = el.dataset.baseKey;
    next.append(...el.childNodes);
    el.replaceWith(next);
    return next;
  };
  const updateMarkers = () => {
    const counters: number[] = [];
    let previousKind = "";
    for (const el of blocks()) {
      if (el.dataset.marker === "true") continue;
      const kind = !isLocked(el) && !/^H/.test(el.nodeName) ? el.dataset.list || "" : "";
      if (!kind) {
        counters.length = 0;
        previousKind = "";
        continue;
      }
      const ilvl = Number(el.dataset.ilvl) || 0;
      if (kind !== previousKind) counters.length = 0;
      counters.length = ilvl + 1;
      counters[ilvl] = (counters[ilvl] || 0) + 1;
      el.dataset.marker = kind === "ordered" ? `${counters[ilvl]}.` : ["•", "◦", "▪"][ilvl % 3];
      el.style.setProperty("--office-ilvl", String(ilvl));
      previousKind = kind;
    }
  };
  const normalize = () => {
    for (const node of [...page.childNodes]) {
      if (node.nodeType === 3) {
        if (!(node.nodeValue || "").trim()) {
          node.remove();
          continue;
        }
        const p = blockElement({ type: "paragraph" });
        node.replaceWith(p);
        p.append(node);
        continue;
      }
      if (node.nodeType !== 1) {
        node.remove();
        continue;
      }
      const el = node as HTMLElement;
      if (isLocked(el)) continue;
      if (!/^(?:P|H[1-6])$/.test(el.nodeName)) {
        const p = setType(el, { type: el.nodeName === "LI" ? "listItem" : "paragraph", list: el.nodeName === "LI" ? "bullet" : undefined });
        sanitizeInline(p);
        continue;
      }
      el.className = "office-block";
      sanitizeInline(el);
    }
    // keys: a block split or duplicated by the browser becomes a new paragraph based on the first
    const seen = new Set<string>();
    for (const el of blocks()) {
      const key = el.dataset.key;
      if (!key || seen.has(key)) {
        if (isLocked(el)) {
          el.remove();
          continue;
        }
        el.dataset.key = newKey();
        if (key) el.dataset.baseKey = key;
      }
      seen.add(el.dataset.key!);
      if (!isLocked(el) && !(el.textContent || "") && !el.querySelector("br")) el.replaceChildren(doc.createElement("br"));
    }
    // required blocks (section breaks) cannot disappear
    for (const [key, index] of required) {
      const el = locked.get(key);
      if (el && !el.isConnected) page.insertBefore(el, page.children[Math.min(index, page.children.length)] || null);
    }
    if (!editableBlocks().length) {
      const p = blockElement({ type: "paragraph" });
      p.dataset.key = newKey();
      p.append(doc.createElement("br"));
      page.append(p);
    }
    updateMarkers();
  };

  // -------------------------------------------------------------- caret ---
  const blockOf = (node: Node | null): HTMLElement | null => {
    while (node && node.parentNode !== page) node = node.parentNode;
    return node && node.nodeType === 1 ? (node as HTMLElement) : null;
  };
  const offsetIn = (block: HTMLElement, container: Node, offset: number) => {
    const range = doc.createRange();
    range.selectNodeContents(block);
    try {
      range.setEnd(container, offset);
    } catch {
      return 0;
    }
    let count = 0;
    const fragment = range.cloneContents();
    const walker = doc.createTreeWalker(fragment, 5);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) count += (n.nodeValue || "").length;
      else if (n.nodeName === "BR") count += 1;
    }
    return count;
  };
  const pointAt = (block: HTMLElement, offset: number): [Node, number] => {
    let remaining = offset;
    const walker = doc.createTreeWalker(block, 5);
    let last: [Node, number] = [block, 0];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        const length = (n.nodeValue || "").length;
        if (remaining <= length) return [n, remaining];
        remaining -= length;
        last = [n, length];
      } else if (n.nodeName === "BR") {
        const parent = n.parentNode!;
        const index = [...parent.childNodes].indexOf(n as ChildNode);
        if (remaining === 0) return [parent, index];
        remaining -= 1;
        last = [parent, index + 1];
      }
    }
    return last;
  };
  const currentRange = () => {
    const selection = win.getSelection();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (page.contains(range.startContainer)) return range;
    }
    return savedRange && page.contains(savedRange.startContainer) ? savedRange : null;
  };
  const caret = (): Caret => {
    const range = currentRange();
    if (!range) return null;
    const start = blockOf(range.startContainer);
    const end = blockOf(range.endContainer);
    if (!start || !end) return null;
    const list = blocks();
    return {
      block: list.indexOf(start),
      offset: isLocked(start) ? 0 : offsetIn(start, range.startContainer, range.startOffset),
      endBlock: list.indexOf(end),
      endOffset: isLocked(end) ? 0 : offsetIn(end, range.endContainer, range.endOffset),
    };
  };
  const setCaret = (value: Caret) => {
    if (!value) return;
    const list = blocks();
    const start = list[Math.min(value.block, list.length - 1)];
    const end = list[Math.min(value.endBlock, list.length - 1)];
    if (!start || !end) return;
    const range = doc.createRange();
    const [sn, so] = isLocked(start) ? [page, list.indexOf(start)] : pointAt(start, value.offset);
    const [en, eo] = isLocked(end) ? [page, list.indexOf(end)] : pointAt(end, value.endOffset);
    range.setStart(sn, so);
    range.setEnd(en, eo);
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRange = range.cloneRange();
  };
  const selectedBlocks = () => {
    const value = caret();
    const list = blocks();
    if (!value) return editableBlocks().slice(0, 1);
    return list.slice(Math.min(value.block, value.endBlock), Math.max(value.block, value.endBlock) + 1).filter((el) => !isLocked(el));
  };

  // ------------------------------------------------------------ history ---
  const snapshot = () => {
    if (pendingSnapshot !== undefined) win.clearTimeout(pendingSnapshot);
    pendingSnapshot = undefined;
    const next = { entries: entries(), caret: caret() };
    if (at >= 0 && JSON.stringify(history[at].entries) === JSON.stringify(next.entries)) {
      history[at].caret = next.caret;
      return false;
    }
    history = history.slice(0, at + 1);
    history.push(next);
    if (history.length > HISTORY_LIMIT) history.shift();
    at = history.length - 1;
    return true;
  };
  const changed = (immediate = false) => {
    if (composing) return;
    normalize();
    if (immediate) {
      if (snapshot()) options.onChange();
      return;
    }
    if (pendingSnapshot !== undefined) win.clearTimeout(pendingSnapshot);
    // typing is grouped into one undo step per pause
    pendingSnapshot = win.setTimeout(() => {
      pendingSnapshot = undefined;
      snapshot();
    }, 500);
    options.onChange();
  };
  const commit = (action: () => void) => {
    const keep = caret();
    if (pendingSnapshot !== undefined) snapshot();
    action();
    normalize();
    setCaret(keep);
    if (snapshot()) options.onChange();
  };
  const restore = (snap: Snapshot) => {
    const nodes: HTMLElement[] = [];
    for (const entry of snap.entries) {
      if (entry.locked) {
        const el = locked.get(entry.key);
        if (el) nodes.push(el);
      } else nodes.push(renderEditable(entry));
    }
    page.replaceChildren(...nodes);
    normalize();
    setCaret(snap.caret);
    options.onChange();
  };
  const undo = () => {
    if (pendingSnapshot !== undefined) snapshot();
    if (at <= 0) return;
    at--;
    restore(history[at]);
  };
  const redo = () => {
    if (pendingSnapshot !== undefined) snapshot();
    if (at >= history.length - 1) return;
    at++;
    restore(history[at]);
  };

  // ------------------------------------------------------- block edits ---
  const splitBlock = () => {
    const range = currentRange();
    if (!range) return;
    if (!range.collapsed) range.deleteContents();
    const block = blockOf(range.startContainer);
    if (!block || isLocked(block)) return;
    const model = readModel(block);
    const text = model.runs.map((r) => r.text).join("");
    if (model.type === "listItem" && !text) {
      commit(() => setType(block, { type: "paragraph", align: model.align }));
      return;
    }
    const offset = offsetIn(block, range.startContainer, range.startOffset);
    const tail = doc.createRange();
    tail.setStart(range.startContainer, range.startOffset);
    tail.setEnd(block, block.childNodes.length);
    const fragment = tail.extractContents();
    const atEnd = offset >= text.length;
    const nextModel = model.type === "heading" && atEnd ? { type: "paragraph" as const } : { ...model };
    const next = blockElement(nextModel);
    next.dataset.key = newKey();
    next.dataset.baseKey = block.dataset.key!;
    next.append(fragment);
    // drop empty inline wrappers left behind by the split
    for (const el of [block, next])
      for (const inline of [...el.querySelectorAll("b,i,u,a,span,strong,em")]) if (!inline.textContent && !inline.querySelector("br")) inline.remove();
    if (!block.textContent && !block.querySelector("br")) block.replaceChildren(doc.createElement("br"));
    if (!next.textContent) next.replaceChildren(doc.createElement("br"));
    block.after(next);
    normalize();
    const list = blocks();
    const index = list.indexOf(next);
    setCaret({ block: index, offset: 0, endBlock: index, endOffset: 0 });
    if (snapshot()) options.onChange();
  };
  const mergeInto = (target: HTMLElement, source: HTMLElement) => {
    const offset = readModel(target).runs.map((r) => r.text).join("").length;
    if (target.lastChild?.nodeName === "BR") target.lastChild.remove();
    const moving = [...source.childNodes];
    if (moving.length === 1 && moving[0].nodeName === "BR" && target.childNodes.length) moving.length = 0;
    target.append(...moving);
    source.remove();
    normalize();
    const index = blocks().indexOf(target);
    setCaret({ block: index, offset, endBlock: index, endOffset: offset });
    if (snapshot()) options.onChange();
  };
  const atBlockStart = (range: Range, block: HTMLElement) => range.collapsed && offsetIn(block, range.startContainer, range.startOffset) === 0;
  const atBlockEnd = (range: Range, block: HTMLElement) =>
    range.collapsed && offsetIn(block, range.startContainer, range.startOffset) >= readModel(block).runs.map((r) => r.text).join("").length;
  const deleteBackward = (event: Event) => {
    const range = currentRange();
    const block = range && blockOf(range.startContainer);
    if (!range || !block || isLocked(block) || !atBlockStart(range, block)) return;
    event.preventDefault();
    const model = readModel(block);
    if (model.type === "listItem") {
      commit(() => setType(block, { type: "paragraph", align: model.align }));
      return;
    }
    const previous = block.previousElementSibling as HTMLElement | null;
    let target = previous;
    while (target && target.dataset.marker === "true") target = target.previousElementSibling as HTMLElement | null;
    if (!target) return;
    if (isLocked(target)) {
      // never delete a table or picture by backspace; an empty paragraph after it goes away
      if (!model.runs.length) commit(() => block.remove());
      return;
    }
    mergeInto(target, block);
  };
  const deleteForward = (event: Event) => {
    const range = currentRange();
    const block = range && blockOf(range.startContainer);
    if (!range || !block || isLocked(block) || !atBlockEnd(range, block)) return;
    event.preventDefault();
    let next = block.nextElementSibling as HTMLElement | null;
    while (next && next.dataset.marker === "true") next = next.nextElementSibling as HTMLElement | null;
    if (!next || isLocked(next)) return;
    mergeInto(block, next);
  };
  const insertPlainText = (text: string) => {
    const lines = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").split("\n");
    lines.forEach((line, i) => {
      if (i > 0) splitBlock();
      if (line) doc.execCommand?.("insertText", false, line);
    });
    changed(true);
  };

  page.addEventListener("beforeinput", (event) => {
    const input = event as InputEvent;
    switch (input.inputType) {
      case "insertParagraph":
        event.preventDefault();
        splitBlock();
        break;
      case "historyUndo":
        event.preventDefault();
        undo();
        break;
      case "historyRedo":
        event.preventDefault();
        redo();
        break;
      case "deleteContentBackward":
        deleteBackward(event);
        break;
      case "deleteContentForward":
        deleteForward(event);
        break;
      case "insertFromPaste":
      case "insertFromDrop":
      case "insertReplacementText": {
        const text = input.dataTransfer?.getData("text/plain");
        if (text !== undefined && input.inputType !== "insertReplacementText") {
          event.preventDefault();
          insertPlainText(text);
        }
        break;
      }
    }
  });
  page.addEventListener("paste", (event) => {
    event.preventDefault();
    insertPlainText((event as ClipboardEvent).clipboardData?.getData("text/plain") || "");
  });
  page.addEventListener("drop", (event) => {
    event.preventDefault();
    insertPlainText((event as DragEvent).dataTransfer?.getData("text/plain") || "");
  });
  page.addEventListener("input", () => changed());
  page.addEventListener("compositionstart", () => {
    composing = true;
  });
  page.addEventListener("compositionend", () => {
    composing = false;
    changed();
  });
  page.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && !event.altKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (event.altKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(event.key === "ArrowUp" ? -1 : 1);
    }
  });
  doc.addEventListener("selectionchange", () => {
    const selection = win.getSelection();
    if (selection?.rangeCount && page.contains(selection.getRangeAt(0).startContainer)) savedRange = selection.getRangeAt(0).cloneRange();
  });

  // ------------------------------------------------------------ commands ---
  const restoreSelection = () => {
    if (!savedRange || !page.contains(savedRange.startContainer)) return false;
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange);
    return true;
  };
  const toggleHeading = (level: number) =>
    commit(() => {
      const targets = selectedBlocks();
      const all = targets.every((el) => readModel(el).type === "heading" && readModel(el).level === level);
      for (const el of targets) {
        const model = readModel(el);
        setType(el, all ? { type: "paragraph", align: model.align } : { type: "heading", level, align: model.align });
      }
    });
  const toggleList = (kind: "bullet" | "ordered") =>
    commit(() => {
      const targets = selectedBlocks();
      const all = targets.every((el) => readModel(el).list === kind);
      for (const el of targets) {
        const model = readModel(el);
        setType(el, all ? { type: "paragraph", align: model.align } : { type: "listItem", list: kind, ilvl: model.ilvl || 0, align: model.align });
      }
    });
  const align = (value: (typeof ALIGNS)[number]) =>
    commit(() => {
      for (const el of selectedBlocks()) {
        el.dataset.align = value;
        el.style.textAlign = value;
      }
    });
  const inline = (command: "bold" | "italic" | "underline") => {
    restoreSelection();
    doc.execCommand?.(command, false);
    changed(true);
  };
  const linkAt = () => {
    const range = currentRange();
    let node: Node | null = range?.startContainer || null;
    while (node && node !== page) {
      if (node.nodeName === "A") return node as HTMLAnchorElement;
      node = node.parentNode;
    }
    return null;
  };
  const setLink = (href: string | null) => {
    restoreSelection();
    const existing = linkAt();
    const range = currentRange();
    if (href === null) {
      if (existing) {
        commit(() => existing.replaceWith(...existing.childNodes));
      } else {
        doc.execCommand?.("unlink", false);
        changed(true);
      }
      return;
    }
    if (!SAFE_HREF.test(href)) throw new Error("http(s)またはmailtoのURLを入力してください。");
    if (existing && range?.collapsed) {
      // caret inside a link: change that whole link
      const whole = doc.createRange();
      whole.selectNodeContents(existing);
      win.getSelection()?.removeAllRanges();
      win.getSelection()?.addRange(whole);
    } else if (range?.collapsed) {
      // no selection: type the URL as the link text, select it, then link it like a selection
      const before = caret();
      doc.execCommand?.("insertText", false, href);
      normalize();
      if (before)
        setCaret({ block: before.block, offset: before.offset, endBlock: before.block, endOffset: before.offset + href.length });
    }
    doc.execCommand?.("createLink", false, href);
    changed(true);
  };
  const move = (delta: -1 | 1) =>
    commit(() => {
      const targets = selectedBlocks();
      if (!targets.length) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (delta < 0) {
        let before = first.previousElementSibling;
        while (before && (before as HTMLElement).dataset.marker === "true") before = before.previousElementSibling;
        if (before) before.before(...targets);
      } else {
        let after = last.nextElementSibling;
        while (after && (after as HTMLElement).dataset.marker === "true") after = after.nextElementSibling;
        if (after) after.after(...targets);
      }
    });
  const state = () => {
    const range = currentRange();
    const block = range ? blockOf(range.startContainer) : null;
    const model = block && !isLocked(block) ? readModel(block) : null;
    let bold = false;
    let italic = false;
    let underline = false;
    let node: Node | null = range?.startContainer || null;
    if (node && node.nodeType === 1 && range && (node as Element).childNodes[range.startOffset - 1]) node = (node as Element).childNodes[range.startOffset - 1];
    while (node && node !== page && node !== block) {
      if (["B", "STRONG"].includes(node.nodeName)) bold = true;
      if (["I", "EM"].includes(node.nodeName)) italic = true;
      if (node.nodeName === "U") underline = true;
      node = node.parentNode;
    }
    return {
      canUndo: at > 0 || pendingSnapshot !== undefined,
      canRedo: at < history.length - 1,
      bold,
      italic,
      underline,
      heading: model?.type === "heading" ? model.level : undefined,
      list: model?.list,
      align: model?.align || (model ? "left" : undefined),
      link: !!linkAt(),
    };
  };

  // -------------------------------------------------------------- public ---
  return {
    load(data: EditorBlockData[]) {
      ids = new Map();
      locked.clear();
      required.clear();
      const nodes: HTMLElement[] = [];
      data.forEach((block, index) => {
        const key = newKey();
        ids.set(key, block.id);
        if (block.editable) {
          nodes.push(
            renderEditable(
              {
                key,
                model: {
                  type: block.type === "heading" ? "heading" : block.type === "listItem" ? "listItem" : "paragraph",
                  level: block.type === "heading" ? block.level || 1 : undefined,
                  list: block.type === "listItem" ? (block.list?.kind === "ordered" ? "ordered" : "bullet") : undefined,
                  ilvl: block.type === "listItem" ? block.list?.ilvl || 0 : undefined,
                  align: ALIGNS.find((value) => value === block.align),
                  runs: [],
                },
              },
              block.runs,
            ),
          );
        } else {
          const el = renderLocked(block, key);
          locked.set(key, el);
          if (block.required) required.set(key, index);
          nodes.push(el);
        }
      });
      page.replaceChildren(...nodes);
      page.contentEditable = "true";
      normalize();
      history = [];
      at = -1;
      snapshot();
    },
    /** Re-apply an unsaved draft payload (same revision) on top of the loaded document. */
    loadDraft(inputs: SaveInput[]) {
      const keyOf = new Map([...ids].map(([key, id]) => [id, key]));
      const initial = new Map((history[0]?.entries || []).map((entry) => [entry.key, entry]));
      const restored: Entry[] = [];
      for (const input of inputs) {
        if (!input || typeof input !== "object") return false;
        const id = "id" in input ? input.id : undefined;
        if (!("type" in input)) {
          const entry = id ? initial.get(keyOf.get(id) || "") : undefined;
          if (!entry) return false;
          restored.push(entry);
          continue;
        }
        const { id: _id, base, ...model } = input as ParagraphModel & { id?: string; base?: string };
        void _id;
        if (!Array.isArray(model.runs)) return false;
        const key = id ? keyOf.get(id) : newKey();
        if (!key || (id && locked.has(key))) return false;
        const baseKey = base ? keyOf.get(base) : undefined;
        restored.push({ key, ...(baseKey ? { baseKey } : {}), model });
      }
      restore({ entries: restored, caret: null });
      snapshot();
      return true;
    },
    entries,
    /** The save payload plus the keys in the same order (to map the response ids back). */
    payload() {
      if (pendingSnapshot !== undefined) snapshot();
      const list = entries();
      const resolveBase = (key?: string): string | undefined => {
        const seen = new Set<string>();
        while (key && !seen.has(key)) {
          seen.add(key);
          const id = ids.get(key);
          if (id) return id;
          key = (page.querySelector<HTMLElement>(`[data-key="${key}"]`)?.dataset.baseKey) || undefined;
        }
        return undefined;
      };
      const blocksOut: SaveInput[] = list.map((entry) => {
        if (entry.locked) return { id: ids.get(entry.key)! };
        const id = ids.get(entry.key);
        if (id) return { id, ...entry.model };
        const base = resolveBase(entry.baseKey);
        return base ? { base, ...entry.model } : { ...entry.model };
      });
      return { blocks: blocksOut, keys: list.map((entry) => entry.key) };
    },
    /** After a save: the server ids of the saved revision, in payload order. */
    remap(keys: string[], data: EditorBlockData[]) {
      if (keys.length !== data.length) return false;
      ids = new Map();
      keys.forEach((key, i) => ids.set(key, data[i].id));
      for (const el of blocks()) if (el.dataset.baseKey && ids.has(el.dataset.key!)) delete el.dataset.baseKey;
      // a saved paragraph may still be locked/unlocked differently in the new revision
      return keys.every((key, i) => {
        const el = page.querySelector<HTMLElement>(`[data-key="${key}"]`);
        return !el || isLocked(el) === !data[i].editable;
      });
    },
    blockKeyFor(id: string) {
      for (const [key, value] of ids) if (value === id) return key;
      return undefined;
    },
    replaceText(key: string, text: string) {
      const el = page.querySelector<HTMLElement>(`[data-key="${key}"]`);
      if (!el || isLocked(el)) return false;
      const lines = text.split("\n");
      commit(() => {
        const first = readModel(el).runs[0];
        const format = { bold: !!first?.bold, italic: !!first?.italic, underline: !!first?.underline };
        fillRuns(el, [{ text: lines[0], ...format }]);
        let previous = el;
        for (const line of lines.slice(1)) {
          const model = readModel(el);
          const next = blockElement(model.type === "heading" ? { type: "paragraph", align: model.align } : model);
          next.dataset.key = newKey();
          next.dataset.baseKey = key;
          fillRuns(next, [{ text: line, ...format }]);
          previous.after(next);
          previous = next;
        }
      });
      return true;
    },
    clear() {
      page.replaceChildren();
      page.contentEditable = "false";
      ids = new Map();
      history = [];
      at = -1;
    },
    focus() {
      if (!restoreSelection()) page.focus();
    },
    undo,
    redo,
    toggleHeading,
    toggleList,
    align,
    inline,
    setLink,
    move,
    state,
    hasSelection: () => !!currentRange(),
    linkHref: () => linkAt()?.getAttribute("href") || linkAt()?.dataset.href || "",
  };
}
export type OfficeEditor = ReturnType<typeof createOfficeEditor>;
