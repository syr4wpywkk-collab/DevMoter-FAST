import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import {
  MAX_IMPORT_BYTES, decodeMarkdownFile, duplicateTitle, exportFileName, exportMarkdown, filterNotes, sortNotes
} from "../src/knowledge-notes.mjs";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { mountKnowledge } = await vite.ssrLoadModule("/src/knowledge.ts");
// Same module instance the UI uses, so the language switch reaches it.
const { setLanguage } = await vite.ssrLoadModule("/src/i18n-core.mjs");
await vite.close();

const note = (id, title, extra = {}) => ({ id, title, projectId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", pinned: false, content: "", ...extra });

test("pinned notes sort first, then newest; search ignores case and project filter narrows", () => {
  const notes = [
    note("a", "Alpha", { updatedAt: "2026-01-03T00:00:00.000Z" }),
    note("b", "beta plan", { pinned: true, projectId: "p1" }),
    note("c", "ALPHA two", { updatedAt: "2026-01-02T00:00:00.000Z", projectId: "p1" })
  ];
  assert.deepEqual(sortNotes(notes).map(item => item.id), ["b", "a", "c"]);
  assert.deepEqual(filterNotes(notes, { query: "alpha" }).map(item => item.id), ["a", "c"]);
  assert.deepEqual(filterNotes(notes, { query: " ＡＬＰＨＡ " }).map(item => item.id), ["a", "c"]);
  assert.deepEqual(filterNotes(notes, { query: "alpha", projectId: "p1" }).map(item => item.id), ["c"]);
  assert.deepEqual(filterNotes(notes, { query: "zzz" }), []);
  assert.equal(filterNotes(notes, { query: "" }).length, 3);
});

test("export keeps UTF-8 text and never produces an unsafe file name", () => {
  assert.equal(exportFileName("設計メモ: v2/草案"), "設計メモ_ v2_草案.md");
  assert.equal(exportFileName("../../etc/passwd"), "etc_passwd.md");
  assert.equal(exportFileName("..."), "note.md");
  assert.equal(exportFileName("CON"), "note.md");
  assert.equal(exportFileName("a\u0000b\r\nc"), "a_b_c.md");
  assert.ok(Array.from(exportFileName("あ".repeat(500))).length <= 83);
  for (const name of ["a\\b", "x<y>|z?*\"", ".hidden", "trailing. "]) {
    assert.doesNotMatch(exportFileName(name), /[\\/:*?"<>|\0-\x1f]|^\.|[. ]\.md$/);
  }
  const text = exportMarkdown({ title: "日本語 😀", content: "本文 — ✓\n```js\n1\n```" });
  assert.equal(text, "# 日本語 😀\n\n本文 — ✓\n```js\n1\n```\n");
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(text)), text);
  assert.equal(duplicateTitle("原本", "(コピー)"), "原本 (コピー)");
  assert.equal(duplicateTitle("x".repeat(300), "(copy)").length, 300);
  // The server limit is 300 UTF-16 units; emoji take two each and must not be cut in half.
  const emojiCopy = duplicateTitle("😀".repeat(150), "(copy)");
  assert.ok(emojiCopy.length <= 300 && emojiCopy.endsWith(" (copy)") && emojiCopy.isWellFormed());
});

test("import validates size and UTF-8 and takes the title from the heading or the file name", () => {
  const bytes = value => new TextEncoder().encode(value);
  assert.deepEqual(decodeMarkdownFile(bytes("\uFEFF# 議事録\r\n\r\n本文\r\n"), "x.md"), { ok: true, title: "議事録", content: "本文\n" });
  assert.deepEqual(decodeMarkdownFile(bytes("no heading"), "C:\\docs\\メモ.markdown"), { ok: true, title: "メモ", content: "no heading" });
  assert.deepEqual(decodeMarkdownFile(bytes("    # shell comment\n    ls\n"), "snippet.md"), { ok: true, title: "snippet", content: "    # shell comment\n    ls\n" });
  assert.ok(decodeMarkdownFile(bytes("# " + "😀".repeat(200) + "\n\nbody"), "long.md").title.length <= 300);
  assert.deepEqual(decodeMarkdownFile(new Uint8Array([0xff, 0xfe, 0x41]), "a.md"), { ok: false, reason: "notUtf8" });
  assert.deepEqual(decodeMarkdownFile(new Uint8Array([0x82, 0xa0]), "sjis.md"), { ok: false, reason: "notUtf8" });
  assert.deepEqual(decodeMarkdownFile(bytes("a\0b"), "a.md"), { ok: false, reason: "notText" });
  assert.equal(decodeMarkdownFile(new Uint8Array(MAX_IMPORT_BYTES), "a.md").reason, "notText");
  assert.deepEqual(decodeMarkdownFile(new Uint8Array(MAX_IMPORT_BYTES + 1), "a.md"), { ok: false, reason: "tooLarge" });
});

// A small in-memory stand-in for the trusted-device Knowledge API.
function setup({ auth = true, offline = false, language = "en" } = {}) {
  const dom = new JSDOM("<!doctype html><body><button id='opener'>open</button></body>", { url: "http://localhost/", pretendToBeVisual: true });
  const { window } = dom;
  const state = { notes: new Map(), calls: [], failNext: null, seq: 0, clock: 0, downloads: [], auth, offline };
  const json = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
  const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++state.clock)).toISOString();
  const summary = ({ content, ...rest }) => rest;
  window.fetch = async (path, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, path, body, headers: init.headers || {} });
    if (state.offline) throw new TypeError("Failed to fetch");
    if (path === "/api/projects") return json(200, { projects: [{ id: "p1", name: "Alpha Project" }, { id: "p2", name: "Beta Project" }] });
    if (!state.auth) return json(401, { error: "Trusted device required" });
    if (state.failNext && method !== "GET") { const failure = state.failNext; state.failNext = null; return json(failure.status, { error: failure.error }); }
    if (path === "/api/knowledge/notes" && method === "GET") return json(200, { notes: [...state.notes.values()].map(summary) });
    if (path === "/api/knowledge/notes" && method === "POST") {
      const id = `00000000-0000-4000-8000-${String(++state.seq).padStart(12, "0")}`;
      const at = stamp();
      const created = { id, title: body.title, content: body.content || "", projectId: body.projectId || null, pinned: body.pinned === true, createdAt: at, updatedAt: at };
      state.notes.set(id, created);
      return json(201, { note: created });
    }
    const id = decodeURIComponent(path.split("/").pop());
    const existing = state.notes.get(id);
    if (!existing) return json(404, { error: "Note not found" });
    if (method === "GET") return json(200, { note: existing });
    if (method === "PATCH") {
      const next = { ...existing, ...body, updatedAt: stamp() };
      state.notes.set(id, next);
      return json(200, { note: next });
    }
    if (method === "DELETE") { state.notes.delete(id); return json(200, { ok: true, id }); }
    return json(405, { error: "Method not allowed" });
  };
  window.requestAnimationFrame = callback => { callback(0); return 0; };
  window.URL.createObjectURL = blob => { state.downloads.push({ blob }); return "blob:test"; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { if (this.download) state.downloads.at(-1).name = this.download; };
  for (const key of ["window", "document", "CustomEvent", "HTMLElement", "DOMException", "Blob", "URL", "fetch"]) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: window.localStorage });
  setLanguage(language);
  mountKnowledge();
  const doc = window.document;
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  const $ = selector => doc.querySelector(selector);
  const ui = {
    dom, doc, state, settle, $,
    open: async () => { window.dispatchEvent(new window.CustomEvent("devmoter:open-knowledge")); await settle(); },
    click: async selector => { const target = $(selector); assert.ok(target, `missing ${selector}`); target.click(); await settle(); },
    type: (selector, value) => { const field = $(selector); assert.ok(field, `missing ${selector}`); field.value = value; field.dispatchEvent(new window.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true })); },
    titles: () => [...doc.querySelectorAll("[data-know-note] strong")].map(node => node.textContent),
    status: () => $(".dm-know-status").textContent,
    primary: async () => { $(".dm-sheet-head-primary").click(); await settle(); },
    seed: (title, extra = {}) => {
      const id = `00000000-0000-4000-8000-${String(++state.seq).padStart(12, "0")}`;
      const at = stamp();
      state.notes.set(id, { id, title, content: "", projectId: null, pinned: false, createdAt: at, updatedAt: at, ...extra });
      return id;
    },
    mutations: () => state.calls.filter(call => call.method !== "GET")
  };
  return ui;
}

