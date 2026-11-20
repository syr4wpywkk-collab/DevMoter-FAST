import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = file => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
const block = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

// #351: tool output stays out of the way: a one-line summary, with the payload behind a disclosure.
test("#351: OpenCode tool parts render as collapsed <details> with a status summary", async () => {
  const opencode = await source("opencode.ts");
  const addToolPart = block(opencode, "function addToolPart(", "\n  function ");
  assert.match(addToolPart, /document\.createElement\("details"\)/);
  assert.match(addToolPart, /details\.className = `ocx-tool-card \$\{/);
  assert.match(addToolPart, /summary\.textContent = localizedToolStateSummary\(part\)/);
  assert.doesNotMatch(addToolPart, /details\.open = true/, "tool cards start collapsed");
});

test("#351: Codex MCP tool results collapse, with the raw payload in a nested disclosure", async () => {
  const codex = await source("codex.ts");
  const mcp = block(codex, 'detailsEl.className = "cx-mcp-result-details"', "followLatest();");
  assert.match(mcp, /const head = document\.createElement\("summary"\)/);
  assert.match(mcp, /raw\.className = "cx-mcp-raw"/);
  assert.doesNotMatch(mcp, /\.open = true/, "MCP results start collapsed");
});
