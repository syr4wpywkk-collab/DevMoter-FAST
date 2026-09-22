import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AcpAdapter, createAgentAdapterRegistry } from "../server/acp-adapter.mjs";

function fakeAcpChild(onMessage) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };

  let buffer = "";
  child.stdin.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      onMessage(JSON.parse(line), message => {
        child.stdout.write(JSON.stringify(message) + "\n");
      });
    }
  });
  return child;
}

test("ACP adapter performs v1 initialize and creates a session over stdio JSON-RPC", async () => {
  const seen = [];
  const child = fakeAcpChild((message, respond) => {
    seen.push(message);
    if (message.method === "initialize") {
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          authMethods: []
        }
      });
    }
    if (message.method === "session/new") {
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "session-1" }
      });
    }
  });

  const adapter = new AcpAdapter({
    command: "fake-acp",
    cwd: "/workspace",
    spawnImpl: () => child
  });

  const init = await adapter.connect();
  assert.equal(init.protocolVersion, 1);
  assert.equal(seen[0].jsonrpc, "2.0");
  assert.equal(seen[0].params.clientCapabilities.terminal, false);

  const session = await adapter.newSession({ cwd: "/workspace", mcpServers: [] });
  assert.equal(session.sessionId, "session-1");
  assert.equal(seen[1].method, "session/new");
  assert.equal(seen[1].params.cwd, "/workspace");

  adapter.close();
});

test("ACP adapter refuses relative session cwd", async () => {
  const adapter = new AcpAdapter({ command: "unused" });
  await assert.rejects(adapter.newSession({ cwd: "relative" }), /absolute/);
});

test("adapter registry keeps native adapters ahead of optional ACP", () => {
  const adapters = createAgentAdapterRegistry({
    adapters: {
      acp: {
        enabled: true,
        command: "agent",
        args: ["--acp"],
        capabilities: ["chat"]
      }
    }
  });

  assert.deepEqual(adapters.map(item => item.id), ["codex", "opencode", "acp"]);
  assert.equal(adapters[0].native, true);
  assert.equal(adapters[2].native, false);
  assert.equal(adapters[2].enabled, true);
});
