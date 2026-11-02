import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as apiModelLabelModule from "../src/api-model-label.mjs";

const compile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
const officeJs = await compile("../src/office.ts");
const editorJs = await compile("../src/office-editor.ts");
const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

function mount(t, fetch) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.exports = {};
  w.eval(editorJs);
  const editorModule = w.exports;
  w.require = (name) => (name === "./api-model-label.mjs" ? apiModelLabelModule : name === "./office-editor" ? editorModule : {});
  w.exports = {};
  w.fetch = fetch;
  w.confirm = () => true;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new w.Event("close"));
  };
  w.eval(officeJs);
  return dom;
}
const doc = {
  id: "document",
  revision: "v1",
  name: "Test.docx",
  warnings: [],
  history: [{ revision: "v1", createdAt: new Date().toISOString(), source: "original" }],
  blocks: [
    { id: "b0", type: "heading", level: 1, editable: true, text: "Title", runs: [{ text: "Title" }] },
    {
      id: "b1",
      type: "paragraph",
      editable: true,
      text: "Bold and <img src=x onerror=alert(1)> link",
      runs: [
        { text: "Bold", bold: true },
        { text: " and <img src=x onerror=alert(1)> " },
        { text: "link", href: "https://example.com/" },
      ],
    },
    { id: "b2", type: "table", editable: false, text: "", runs: [], table: { rows: [{ cells: [{ text: "cell" }] }] } },
    { id: "b3", type: "listItem", list: { kind: "bullet", ilvl: 0, numId: "1" }, editable: true, text: "Item", runs: [{ text: "Item" }] },
  ],
};
const response = (value, ok = true, status = 200) => ({ ok, status, json: async () => structuredClone(value) });
/** Server double: echoes the saved blocks back as the next revision. */
function server({ providers = [], fail = 0, docs = [doc] } = {}) {
  const calls = [];
  let revision = 1;
  let failures = fail;
  const fetch = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method: options.method || "GET", body });
    if (path.endsWith("/context")) return response({ projects: [], providers });
    if (options.method === "PATCH") {
      if (failures > 0) {
        failures--;
        return response({ error: "保存先に接続できません。" }, false, 503);
      }
      revision++;
      return response({
        ...doc,
        revision: `v${revision}`,
        blocks: body.blocks.map((b, i) =>
          b.type
            ? { id: `n${revision}-${i}`, type: b.type, level: b.level, editable: true, text: b.runs.map((r) => r.text).join(""), runs: b.runs, align: b.align, list: b.list ? { kind: b.list, ilvl: b.ilvl || 0 } : undefined }
            : { ...doc.blocks.find((x) => x.id === b.id), id: `n${revision}-${i}` },
        ),
      });
    }
    if (options.method === "DELETE") return response({ deleted: true });
    if (path === "/api/office/documents") return response(docs.map(({ blocks, ...meta }) => meta));
    return response(doc);
  };
  return { fetch, calls };
}
async function open(t, options) {
  const api = server(options);
  const dom = mount(t, api.fetch);
  dom.window.localStorage.setItem("devmoter-office-document", doc.id);
  dom.window.exports.openOffice();
  await tick();
  return { ...api, dom, w: dom.window, q: (s) => dom.window.document.querySelector(s), qa: (s) => [...dom.window.document.querySelectorAll(s)] };
}
const placeCaret = (w, node, offset = 0) => {
  const range = w.document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  w.getSelection().removeAllRanges();
  w.getSelection().addRange(range);
  w.document.dispatchEvent(new w.Event("selectionchange"));
};