test("#429 the list tells loading, empty, device-auth and connection failure apart", async t => {
  const empty = setup();
  t.after(() => empty.dom.window.close());
  empty.doc.defaultView.dispatchEvent(new empty.doc.defaultView.CustomEvent("devmoter:open-knowledge"));
  assert.ok(empty.$(".dm-know-loading"), "loading is shown before the list answers");
  await empty.settle();
  assert.equal(empty.$(".dm-know-modal").classList.contains("hidden"), false);
  assert.ok(empty.$("[data-know-empty-new]"), "empty state offers a first note");
  assert.equal(empty.$("[data-know-auth]"), null);

  const locked = setup({ auth: false, language: "ja" });
  await locked.open();
  assert.ok(locked.$("[data-know-auth]"), "an untrusted device sees the registration gate");
  assert.equal(locked.$("[data-know-empty-new]"), null, "auth failure must not look like an empty list");
  assert.equal(locked.$(".dm-sheet-head-primary").hidden, true);
  locked.dom.window.close();

  const offline = setup({ offline: true });
  await offline.open();
  assert.ok(offline.$("[data-know-error]"));
  assert.equal(offline.$("[data-know-empty-new]"), null);
  offline.state.offline = false;
  offline.seed("Recovered");
  await offline.click("[data-know-error] button");
  assert.deepEqual(offline.titles(), ["Recovered"]);
  offline.dom.window.close();
});

