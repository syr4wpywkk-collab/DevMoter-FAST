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

test("workspace enhancer preserves Codex Markdown and source copy while enhancing OpenCode", async t => {
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
  opencode.textContent = "## OpenCode\n\n**Legacy answer**";

  const initialMarkup = codex.innerHTML;
  const initialCopy = codex.querySelector(".dm-code-copy");
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
  assert.equal(opencode.querySelector("h2").textContent, "OpenCode");
  assert.equal(opencode.querySelector("strong").textContent, "Legacy answer");
  assert.equal(opencode.dataset.dmSource, "## OpenCode\n\n**Legacy answer**");

  // Exercise the real observer path after another Codex stream update and an
  // OpenCode response arriving after workspace control has mounted.
  renderChatMarkdown(codex, `## Updated Codex\n\n\`\`\`js\n${code}\`\`\``, text => copied.push(text));
  const updatedMarkup = codex.innerHTML;
  const updatedCopy = codex.querySelector(".dm-code-copy");
  const newResponse = document.createElement("article");
  newResponse.className = "ocx-message-row assistant";
  newResponse.innerHTML = '<div class="ocx-assistant-text"></div>';
  newResponse.firstElementChild.textContent = "**New legacy response**";
  document.querySelector(".ocx-transcript").append(newResponse);
  await Promise.resolve();
  assert.ok(timers.length > 0, "real MutationObserver schedules enhancement");
  timers.splice(0).forEach(callback => callback());

  assert.equal(codex.innerHTML, updatedMarkup);
  assert.equal(codex.querySelector(".dm-code-copy"), updatedCopy);
  assert.equal(codex.dataset.dmSource, undefined);
  assert.equal(codex.dataset.dmRich, undefined);
  assert.equal(newResponse.querySelector("strong").textContent, "New legacy response");
  updatedCopy.click();
  assert.deepEqual(copied, [code]);
});