test("Office renders the whole document as one editable page with formatting, without per-paragraph edit buttons", async (t) => {
  const { q, qa } = await open(t);
  const page = q("[data-page]");
  assert.equal(page.contentEditable, "true");
  assert.equal(page.hidden, false);
  assert.equal(qa(".office-edit").length, 0);
  assert.equal(qa("[data-page] textarea").length, 0);
  assert.equal(q("[data-page] h1").textContent, "Title");
  assert.equal(q("[data-page] b").textContent, "Bold");
  assert.equal(q("[data-page] a").getAttribute("href"), "https://example.com/");
  assert.equal(q("[data-page] img"), null, "document text is never parsed as HTML");
  assert.match(page.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(q("[data-page] .office-locked").contentEditable, "false");
  assert.equal(q("[data-page] [data-list]").dataset.marker, "•");
  assert.equal(q("[data-save-state]").textContent, "保存済み");
});

test("Office toolbar is icon-only with labels, 18px line icons", async (t) => {
  const { qa } = await open(t);
  const tools = qa("[data-tool]");
  assert.deepEqual(
    tools.map((b) => b.dataset.tool),
    ["undo", "redo", "bold", "italic", "underline", "h1", "h2", "h3", "bullet", "ordered", "left", "center", "right", "justify", "link"],
  );
  for (const tool of tools) {
    assert.ok(tool.getAttribute("aria-label"));
    assert.equal(tool.title, tool.getAttribute("aria-label"));
    assert.equal(tool.textContent.trim(), "");
    const icon = tool.querySelector("svg");
    assert.equal(icon.getAttribute("width"), "18");
    assert.equal(icon.getAttribute("stroke-width"), "1.5");
  }
});

test("Office autosaves the whole document, shows 未保存/保存中/保存済み and keeps typing on its element", async (t) => {
  const { q, w, calls } = await open(t);
  const paragraph = q('[data-page] [data-key] + p');
  paragraph.append(w.document.createTextNode(" more"));
  paragraph.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.equal(q("[data-save-state]").textContent, "未保存");
  await tick(1300);
  const patch = calls.find((c) => c.method === "PATCH");
  assert.ok(patch, "autosave sent");
  assert.equal(patch.body.revision, "v1");
  assert.deepEqual(patch.body.blocks.map((b) => b.id), ["b0", "b1", "b2", "b3"]);
  assert.deepEqual(patch.body.blocks[2], { id: "b2" });
  assert.deepEqual(patch.body.blocks[1].runs, [
    { text: "Bold", bold: true, italic: false, underline: false },
    { text: " and <img src=x onerror=alert(1)> ", bold: false, italic: false, underline: false },
    { text: "link", bold: false, italic: false, underline: false, href: "https://example.com/" },
    { text: " more", bold: false, italic: false, underline: false },
  ]);
  await tick();
  assert.equal(q("[data-save-state]").textContent, "保存済み");
  // the same element stays in the page (caret is not lost) and now carries the new id mapping
  assert.equal(paragraph.isConnected, true);
  paragraph.append(w.document.createTextNode("!"));
  paragraph.dispatchEvent(new w.Event("input", { bubbles: true }));
  await tick(1300);
  const second = calls.filter((c) => c.method === "PATCH")[1];
  assert.equal(second.body.revision, "v2");
  assert.equal(second.body.blocks[1].id, "n2-1");
  assert.equal(w.sessionStorage.getItem("devmoter-office-draft:document"), null);
});

test("Office save failure shows a short message with retry", async (t) => {
  const { q, w, calls } = await open(t, { fail: 1 });
  const heading = q("[data-page] h1");
  heading.firstChild.nodeValue = "New title";
  heading.dispatchEvent(new w.Event("input", { bubbles: true }));
  await tick(1300);
  assert.equal(q("[data-save-state]").textContent, "保存できませんでした");
  assert.equal(q("[data-retry]").hidden, false);
  assert.ok(w.sessionStorage.getItem("devmoter-office-draft:document"), "draft kept while unsaved");
  q("[data-retry]").click();
  await tick(50);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 2);
  assert.equal(q("[data-save-state]").textContent, "保存済み");
  assert.equal(q("[data-retry]").hidden, true);
});

test("Office block tools change headings, lists and alignment, and undo/redo restore them", async (t) => {
  const { q, w, calls } = await open(t);
  placeCaret(w, q("[data-page] b").firstChild, 1);
  q('[data-tool="h2"]').click();
  assert.equal(q("[data-page] h2")?.textContent, "Bold and <img src=x onerror=alert(1)> link");
  assert.equal(q('[data-tool="h2"]').getAttribute("aria-pressed"), "true");
  q('[data-tool="center"]').click();
  assert.equal(q("[data-page] h2").dataset.align, "center");
  q('[data-tool="undo"]').click();
  assert.equal(q("[data-page] h2").dataset.align, undefined);
  q('[data-tool="undo"]').click();
  assert.equal(q("[data-page] h2"), null);
  q('[data-tool="redo"]').click();
  assert.ok(q("[data-page] h2"));
  placeCaret(w, q("[data-page] h1").firstChild, 0);
  q('[data-tool="ordered"]').click();
  assert.equal(q("[data-page] p[data-list='ordered']").textContent, "Title");
  assert.equal(q("[data-page] p[data-list='ordered']").dataset.marker, "1.");
  await tick(1300);
  const blocks = calls.find((c) => c.method === "PATCH").body.blocks;
  assert.deepEqual(blocks.map((b) => [b.type || "keep", b.level ?? null, b.list ?? null]), [
    ["listItem", null, "ordered"],
    ["heading", 2, null],
    ["keep", null, null],
    ["listItem", null, "bullet"],
  ]);
});

