import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DevinBridge, parseDevinAuthStatus } from "../server/devin-bridge.mjs";

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

const readyCli = async () => ({ resolvedPath: "fake-devin" });
const loggedInAuth = async () => "Logged in (via Devin).\n\nCredentials:\n  File: /home/test/.local/share/devin/credentials.toml\nUser:\n  Email: secret@example.test\n";

function standardFake(seen, notifications = []) {
  return fakeAcpChild((message, respond) => {
    seen.push(message);
    if (message.method === "initialize") {
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: "affogato", title: "Devin Agent" },
          agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
          authMethods: []
        }
      });
    }
    if (message.method === "session/new") {
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "happy-path words", modes: {}, configOptions: [] }
      });
    }
    if (message.method === "session/prompt") {
      // Emit a session/update notification before the final result,
      // mimicking the real Devin ACP stream.
      respond({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } }
        }
      });
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 2 } }
      });
    }
  });
}

test("parseDevinAuthStatus distinguishes logged in / not logged in / unknown by leading text", () => {
  assert.equal(parseDevinAuthStatus("Logged in (via Devin).\n\nUser:\n  Email: a@b.test\n"), true);
  assert.equal(parseDevinAuthStatus("Not logged in.\n"), false);
  assert.equal(parseDevinAuthStatus("something unexpected"), null);
  assert.equal(parseDevinAuthStatus(""), null);
});

test("Devin bridge reports a missing CLI before spawn", async () => {
  let spawned = false;
  let authCalled = false;
  const bridge = new DevinBridge({
    bin: "fake-devin",
    cwd: "/workspace",
    prepareCli: async () => {
      const error = new Error("devin が見つからないよ。入れ方: curl -fsSL https://cli.devin.ai/install.sh | bash");
      error.code = "not_installed";
      error.status = 503;
      throw error;
    },
    runAuthStatus: async () => { authCalled = true; return "Logged in (via Devin)."; },
    spawnImpl: () => { spawned = true; return fakeAcpChild(() => {}); }
  });
  const health = await bridge.health();
  assert.equal(health.online, false);
  assert.equal(health.ready, false);
  assert.equal(health.code, "not_installed");
  assert.equal(health.loggedIn, false);
  assert.equal(spawned, false, "ACP child must not be spawned when CLI is missing");
  assert.equal(authCalled, false, "auth status must not run when CLI is missing");
  bridge.close();
});

test("Devin bridge performs initialize -> session/new -> session/prompt and re-emits session/update", async () => {
  const seen = [];
  const child = standardFake(seen);
  const bridge = new DevinBridge({
    bin: "fake-devin",
    cwd: "/workspace",
    prepareCli: readyCli,
    runAuthStatus: loggedInAuth,
    spawnImpl: () => child
  });
  const notifications = [];
  bridge.on("notification", event => notifications.push(event));

  const session = await bridge.request("session/new", { cwd: "/workspace", mcpServers: [] });
  assert.equal(session.sessionId, "happy-path words");
  assert.equal(seen[0].method, "initialize");
  assert.equal(seen[0].params.protocolVersion, 1);
  assert.equal(seen[1].method, "session/new");

  const result = await bridge.request("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "Say hi in one word" }]
  });
  assert.equal(result.stopReason, "end_turn");

  // session/update notification from the agent is re-emitted by the bridge
  const update = notifications.find(item => item.method === "session/update");
  assert.ok(update, "bridge should re-emit session/update notifications");
  assert.equal(update.params.update.sessionUpdate, "agent_message_chunk");
  assert.equal(update.params.update.content.text, "Hi");

  bridge.close();
});

test("Devin bridge cancel sends session/cancel as a notification", async () => {
  const seen = [];
  const child = standardFake(seen);
  const bridge = new DevinBridge({
    bin: "fake-devin",
    cwd: "/workspace",
    prepareCli: readyCli,
    runAuthStatus: loggedInAuth,
    spawnImpl: () => child
  });

  const session = await bridge.request("session/new", { cwd: "/workspace", mcpServers: [] });
  seen.length = 0;
  await bridge.cancel(session.sessionId);

  const cancelMsg = seen.find(item => item.method === "session/cancel");
  assert.ok(cancelMsg, "cancel should send session/cancel");
  assert.equal(cancelMsg.params.sessionId, session.sessionId);
  assert.equal("id" in cancelMsg, false, "session/cancel is a notification, not a request");

  bridge.close();
});

