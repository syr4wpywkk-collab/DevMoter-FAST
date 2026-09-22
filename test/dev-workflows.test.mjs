import test from "node:test";
import assert from "node:assert/strict";
import {
  maskSecrets,
  negotiateAdapter,
  normalizeDevWorkflowSettings,
  structureMcpResult,
  validateExtensionManifest
} from "../server/dev-workflows.mjs";

test("extension manifest fails closed for unknown capabilities and declarations", () => {
  const valid = validateExtensionManifest({
    manifestVersion: 1,
    name: "demo",
    version: "1.0.0",
    capabilities: ["skills", "mcp"],
    declarations: { skills: [], mcp: [] }
  });
  assert.equal(valid.valid, true);

  const unsafe = validateExtensionManifest({
    manifestVersion: 1,
    name: "demo",
    version: "1.0.0",
    capabilities: ["arbitrary-exec"],
    declarations: { arbitraryExec: { command: "sh" } }
  });
  assert.equal(unsafe.valid, false);
  assert.match(unsafe.errors.join("\n"), /unknown|unsafe/i);
});

test("workflow settings normalize trusted commands and scoped MCP servers", () => {
  const settings = normalizeDevWorkflowSettings({
    verification: {
      commands: [{ name: "tests", command: "npm", args: ["test"], timeoutMs: 5000 }]
    },
    mcp: {
      servers: [{
        name: "project tools",
        scope: "project",
        projectId: "p1",
        transport: "stdio",
        command: "npx",
        args: ["server"],
        env: { API_TOKEN: "secret" }
      }]
    }
  });

  assert.equal(settings.verification.commands[0].command, "npm");
  assert.deepEqual(settings.verification.commands[0].args, ["test"]);
  assert.equal(settings.mcp.servers[0].scope, "project");
  assert.equal(settings.mcp.servers[0].projectId, "p1");
});

test("workflow settings reject invalid MCP scope or transport", () => {
  assert.throws(() => normalizeDevWorkflowSettings({
    mcp: { servers: [{ name: "bad", scope: "repo", transport: "stdio", command: "x" }] }
  }), /scope/i);

  assert.throws(() => normalizeDevWorkflowSettings({
    mcp: { servers: [{ name: "bad", scope: "global", transport: "socket", command: "x" }] }
  }), /transport/i);
});

test("secret masking is recursive", () => {
  assert.deepEqual(maskSecrets({
    token: "one",
    nested: {
      API_KEY: "two",
      visible: "yes"
    },
    list: [{ password: "three" }]
  }), {
    token: "••••••••",
    nested: {
      API_KEY: "••••••••",
      visible: "yes"
    },
    list: [{ password: "••••••••" }]
  });
});

test("structured MCP results are bounded and preserve raw fallback", () => {
  const result = structureMcpResult({
    safe: "<script>alert(1)</script>",
    long: "x".repeat(200)
  }, { maxDepth: 4, maxEntries: 20, maxText: 50 });

  assert.equal(result.kind, "structured");
  assert.equal(result.value.safe, "<script>alert(1)</script>");
  assert.equal(result.truncated, true);
  assert.match(result.rawText, /safe/);
});

test("adapter negotiation prefers native priority and reports fallback", () => {
  const adapters = [
    { id: "codex", enabled: true, priority: 100, capabilities: ["chat"] },
    { id: "acp", enabled: true, priority: 50, capabilities: ["chat", "extra"] }
  ];

  assert.deepEqual(
    negotiateAdapter(adapters, "", ["chat"]),
    {
      requested: null,
      selected: "codex",
      fallback: false,
      reason: "best-compatible"
    }
  );

  assert.deepEqual(
    negotiateAdapter(adapters, "missing", ["chat"]),
    {
      requested: "missing",
      selected: "codex",
      fallback: true,
      reason: "best-compatible"
    }
  );
});