test("Office link tool only accepts http(s)/mailto and wraps the selection", async (t) => {
  const { q, w } = await open(t);
  w.document.execCommand = (command, _ui, value) => {
    assert.equal(command, "createLink");
    const range = w.getSelection().getRangeAt(0);
    const a = w.document.createElement("a");
    a.setAttribute("href", value);
    range.surroundContents(a);
    return true;
  };
  const text = q("[data-page] h1").firstChild;
  const range = w.document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 5);
  w.getSelection().removeAllRanges();
  w.getSelection().addRange(range);
  w.document.dispatchEvent(new w.Event("selectionchange"));
  q('[data-tool="link"]').click();
  assert.equal(q("[data-link-form]").hidden, false);
  q("[data-link-input]").value = "javascript:alert(1)";
  q("[data-link-form]").dispatchEvent(new w.Event("submit", { cancelable: true }));
  assert.match(q("[data-error]").textContent, /http\(s\)またはmailto/);
  q("[data-link-input]").value = "https://devmoter.example/docs";
  q("[data-link-form]").dispatchEvent(new w.Event("submit", { cancelable: true }));
  assert.equal(q("[data-page] h1 a").getAttribute("href"), "https://devmoter.example/docs");
  assert.equal(q("[data-link-form]").hidden, true);
});

test("Office without AI shows exactly one button to the AI settings", async (t) => {
  let configured = 0;
  const api = server({ providers: [{ id: "openai", name: "OpenAI", ready: false, models: [] }] });
  const dom = mount(t, api.fetch);
  dom.window.exports.openOffice({ configureAi: () => configured++ });
  await tick();
  const ai = dom.window.document.querySelector(".office-ai");
  const visibleButtons = [...ai.querySelectorAll("button")].filter((b) => !b.closest("[hidden]"));
  assert.deepEqual(visibleButtons.map((b) => b.textContent), ["AI設定を開く"]);
  assert.equal(ai.querySelector("[data-ai-form]").hidden, true);
  visibleButtons[0].click();
  await tick();
  assert.equal(configured, 1);
});

test("Office document list renames and deletes with confirmation", async (t) => {
  const other = { ...doc, id: "other", name: "Other.docx", updatedAt: new Date().toISOString() };
  const { q, qa, w, calls } = await open(t, { docs: [other, { ...doc, updatedAt: new Date().toISOString() }] });
  assert.deepEqual(qa(".office-doc-name").map((e) => e.textContent), ["Other.docx", "Test.docx"]);
  assert.equal(qa(".office-doc-row")[1].getAttribute("aria-current"), "true");
  let asked = "";
  w.confirm = (message) => {
    asked = message;
    return false;
  };
  q('[aria-label="「Other.docx」を削除"]').click();
  await tick();
  assert.match(asked, /Other\.docx/);
  assert.ok(!calls.some((c) => c.method === "DELETE"), "cancelled delete sends nothing");
  w.confirm = () => true;
  q('[aria-label="「Other.docx」を削除"]').click();
  await tick();
  assert.ok(calls.some((c) => c.method === "DELETE" && c.path === "/api/office/documents/other"));
  q('[aria-label="「Test.docx」の名前を変更"]').click();
  const input = q(".office-rename input");
  assert.equal(input.value, "Test");
});

test("Office reconnects unknown run after restart without automatic resubmission", async (t) => {
  const calls = [];
  const dom = mount(t, async (path, options) => {
    calls.push({ path, method: options.method });
    if (path.endsWith("/context")) return response({ projects: [], providers: [] });
    if (path.includes("/ai/runs/")) return response({ id: "previous", status: "unknown", error: "restart" });
    return response(path === "/api/office/documents" ? [doc] : doc);
  });
  const w = dom.window;
  w.localStorage.setItem("devmoter-office-document", doc.id);
  w.localStorage.setItem("devmoter-office-ai-run", "previous");
  w.exports.openOffice();
  await tick();
  assert.ok(calls.some((c) => c.path.endsWith("/runs/previous")));
  assert.ok(!calls.some((c) => c.method === "POST"));
  assert.match(w.document.querySelector("[data-ai-status]").textContent, /照合できません/);
  assert.equal(w.document.querySelector("[data-stop]").hidden, true);
});

test("Office model list shows Gemini ids without the models/ prefix but sends the full id", async (t) => {
  const { q } = await open(t, { providers: [{ id: "gemini", name: "Google Gemini", ready: true, models: ["models/gemini-2.5-flash"] }] });
  const option = q("[data-model] option");
  assert.equal(option.textContent, "gemini-2.5-flash");
  assert.equal(option.value, "models/gemini-2.5-flash");
  assert.match(q("[data-provider-notice]").textContent, /Google Gemini \/ gemini-2\.5-flash$/);
  assert.equal(q("[data-ai-form]").hidden, false);
  assert.equal(q("[data-ai-unconfigured]").hidden, true);
});
