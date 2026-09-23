import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDevWorkflowService,
  devWorkflowInternals,
  extensionPermissionFingerprint,
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


test("project workflow reads reject file and parent-directory symlink escapes", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-dev-workflow-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = join(home, "project");
  const outside = join(home, "outside");
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "rule.md"), "outside\n");

  await symlink(join(outside, "rule.md"), join(project, "AGENTS.md"));
  await assert.rejects(
    () => devWorkflowInternals.readProjectSmall(project, "AGENTS.md", 65536),
    /Symlink|escape/i
  );

  await mkdir(join(project, ".devmoter"), { recursive: true });
  await symlink(outside, join(project, ".devmoter", "skills"));
  await assert.rejects(
    () => devWorkflowInternals.safeProjectEntry(project, join(".devmoter", "skills"), { directory: true }),
    /Symlink|escape/i
  );
});

test("masked MCP secrets survive full settings read-modify-write", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-settings-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configDir = join(home, "config");
  const service = createDevWorkflowService({
    homeDir: home,
    configDir,
    codex: {},
    projectResolver: async () => ({ id: "p1", name: "p1", path: home })
  });

  await service.updateSettings({
    mcp: {
      servers: [{
        id: "secret-server",
        name: "secret",
        scope: "global",
        transport: "stdio",
        command: "node",
        env: { API_TOKEN: "real-secret" }
      }]
    }
  });
  const masked = await service.getSettings();
  assert.equal(masked.mcp.servers[0].env.API_TOKEN, "••••••••");
  masked.review.policy = "block";
  await service.updateSettings(masked);
  const raw = await service.getSettings({ masked: false });
  assert.equal(raw.mcp.servers[0].env.API_TOKEN, "real-secret");
  assert.equal(raw.review.policy, "block");
});


test("extension manifest separates sensitive permissions and fingerprints permission changes", () => {
  const base = {
    manifestVersion: 1,
    name: "browser-tools",
    version: "1.0.0",
    capabilities: ["hooks", "browser"],
    permissions: ["filesystem:read", "browser"]
  };
  const valid = validateExtensionManifest(base);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.manifest.permissions, ["browser", "filesystem:read"]);

  const escalated = { ...base, version: "1.0.1", permissions: [...base.permissions, "network"] };
  assert.notEqual(extensionPermissionFingerprint(base), extensionPermissionFingerprint(escalated));

  const unknown = validateExtensionManifest({ ...base, permissions: ["root-everything"] });
  assert.equal(unknown.valid, false);
  assert.match(unknown.errors.join("\n"), /Unknown permissions/i);
});

test("extension permission escalation requires explicit re-approval", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-extension-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = join(home, "project");
  const configDir = join(home, "config");
  await mkdir(project, { recursive: true });
  const manifestPath = join(project, "devmoter.extension.json");
  await writeFile(manifestPath, JSON.stringify({
    manifestVersion: 1,
    name: "demo",
    version: "1.0.0",
    capabilities: ["hooks"],
    permissions: ["filesystem:read"]
  }));

  const service = createDevWorkflowService({
    homeDir: home,
    configDir,
    codex: { request: async () => ({ data: [] }) },
    projectResolver: async () => ({ id: "p1", name: "p1", path: project })
  });

  let state = await service.capabilities("p1");
  assert.equal(state.extension.approvalRequired, true);
  await service.approveExtension("p1");
  state = await service.capabilities("p1");
  assert.equal(state.extension.approved, true);

  await writeFile(manifestPath, JSON.stringify({
    manifestVersion: 1,
    name: "demo",
    version: "1.0.1",
    capabilities: ["hooks"],
    permissions: ["filesystem:read", "network"]
  }));
  state = await service.capabilities("p1");
  assert.equal(state.extension.approved, false);
  assert.equal(state.extension.approvalRequired, true);
  assert.deepEqual(state.extension.approvedPermissions, ["filesystem:read"]);
});
