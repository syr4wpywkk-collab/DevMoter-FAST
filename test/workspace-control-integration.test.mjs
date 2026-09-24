import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("workspace control uses its own authenticated API namespace", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /handleWorkspaceControlRequest/);
  assert.match(source, /\/api\/workspace-control/);
  assert.match(source, /authenticateDevice: request => systemFeatures\.authenticate\(request\)/);
  assert.match(source, /if \(!basicAuthenticated && !ownerSession\)/);

  const auth = source.indexOf("if (!basicAuthenticated && !ownerSession)");
  const route = source.indexOf('url.pathname === "/api/workspace-control"');
  assert.ok(auth >= 0 && route > auth);
});

test("workspace control handler fails closed without an active trusted device", async () => {
  const source = await readFile(new URL("../server/workspace-control.mjs", import.meta.url), "utf8");
  const route = source.indexOf("export async function handleWorkspaceControlRequest");
  const body = source.slice(route);
  assert.match(body, /authenticateDevice\(req\)/);
  assert.match(body, /if \(!device\?\.id\)/);
  assert.match(body, /Trusted device required/);
});

test("Codex canonical events are persisted once at the global bridge, not per SSE client", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const globalListener = source.indexOf('codex.on("notification"');
  const firstAppend = source.indexOf("workspaceControl.events.append", globalListener);
  const sse = source.indexOf("async function codexEvents");
  assert.ok(globalListener >= 0 && firstAppend > globalListener && firstAppend < sse);

  const sseEnd = source.indexOf("async function devWorkflowAction", sse);
  const sseBody = source.slice(sse, sseEnd);
  assert.doesNotMatch(sseBody, /workspaceControl\.events\.append/);
});

test("workspace UI uses actual OpenCode active session key and skips live Codex Markdown", async () => {
  const [ui, codex] = await Promise.all([
    readFile(new URL("../src/workspace-control.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8")
  ]);
  assert.match(ui, /opencode-pocket-opencode-session/);
  assert.doesNotMatch(ui, /opencode-pocket-session/);
  assert.match(ui, /\.cx-message-row\.assistant:not\(\.live\)/);
  assert.match(codex, /classList\.add\("live"\)/);
  assert.match(codex, /classList\.remove\("live"\)/);
});
