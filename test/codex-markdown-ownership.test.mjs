import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { renderChatMarkdown } from "../src/chat-markdown.mjs";

const workspaceSource = await readFile(new URL("../src/workspace-control.ts", import.meta.url), "utf8");
const compiledWorkspace = ts.transpileModule(workspaceSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

test("workspace enhancer preserves each chat renderer and source-backed code copy", async t => {
  const dom = new JSDOM(`<!doctype html>
    <section class="cx-transcript"><article class="cx-message-row assistant">
      <div class="cx-message-text"></div>
    </article></section>
    <section class="ocx-transcript"><article class="ocx-message-row assistant">
      <div class="ocx-assistant-text"></div>
    </article></section>`, {
    url: "https://devmoter.example/chat",
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const codex = document.querySelector(".cx-message-text");
  const opencode = document.querySelector(".ocx-assistant-text");
  const copied = [];
  const code = "  const result = '<unsafe>';  \n\nreturn result;\n";
  renderChatMarkdown(codex, `## Codex\n\n**Answer**\n\n\`\`\`js\n${code}\`\`\``, text => copied.push(text));
  renderChatMarkdown(opencode, `## OpenCode\n\n**Answer**\n\n\`\`\`js\n${code}\`\`\``, text => copied.push(text));

  const initialMarkup = codex.innerHTML;
  const initialCopy = codex.querySelector(".dm-code-copy");
  const initialOpenCodeMarkup = opencode.innerHTML;
  const initialOpenCodeCopy = opencode.querySelector(".dm-code-copy");
  const timers = [];
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.setInterval = () => 1;
  dom.window.setTimeout = callback => timers.push(callback);
  dom.window.exports = {};
  dom.window.eval(compiledWorkspace);
  const stop = dom.window.exports.startWorkspaceControl();
  t.after(stop);

  assert.equal(codex.innerHTML, initialMarkup);
  assert.equal(codex.querySelector(".dm-code-copy"), initialCopy);
  assert.equal(codex.dataset.dmSource, undefined);
  assert.equal(codex.dataset.dmRich, undefined);
  assert.equal(opencode.innerHTML, initialOpenCodeMarkup);
  assert.equal(opencode.querySelector(".dm-code-copy"), initialOpenCodeCopy);
  assert.equal(opencode.dataset.dmSource, undefined);
  assert.equal(opencode.dataset.dmRich, undefined);

  // Exercise the real observer path after another Codex stream update and an
  // OpenCode response arriving after workspace control has mounted.
  renderChatMarkdown(codex, `## Updated Codex\n\n\`\`\`js\n${code}\`\`\``, text => copied.push(text));
  const updatedMarkup = codex.innerHTML;
  const updatedCopy = codex.querySelector(".dm-code-copy");
  const newResponse = document.createElement("article");
  newResponse.className = "ocx-message-row assistant";
  newResponse.innerHTML = '<div class="ocx-assistant-text"></div>';
  renderChatMarkdown(newResponse.firstElementChild, `**New response**\n\n\`\`\`js\n${code}\`\`\``, text => copied.push(text));
  const newOpenCodeMarkup = newResponse.firstElementChild.innerHTML;
  const newOpenCodeCopy = newResponse.querySelector(".dm-code-copy");
  document.querySelector(".ocx-transcript").append(newResponse);
  await Promise.resolve();
  assert.ok(timers.length > 0, "real MutationObserver schedules enhancement");
  timers.splice(0).forEach(callback => callback());

  assert.equal(codex.innerHTML, updatedMarkup);
  assert.equal(codex.querySelector(".dm-code-copy"), updatedCopy);
  assert.equal(codex.dataset.dmSource, undefined);
  assert.equal(codex.dataset.dmRich, undefined);
  assert.equal(newResponse.firstElementChild.innerHTML, newOpenCodeMarkup);
  assert.equal(newResponse.querySelector(".dm-code-copy"), newOpenCodeCopy);
  assert.equal(newResponse.firstElementChild.dataset.dmSource, undefined);
  assert.equal(newResponse.firstElementChild.dataset.dmRich, undefined);
  updatedCopy.click();
  initialOpenCodeCopy.click();
  newOpenCodeCopy.click();
  assert.deepEqual(copied, [code, code, code]);
});

test("workspace controls dock only on Codex and retain their existing handlers and panel", async t => {
  const dom = new JSDOM('<!doctype html><aside><div id="cxWorkspaceControlsMount"></div></aside>', {
    url: "https://devmoter.example/chat",
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { document, CustomEvent } = dom.window;
  const requests = [];
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.setInterval = () => 1;
  dom.window.setTimeout = () => 1;
  dom.window.Headers = Headers;
  dom.window.fetch = async input => {
    requests.push(String(input));
    return {
      ok: true,
      json: async () => String(input).includes("microtasks")
        ? { plan: null }
        : { extensions: { installed: {}, catalog: [{ id: "existing", name: "Existing extension" }] } }
    };
  };
  dom.window.localStorage.setItem("opencode-pocket-backend", "codex");
  dom.window.localStorage.setItem("opencode-pocket-codex-thread", "preserved-thread");
  document.body.classList.add("codex-mode");
  dom.window.exports = {};
  dom.window.eval(compiledWorkspace);
  const stop = dom.window.exports.startWorkspaceControl();
  t.after(stop);

  const mount = document.querySelector("#cxWorkspaceControlsMount");
  const host = document.querySelector(".dm-controlbar");
  const panel = host.querySelector(".dm-panel");
  const buttons = [".dm-theme", ".dm-context", ".dm-tasks", ".dm-extensions"]
    .map(selector => host.querySelector(selector));
  assert.equal(host.parentElement, mount, "initial Codex surface docks the actual toolbar");

  buttons[0].click();
  assert.equal(dom.window.localStorage.getItem("devmoter-theme"), "light");
  buttons[1].click();
  assert.ok(panel.querySelector("[data-threshold]"), "existing Context panel remains functional");
  panel.querySelector("[data-close]").click();
  assert.equal(panel.classList.contains("hidden"), true);
  buttons[2].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(panel.textContent.includes("No checkpoint plan"));
  assert.ok(requests.some(path => path.includes("microtasks?parentId=preserved-thread")));
  buttons[3].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.querySelector(".dm-extension-row strong").textContent, "Existing extension");
  const existingPanel = panel.innerHTML;

  const surface = value => dom.window.dispatchEvent(new CustomEvent("devmoter:surface-changed", { detail: { surface: value } }));
  for (const value of ["opencode", "api", "home", "integrations"]) {
    // The real surface event precedes body class updates; its detail must win.
    surface(value);
    assert.equal(host.parentElement, document.body, value);
    document.body.classList.remove("codex-mode");
    dom.window.dispatchEvent(new CustomEvent("devmoter:backend-changed"));
    assert.equal(host.parentElement, document.body, `${value} backend update`);
    surface("codex");
    assert.equal(host.parentElement, mount, "Codex event docks before its body class updates");
    document.body.classList.add("codex-mode");
    dom.window.dispatchEvent(new CustomEvent("devmoter:backend-changed"));
    assert.equal(host.parentElement, mount);
  }
  assert.equal(document.querySelectorAll(".dm-controlbar").length, 1);
  assert.equal(host.querySelector(".dm-panel"), panel);
  assert.equal(panel.innerHTML, existingPanel);
  assert.equal(panel.classList.contains("hidden"), false);
  assert.deepEqual([".dm-theme", ".dm-context", ".dm-tasks", ".dm-extensions"].map(selector => host.querySelector(selector)), buttons);
});
