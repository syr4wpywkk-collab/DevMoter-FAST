import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevWorkflowService } from "../server/dev-workflows.mjs";

const masked = "••••••••";
const original = {
  id: "fixture-server",
  name: "Fixture server",
  transport: "stdio",
  scope: "project",
  projectId: "p1",
  command: "node",
  enabled: false,
  env: { FIXTURE_SETTING: "synthetic-private-value", API_TOKEN: "synthetic-token", EMPTY: "" },
};

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "devmoter-mcp-privacy-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = join(home, "project");
  await mkdir(project);
  return createDevWorkflowService({
    homeDir: home,
    configDir: join(home, "config"),
    codex: { request: async () => ({ data: [] }) },
    projectResolver: async id => ({ id, name: id, path: project }),
  });
}

function assertPrivate(server) {
  assert.deepEqual(server.env, {
    FIXTURE_SETTING: masked,
    API_TOKEN: masked,
    EMPTY: "",
  });
  assert.doesNotMatch(JSON.stringify(server), /synthetic-private-value|synthetic-token/);
}

test("MCP management responses keep environment values private consistently", async t => {
  const service = await fixture(t);
  assertPrivate((await service.saveMcpServer(original)).server);
  assertPrivate((await service.getSettings()).mcp.servers[0]);
  assertPrivate((await service.capabilities("p1")).mcp[0]);
  assert.deepEqual((await service.capabilities("p2")).mcp, []);
  const disabled = await service.testMcpServer({ projectId: "p1", serverId: original.id });
  assert.equal(disabled.state, "disabled");
  assertPrivate(disabled.server);
  assertPrivate((await service.setMcpEnabled({ serverId: original.id, enabled: true })).server);
  assertPrivate((await service.setMcpEnabled({ serverId: original.id, enabled: false })).server);
  assert.deepEqual((await service.getSettings({ masked: false })).mcp.servers[0].env, original.env);
});

test("masked settings and per-server edits preserve saved values", async t => {
  const service = await fixture(t);
  await service.saveMcpServer(original);
  const snapshot = await service.getSettings();
  snapshot.review.policy = "block";
  assertPrivate((await service.updateSettings(snapshot)).mcp.servers[0]);
  const server = (await service.getSettings()).mcp.servers[0];
  server.name = "Renamed fixture";
  assertPrivate((await service.saveMcpServer(server)).server);
  let raw = await service.getSettings({ masked: false });
  assert.deepEqual(raw.mcp.servers[0].env, original.env);
  assert.equal(raw.review.policy, "block");
  await service.saveMcpServer({ id: original.id, env: { FIXTURE_SETTING: "replacement" } });
  raw = await service.getSettings({ masked: false });
  assert.equal(raw.mcp.servers[0].env.FIXTURE_SETTING, "replacement");
  assert.equal(raw.mcp.servers[0].env.API_TOKEN, original.env.API_TOKEN);
});

test("a placeholder without a matching stored value cannot be persisted", async t => {
  const service = await fixture(t);
  const invalid = { ...original, env: { NEW_SETTING: masked } };
  await assert.rejects(service.saveMcpServer(invalid), /no saved value/);
  await assert.rejects(service.updateSettings({ mcp: { servers: [invalid] } }), /no saved value/);
  assert.deepEqual((await service.getSettings()).mcp.servers, []);
  await service.saveMcpServer(original);
  await assert.rejects(service.saveMcpServer({ id: original.id, env: { NEW_SETTING: masked } }), /no saved value/);
  const snapshot = await service.getSettings();
  snapshot.mcp.servers[0].env.NEW_SETTING = masked;
  await assert.rejects(service.updateSettings(snapshot), /no saved value/);
  assert.deepEqual((await service.getSettings({ masked: false })).mcp.servers[0].env, original.env);
});
