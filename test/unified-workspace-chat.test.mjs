import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("unified chat CSS compiles and is loaded by the default workspace UI", async () => {
  const [css, nav, shell, entry] = await Promise.all([
    source("../src/unified-workspace-chat.css"),
    source("../src/unified-workspace-nav.ts"),
    source("../src/app-shell.ts"),
    source("../src/main.ts")
  ]);
  const output = await transform(css, { loader: "css", target: ["chrome120", "safari17"], minify: true });
  assert.ok(output.code.length > 0, "shared chat CSS must parse");
  assert.ok(nav.includes('import "./unified-workspace-chat.css";'));
  assert.ok(shell.includes("shouldUseUnifiedWorkspace(window.location.search)"));
  assert.ok(shell.includes('import("./unified-workspace-nav")'));
  assert.ok(!entry.includes("unified-workspace-chat.css"), "default app must not import opt-in CSS");
  assert.ok(!entry.includes("unified-workspace-nav.css"), "default UI must keep its legacy styles");
  assert.match(css, /body\.dm-task-first-enabled/);
  assert.match(css, /html\[data-devmoter-theme="light"\] body\.dm-task-first-enabled/);
});

test("native Codex, OpenCode and API Chat inputs/messages/permissions remain present", async () => {
  const [css, codex, opencode, api] = await Promise.all([
    source("../src/unified-workspace-chat.css"),
    source("../src/codex.ts"),
    source("../src/opencode.ts"),
    source("../src/api-chat.ts")
  ]);
  const native = [
    { code: codex, root: ".cx-app", form: 'id="cxPromptForm"', input: 'id="cxPromptInput"', send: 'id="cxSend"', transcript: 'id="cxTranscript"', history: 'id="cxSidebar"', permission: 'id="cxApproval"' },
    { code: opencode, root: ".ocx-app", form: 'id="ocxPromptForm"', input: 'id="ocxPromptInput"', send: 'id="ocxSend"', transcript: 'id="ocxTranscript"', history: 'id="ocxSidebar"', permission: 'id="ocxPermission"' },
    { code: api, root: ".api-app", form: 'id="apiForm"', input: 'id="apiPrompt"', send: 'id="apiSend"', transcript: 'id="apiTranscript"', history: 'id="apiSidebar"', permission: 'id="apiSettingsModal"' }
  ];
  for (const surface of native) {
    for (const key of ["form", "input", "send", "transcript", "history", "permission"]) {
      assert.ok(surface.code.includes(surface[key]), "native " + key + " must remain in " + surface.root);
    }
    assert.ok(css.includes(surface.root), "theme must cover " + surface.root);
    assert.ok(css.includes(surface.input.match(/id="([^"]+)"/)[1]), "theme must cover native textarea");
    assert.ok(css.includes(surface.send.match(/id="([^"]+)"/)[1]), "theme must cover native send button");
  }
  assert.match(css, /\.cx-app #cxSend\.stop/);
  assert.match(css, /\.ocx-app #ocxSend\.stop/);
  assert.match(css, /:disabled/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /:focus-within/);
  assert.match(css, /--dw-chat-muted/);
  assert.match(css, /--dw-chat-user-border/);
});

test("opt-in chat presentation keeps native controls interactive", async () => {
  const css = await source("../src/unified-workspace-chat.css");
  const selectors = [
    ".cx-app .cx-approval", ".ocx-app .ocx-dock",
    ".ocx-app .ocx-tool-card", ".api-app .api-picker-row select",
    ".cx-app .cx-transcript", ".ocx-app .ocx-transcript", ".api-app .api-transcript",
    ".cx-app .cx-composer-wrap", ".ocx-app .ocx-composer-wrap",
    ".api-app .api-composer-wrap"
  ];
  for (const selector of selectors) assert.ok(css.includes(selector), "missing native affordance: " + selector);
  assert.ok(!/innerHTML|replaceChildren|fetch\s*\(|addEventListener|dispatchEvent/.test(css));
  assert.ok(!/display\s*:\s*none\b/.test(css), "must not hide original controls");
  assert.ok(!/pointer-events\s*:\s*none\b/.test(css), "must not disable original controls");
  assert.ok(!/position\s*:\s*fixed\b/.test(css), "fixed position remains provider-owned");
  assert.ok(css.includes("@media (max-width: 680px)"));
});
