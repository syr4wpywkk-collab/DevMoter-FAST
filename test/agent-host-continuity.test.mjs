import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("Agent Console uses the host runtime instead of browser-owned SubagentRuntime", async () => {
  const consoleSource = await source("src/agent-console.ts");
  assert.match(consoleSource, /HostAgentRuntime/);
  assert.match(consoleSource, /new HostAgentRuntime\(\)/);
  assert.doesNotMatch(consoleSource, /new SubagentRuntime\(/);
  assert.doesNotMatch(consoleSource, /createCodexSubagentAdapter\(\)/);
});

test("host agent client reconstructs state on load and mobile lifecycle resume", async () => {
  const client = await source("src/host-agent-runtime.ts");
  assert.match(client, /\/api\/agent-runs/);
  assert.match(client, /\/api\/agent-fleets/);
  assert.match(client, /new EventSource\("\/api\/agent-runs\/events"\)/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /pageshow/);
  assert.match(client, /window\.addEventListener\("online"/);
  assert.match(client, /x-pocket-operation-id/);
});

test("agent run routes remain behind normal auth and passkey gates", async () => {
  const server = await source("server.mjs");
  const gate = server.indexOf("PASSKEY_REQUIRED &&");
  const route = server.indexOf('url.pathname.startsWith("/api/agent-runs")');
  assert.ok(gate >= 0);
  assert.ok(route > gate);
  assert.match(server, /authenticateDevice: req => systemFeatures\.authenticate\(req\)/);
});

test("host-owned agent state is persisted outside browser storage", async () => {
  const [server, service] = await Promise.all([
    source("server.mjs"),
    source("server/agent-run-service.mjs")
  ]);
  assert.match(server, /agent-runs\.json/);
  assert.match(service, /atomicWriteJson/);
  assert.match(service, /normalizeCapabilityPolicy/);
  assert.match(service, /runtime\.runFleet/);
  assert.match(service, /runtime\.respondApproval/);
});
