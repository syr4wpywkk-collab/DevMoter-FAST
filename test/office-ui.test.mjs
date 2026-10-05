import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";

const source = await readFile(
  new URL("../src/office.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
function mount(t, fetch) {
  const dom = new JSDOM(
    "<!doctype html><body><button id='opener'>Office</button></body>",
    { url: "http://localhost", runScripts: "outside-only" },
  );
  t.after(() => dom.window.close());
  dom.window.require = () => ({});
  dom.window.exports = {};
  dom.window.fetch = fetch;
  dom.window.confirm = () => true;
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new dom.window.Event("close"));
  };
  dom.window.eval(compiled);
  return dom;
}
const doc = {
  id: "document",
  revision: "v1",
  name: "Test.docx",
  warnings: [],
  history: [
    { revision: "v1", createdAt: new Date().toISOString(), source: "original" },
  ],
  blocks: [
    {
      id: "b0",
      type: "paragraph",
      editable: true,
      text: "Original",
      runs: [{ text: "Original", bold: true }],
    },
  ],
};
const response = (value) => ({
  ok: true,
  json: async () => structuredClone(value),
});
test("Office keeps drafts across close/reopen, saves model text and does not render document HTML", async (t) => {
  let saved;
  const dom = mount(t, async (path, options) => {
    if (path.endsWith("/context"))
      return response({ projects: [], providers: [] });
    if (options.method === "PATCH") {
      saved = JSON.parse(options.body);
      return response({
        ...doc,
        revision: "v2",
        blocks: [
          {
            ...doc.blocks[0],
            text: saved.edits[0].text,
            runs: [{ text: saved.edits[0].text }],
          },
        ],
      });
    }
    return response(path === "/api/office/documents" ? [doc] : doc);
  });
  const w = dom.window;
  w.localStorage.setItem("devmoter-office-document", doc.id);
  w.exports.openOffice();
  await tick();
  const q = (selector) => w.document.querySelector(selector);
  q(".office-edit").click();
  const input = q("[data-page] textarea");
  input.value = "<img src=x onerror=alert(1)>";
  input.dispatchEvent(new w.Event("input"));
  q("[data-close]").click();
  w.exports.openOffice();
  assert.equal(q("dialog").open, true);
  assert.equal(q("[data-page] textarea").value, input.value);
  assert.ok(w.sessionStorage.getItem("devmoter-office-draft:document"));
  q("[data-save]").click();
  await tick();
  assert.equal(saved.revision, "v1");
  assert.equal(saved.edits[0].text, input.value);
  assert.equal(q("[data-page] img"), null);
  assert.equal(
    w.sessionStorage.getItem("devmoter-office-draft:document"),
    null,
  );
  assert.match(q("[data-provider-notice]").textContent, /未設定/);
});
test("Office reconnects unknown run after restart without automatic resubmission", async (t) => {
  const calls = [];
  const dom = mount(t, async (path, options) => {
    calls.push({ path, method: options.method });
    if (path.endsWith("/context"))
      return response({ projects: [], providers: [] });
    if (path.includes("/ai/runs/"))
      return response({ id: "previous", status: "unknown", error: "restart" });
    return response(path === "/api/office/documents" ? [doc] : doc);
  });
  const w = dom.window;
  w.localStorage.setItem("devmoter-office-document", doc.id);
  w.localStorage.setItem("devmoter-office-ai-run", "previous");
  w.exports.openOffice();
  await tick();
  assert.ok(calls.some((c) => c.path.endsWith("/runs/previous")));
  assert.ok(!calls.some((c) => c.method === "POST"));
  assert.match(
    w.document.querySelector("[data-ai-status]").textContent,
    /照合できません/,
  );
  assert.equal(w.document.querySelector("[data-top-stop]").hidden, true);
});
