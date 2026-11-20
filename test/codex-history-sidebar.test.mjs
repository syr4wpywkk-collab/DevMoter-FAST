import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const codex = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
const locales = ["en", "ja", "zh-Hans", "zh-Hant"];

test("Codex sidebar puts conversation history first and pins tools below it", () => {
  const sidebar = codex.slice(codex.indexOf('<aside id="cxSidebar"'), codex.indexOf("</aside>", codex.indexOf('<aside id="cxSidebar"')));
  const scroll = sidebar.indexOf('<div class="cx-sidebar-scroll">');
  const threads = sidebar.indexOf('id="cxSidebarThreads"');
  const nav = sidebar.indexOf('<nav class="cx-side-nav"');
  const foot = sidebar.indexOf('<div class="cx-sidebar-foot">');
  assert.ok(scroll >= 0 && threads > scroll && nav > threads && foot > nav, "new chat, search, history, then tools, then footer");
  const scrollEnd = sidebar.indexOf("\n        </div>\n", threads);
  assert.ok(nav > scrollEnd, "tools sit outside the history scroller so they stay reachable");
  for (const id of ["cxProjectsNav", "cxPluginsQuick", "cxIntegrationsNav", "cxDevWorkflowsNav"]) {
    assert.ok(sidebar.slice(nav, foot).includes(`id="${id}"`), `${id} stays in the tools nav`);
  }
  assert.match(sidebar, /<nav class="cx-side-nav" aria-label="\$\{escapeHtml\(t\("codex\.sidebar\.toolsAria"\)\)\}">/);
});

test("tools nav label is localized", async () => {
  for (const locale of locales) {
    const module = await import(`../src/locales/${locale}.mjs`);
    const dictionary = Object.values(module)[0];
    assert.equal(typeof dictionary["codex.sidebar.toolsAria"], "string", locale);
  }
});