test("Devin bridge health uses auth status text: Logged in", async () => {
  const seen = [];
  const child = standardFake(seen);
  const bridge = new DevinBridge({
    bin: "fake-devin",
    cwd: "/workspace",
    prepareCli: readyCli,
    runAuthStatus: loggedInAuth,
    spawnImpl: () => child
  });
  const health = await bridge.health();
  assert.equal(health.online, true);
  assert.equal(health.ready, true);
  assert.equal(health.loggedIn, true);
  assert.equal(health.bin, "fake-devin");
  assert.ok(health.serverInfo, "health should include ACP serverInfo on success");
  assert.equal(health.serverInfo.agentInfo.name, "affogato");
  // Auth output (email etc.) must never leak into health
  assert.equal(JSON.stringify(health).includes("secret@example.test"), false);
  assert.equal(JSON.stringify(health).includes("credentials.toml"), false);
  bridge.close();
});

test("Devin bridge health uses auth status text: Not logged in", async () => {
  let spawned = false;
  const bridge = new DevinBridge({
    bin: "fake-devin",
    cwd: "/workspace",
    prepareCli: readyCli,
    runAuthStatus: async () => "Not logged in.\nRun `devin auth login` to authenticate.\n",
    spawnImpl: () => { spawned = true; return fakeAcpChild(() => {}); }
  });
  const health = await bridge.health();
  assert.equal(health.online, false);
  assert.equal(health.ready, false);
  assert.equal(health.loggedIn, false);
  assert.equal(health.code, "not_logged_in");
  assert.equal(spawned, false, "ACP child must not be spawned when not logged in");
  bridge.close();
});

function clientRequestFake(captured, agentRequest) {
  let pendingPrompt = null;
  return fakeAcpChild((message, respond) => {
    // Response from adapter (client) to the agent's client-request:
    // it has an id matching the agent request and no method.
    if (!message.method && message.id === "agent-req-1") {
      captured.push(message);
      if (pendingPrompt) {
        respond({
          jsonrpc: "2.0",
          id: pendingPrompt.id,
          result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 2 } }
        });
        pendingPrompt = null;
      }
      return;
    }
    if (message.method === "initialize") {
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: "affogato", title: "Devin Agent" },
          agentCapabilities: { loadSession: true },
          authMethods: []
        }
      });
      return;
    }
    if (message.method === "session/new") {
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "perm-session", modes: {}, configOptions: [] }
      });
      return;
    }
    if (message.method === "session/prompt") {
      pendingPrompt = message;
      // Agent sends a client-request to the client before finishing the turn.
      respond({
        jsonrpc: "2.0",
        id: "agent-req-1",
        method: agentRequest.method,
        params: agentRequest.params
      });
    }
  });
}

test("Devin bridge auto-approves session/request_permission with allow_once option", async () => {
  const captured = [];
  const child = clientRequestFake(captured, {
    method: "session/request_permission",
    params: {
      sessionId: "perm-session",
      toolCall: { toolCallId: "tool-1", title: "Run sleep 3", kind: "execute" },
      options: [
        { optionId: "allow-always-opt", name: "Allow always", kind: "allow_always" },
        { optionId: "allow-once-opt", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-opt", name: "Reject", kind: "reject_once" }
      ]
    }
  });
  const bridge = new DevinBridge({
    bin: "fake-devin",
    cwd: "/workspace",
    prepareCli: readyCli,
    runAuthStatus: loggedInAuth,
    spawnImpl: () => child
  });

  const session = await bridge.request("session/new", { cwd: "/workspace", mcpServers: [] });
  const result = await bridge.request("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "run sleep 3" }]
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(captured.length, 1, "adapter should respond to the agent's permission request");
  assert.equal(captured[0].error, undefined);
  assert.deepEqual(captured[0].result, { outcome: { outcome: "selected", optionId: "allow-once-opt" } });

  bridge.close();
});

test("Devin bridge leaves non-permission client requests to -32601 rejection", async () => {
  const captured = [];
  const child = clientRequestFake(captured, {
    method: "fs/read_text_file",
    params: { sessionId: "perm-session", path: "/workspace/secret.txt" }
  });
  const bridge = new DevinBridge({
    bin: "fake-devin",
    cwd: "/workspace",
    prepareCli: readyCli,
    runAuthStatus: loggedInAuth,
    spawnImpl: () => child
  });

  const session = await bridge.request("session/new", { cwd: "/workspace", mcpServers: [] });
  const result = await bridge.request("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "read a file" }]
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(captured.length, 1, "adapter should respond to the agent's client request");
  assert.equal(captured[0].result, undefined);
  assert.ok(captured[0].error, "non-permission request should be rejected with an error");
  assert.equal(captured[0].error.code, -32601);

  bridge.close();
});