test("#430 #431 create and edit persist through the API and keep input when saving fails", async t => {
  const ui = setup();
  t.after(() => ui.dom.window.close());
  await ui.open();
  await ui.primary();
  ui.type('[name="title"]', "設計メモ");
  ui.type('[name="content"]', "# 見出し\n\n- 項目");
  ui.state.failNext = { status: 500, error: "disk full" };
  await ui.click("[data-know-save]");
  assert.equal(ui.$('[name="title"]').value, "設計メモ", "title survives a failed save");
  assert.equal(ui.$('[name="content"]').value, "# 見出し\n\n- 項目", "body survives a failed save");
  assert.equal(ui.$(".dm-know-status").dataset.state, "error");
  assert.equal(ui.state.notes.size, 0);
  await ui.click("[data-know-save]");
  assert.equal(ui.state.notes.size, 1);
  const created = [...ui.state.notes.values()][0];
  assert.deepEqual([created.title, created.content], ["設計メモ", "# 見出し\n\n- 項目"]);
  assert.match(ui.mutations().at(-1).headers["x-pocket-operation-id"], /\S/);
  assert.equal(ui.$(".dm-know-content h1, .dm-know-content h2, .dm-know-content h3")?.textContent, "見出し");

  await ui.primary();
  ui.type('[name="title"]', "設計メモ v2");
  ui.type('[name="content"]', "更新");
  ui.state.failNext = { status: 413, error: "Note exceeds size limit" };
  await ui.primary();
  assert.equal(ui.$('[name="title"]').value, "設計メモ v2");
  assert.equal(ui.$('[name="content"]').value, "更新");
  await ui.primary();
  assert.deepEqual([ui.state.notes.get(created.id).title, ui.state.notes.get(created.id).content], ["設計メモ v2", "更新"]);
  assert.equal(ui.state.notes.size, 1, "editing never creates a second note");

  // Reload: a fresh open reads the saved values back from the API.
  await ui.open();
  assert.deepEqual(ui.titles(), ["設計メモ v2"]);

  await ui.primary();
  await ui.click("[data-know-save]");
  assert.equal(ui.state.notes.size, 1, "an empty title is refused before any request");
});

