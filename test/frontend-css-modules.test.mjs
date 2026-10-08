import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssRoot = new URL("../src/", import.meta.url);
const MODULES = [
  "styles/base.css",
  "styles/workspace.css",
  "styles/tools.css",
  "styles/chat-extras.css"
];

test("the stylesheet entry loads each functional module once and in cascade order", async () => {
  const entry = await readFile(new URL("style.css", cssRoot), "utf8");
  const imports = [...entry.matchAll(/^@import "\.\/(styles\/[^"]+\.css)";$/gm)].map(match => match[1]);
  assert.deepEqual(imports, MODULES);
  assert.equal(entry.trim().split("\n").length, MODULES.length, "entry must not silently add overriding rules");
});

test("split CSS retains the previous section boundaries and major UI selectors", async () => {
  const [base, workspace, tools, chat] = await Promise.all(
    MODULES.map(path => readFile(new URL(path, cssRoot), "utf8"))
  );
  assert.match(base, /^:root\s*\{/);
  assert.match(workspace, /^\/\* Projects \+ Markdown workspace \*\//);
  assert.match(tools, /^\/\* Issues #41-#50: session controls \+ read-only project Git\/diff tools \*\//);
  assert.match(chat, /^\/\* ---------- Multi-API chat/);
  assert.match(base, /\.transcript\s*\{/);
  assert.match(workspace, /\.cx-project-actions/);
  assert.match(tools, /\.ocx-session-toolbar/);
  assert.match(chat, /\.api-app\s*\{/);
  assert.ok([base, workspace, tools, chat].every(part => part.endsWith("\n")), "preserve CSS segment line boundaries");
});
