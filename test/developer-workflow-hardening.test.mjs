import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  extensionPermissionFingerprint,
  structureMcpResult,
  validateExtensionManifest
} from "../server/dev-workflows.mjs";
import { AcpAdapter } from "../server/acp-adapter.mjs";
import { loadPureTypeScript } from "./helpers/ts-pure-modules.mjs";

test("extension manifests reject undeclared, malformed, and unknown entry points", () => {
  const base = {
    manifestVersion: 1,
    name: "review-tools",
    version: "1.0.0",
    capabilities: ["skills"],
    permissions: ["filesystem:read"],
    declarations: { skills: [] }
  };
  assert.equal(validateExtensionManifest(base).valid, true);

  for (const invalid of [
    { ...base, declarations: { hooks: [] } },
    { ...base, declarations: { skills: { hidden: "command" } } },
    { ...base, postinstall: "sh script.sh" },
    { ...base, capabilities: "skills" },
    { ...base, declarations: null }
  ]) {
    const result = validateExtensionManifest(invalid);
    assert.equal(result.valid, false, JSON.stringify(invalid));
    assert.ok(result.errors.length > 0);
  }
});

test("extension changes require approval even if permission labels remain unchanged", () => {
  const manifest = {
    manifestVersion: 1,
    name: "review-tools",
    version: "1.0.0",
    capabilities: ["hooks"],
    permissions: ["filesystem:read"],
    declarations: { hooks: [{ name: "review", description: "read only" }] }
  };
  const initial = extensionPermissionFingerprint(manifest);
  assert.notEqual(initial, extensionPermissionFingerprint({
    ...manifest, declarations: { hooks: [{ name: "review", description: "changed behavior" }] }
  }));
  assert.notEqual(initial, extensionPermissionFingerprint({ ...manifest, version: "1.0.1" }));
});

test("MCP results preserve prototype-like keys without inheriting payload fields", async () => {
  const payload = JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"key":"value"},"safe":1}');
  const backend = structureMcpResult(payload);
  const { normalizeStructuredMcpResult } = await loadPureTypeScript("mcp-result.ts");
  const frontend = normalizeStructuredMcpResult(payload);

  for (const output of [backend, frontend]) {
    assert.equal(Object.getPrototypeOf(output.value), null);
    assert.equal(Object.hasOwn(output.value, "__proto__"), true);
    assert.deepEqual(output.value.__proto__.isAdmin, true);
    assert.equal(output.value.safe, 1);
    assert.match(output.rawText, /__proto__/);
  }
  assert.equal(({}).isAdmin, undefined);
});

test("MCP results remain inspectable when providers return cyclic data", async () => {
  const input = { value: "ok" };
  input.self = input;
  const backend = structureMcpResult(input);
  const { normalizeStructuredMcpResult } = await loadPureTypeScript("mcp-result.ts");
  const frontend = normalizeStructuredMcpResult(input);

  for (const output of [backend, frontend]) {
    assert.equal(output.truncated, true);
    assert.match(output.rawText, /could not be serialized/);
    assert.equal(output.value.value, "ok");
  }
});

function fakeAcpAgent(onRequest) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  let input = "";
  child.stdin.on("data", chunk => {
    input += chunk.toString("utf8");
    while (input.includes("\n")) {
      const end = input.indexOf("\n");
      const line = input.slice(0, end);
      input = input.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      onRequest(message, response => child.stdout.write(JSON.stringify(response) + "\n"));
    }
  });
  return child;
}

test("concurrent ACP connect calls share one process and handshake", async () => {
  let launches = 0;
  const agent = new AcpAdapter({
    command: "fake",
    spawnImpl: () => {
      launches++;
      return fakeAcpAgent((message, reply) => reply({
        jsonrpc: "2.0", id: message.id,
        result: { protocolVersion: 1, agentCapabilities: {} }
      }));
    }
  });
  const [a, b] = await Promise.all([agent.connect(), agent.connect()]);
  assert.equal(launches, 1);
  assert.equal(a.protocolVersion, 1);
  assert.equal(b.protocolVersion, 1);
  agent.close();
});

test("ACP refuses unsupported protocol versions before announcing readiness", async () => {
  const child = fakeAcpAgent((message, reply) => reply({
    jsonrpc: "2.0", id: message.id,
    result: { protocolVersion: 2, agentCapabilities: {} }
  }));
  const agent = new AcpAdapter({ command: "fake", spawnImpl: () => child });
  let ready = false;
  agent.on("ready", () => { ready = true; });
  await assert.rejects(agent.connect(), /Unsupported ACP protocol version/);
  assert.equal(ready, false);
  assert.equal(child.killed, true);
});