test("#432 delete needs an explicit confirmation and cancel keeps the note", async t => {
  const ui = setup();
  t.after(() => ui.dom.window.close());
  const id = ui.seed("Keep me");
  await ui.open();
  await ui.click(`[data-know-note="${id}"]`);
  await ui.click("[data-know-delete]");
  assert.ok(ui.$('[role="alertdialog"]'));
  assert.equal(ui.mutations().length, 0, "the first tap only asks");
  await ui.click("[data-know-delete-cancel]");
  assert.equal(ui.$('[role="alertdialog"]'), null);
  assert.equal(ui.state.notes.has(id), true);
  await ui.click("[data-know-delete]");
  ui.doc.dispatchEvent(new ui.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(ui.$('[role="alertdialog"]'), null, "Escape cancels the confirmation");
  assert.equal(ui.$(".dm-know-modal").classList.contains("hidden"), false);
  assert.equal(ui.mutations().length, 0);
  await ui.click("[data-know-delete]");
  await ui.click("[data-know-delete-confirm]");
  assert.equal(ui.state.notes.has(id), false);
  assert.deepEqual(ui.mutations().map(call => call.method), ["DELETE"]);
  assert.ok(ui.$("[data-know-empty-new]"));
});

test("#433 #434 #435 pin order, title search and project filter", async t => {
  const ui = setup();
  t.after(() => ui.dom.window.close());
  const old = ui.seed("Old Roadmap");
  ui.seed("Meeting notes", { projectId: "p2" });
  ui.seed("roadmap draft");
  await ui.open();
  assert.deepEqual(ui.titles(), ["roadmap draft", "Meeting notes", "Old Roadmap"]);

  await ui.click(`[data-know-note="${old}"]`);
  await ui.click("[data-know-pin]");
  assert.equal(ui.state.notes.get(old).pinned, true);
  assert.equal(ui.$("[data-know-pin]").getAttribute("aria-pressed"), "true");
  await ui.open();
  assert.deepEqual(ui.titles(), ["Old Roadmap", "roadmap draft", "Meeting notes"], "pinned note leads after reload");

  ui.type(".dm-know-search", "ROADMAP");
  assert.deepEqual(ui.titles(), ["Old Roadmap", "roadmap draft"]);
  ui.type(".dm-know-search", "nothing-here");
  assert.ok(ui.$("[data-know-no-results]"));
  ui.type(".dm-know-search", "");
  assert.equal(ui.titles().length, 3);

  ui.type("[data-know-project-filter]", "p2");
  assert.deepEqual(ui.titles(), ["Meeting notes"]);
  ui.type("[data-know-project-filter]", "p1");
  assert.ok(ui.$("[data-know-no-results]"));
  await ui.click("[data-know-no-results] button");
  assert.equal(ui.titles().length, 3);

  // Assign, then clear, a project from the editor.
  await ui.click(`[data-know-note="${old}"]`);
  await ui.primary();
  assert.deepEqual([...ui.$('[name="projectId"]').options].map(option => option.value), ["", "p1", "p2"]);
  ui.type('[name="projectId"]', "p1");
  await ui.primary();
  assert.equal(ui.state.notes.get(old).projectId, "p1");
  assert.match(ui.$(".dm-know-note-meta").textContent, /Alpha Project/);
  await ui.primary();
  ui.type('[name="projectId"]', "");
  await ui.primary();
  assert.equal(ui.state.notes.get(old).projectId, null);
  assert.equal(ui.mutations().at(-1).body.projectId, null);

  await ui.click("[data-know-pin]");
  assert.equal(ui.state.notes.get(old).pinned, false);
});

test("#436 duplicate creates an independent note and leaves the original untouched", async t => {
  const ui = setup();
  t.after(() => ui.dom.window.close());
  const id = ui.seed("Original", { content: "body", projectId: "p1", pinned: true });
  const before = JSON.stringify(ui.state.notes.get(id));
  await ui.open();
  await ui.click(`[data-know-note="${id}"]`);
  await ui.click("[data-know-duplicate]");
  assert.equal(ui.state.notes.size, 2);
  assert.equal(JSON.stringify(ui.state.notes.get(id)), before);
  const copy = [...ui.state.notes.values()].find(item => item.id !== id);
  assert.deepEqual([copy.title, copy.content, copy.projectId, copy.pinned], ["Original (copy)", "body", "p1", false]);
  // Editing the copy does not reach the original.
  await ui.primary();
  ui.type('[name="content"]', "changed");
  await ui.primary();
  assert.equal(ui.state.notes.get(copy.id).content, "changed");
  assert.equal(JSON.stringify(ui.state.notes.get(id)), before);
});

test("#437 export downloads the open note as UTF-8 Markdown with a safe name", async t => {
  const ui = setup();
  t.after(() => ui.dom.window.close());
  const id = ui.seed("仕様/レビュー: 第1版", { content: "日本語の本文 😀" });
  await ui.open();
  await ui.click(`[data-know-note="${id}"]`);
  await ui.click("[data-know-export]");
  assert.equal(ui.state.downloads.length, 1);
  assert.equal(ui.state.downloads[0].name, "仕様_レビュー_ 第1版.md");
  assert.equal(ui.state.downloads[0].blob.type, "text/markdown;charset=utf-8");
  const bytes = new Uint8Array(await new Promise(resolve => {
    const reader = new ui.dom.window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(ui.state.downloads[0].blob);
  }));
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "# 仕様/レビュー: 第1版\n\n日本語の本文 😀\n");
  assert.equal(ui.mutations().length, 0, "export does not change stored notes");
});

test("#438 import creates a new note, rejects bad files and never overwrites", async t => {
  const ui = setup();
  t.after(() => ui.dom.window.close());
  const existing = ui.seed("議事録", { content: "keep" });
  await ui.open();
  const pick = async (bytes, name) => {
    const input = ui.$("[data-know-import-input]");
    const file = { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new ui.dom.window.Event("change"));
    await ui.settle();
  };
  await pick(new Uint8Array([0x82, 0xa0, 0x82, 0xa2]), "sjis.md");
  assert.equal(ui.$(".dm-know-status").dataset.state, "error");
  assert.match(ui.status(), /UTF-8/);
  await pick(new Uint8Array(MAX_IMPORT_BYTES + 1), "big.md");
  assert.match(ui.status(), /1 MB/);
  assert.equal(ui.mutations().length, 0, "rejected files send nothing");
  assert.equal(ui.state.notes.size, 1);

  await pick(new TextEncoder().encode("# 議事録\n\n取り込んだ本文"), "議事録.md");
  assert.equal(ui.state.notes.size, 2, "same title still becomes a separate note");
  assert.deepEqual(ui.mutations().map(call => call.method), ["POST"]);
  assert.equal(ui.state.notes.get(existing).content, "keep");
  const imported = [...ui.state.notes.values()].find(item => item.id !== existing);
  assert.deepEqual([imported.title, imported.content], ["議事録", "取り込んだ本文"]);
});
