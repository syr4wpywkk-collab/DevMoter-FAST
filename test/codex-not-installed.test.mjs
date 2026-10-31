import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as execution from "../src/execution-state.mjs";
import * as pluginMetadata from "../src/codex-plugin-metadata.mjs";
import * as reasoning from "../src/codex-reasoning.mjs";
import * as reconnect from "../src/reconnect-policy.mjs";
import * as markdown from "../src/chat-markdown.mjs";
import * as sendError from "../src/codex-send-error.mjs";
import { loadPureTypeScript } from "./helpers/ts-pure-modules.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { CodexBridge } from "../server/codex-bridge.mjs";
import { assertCliReady, cliLaunchErrorFromSpawn } from "../server/cli-launch.mjs";

const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const modules = new Map(await Promise.all(ts.preProcessFile(source).importedFiles
  .filter(({ fileName }) => fileName.endsWith(".mjs"))
  .map(async ({ fileName }) => [fileName, await import(new URL("../src/" + fileName.slice(2), import.meta.url))])));
modules.set("./codex/presentation", await loadPureTypeScript("codex/presentation.ts"));
modules.set("./codex/icons", await loadPureTypeScript("codex/icons.ts"));
const settle = () => new Promise(resolve => setImmediate(resolve));

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function fakeChild() {
  const child = new PassThrough();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

test("a missing Codex CLI is a 503 launch error with a not_installed code", async () => {
  const error = await assertCliReady("/nonexistent/devmoter-test/codex").catch(caught => caught);
  assert.equal(error.code, "not_installed");
  assert.equal(error.status, 503);
  assert.match(error.message, /見つからない/);
});

test("a spawn ENOENT after the readiness check is reported as not_installed, not a raw spawn error", async () => {
  const child = fakeChild();
  const bridge = new CodexBridge({
    prepareCli: async () => ({ resolvedPath: "/usr/local/bin/codex" }),
    spawnImpl: () => {
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })));
      return child;
    }
  });
  const error = await bridge.start().catch(caught => caught);
  assert.equal(error.code, "not_installed");
  assert.equal(error.status, 503);
  assert.equal(bridge.launchCode, "not_installed");

  assert.equal(cliLaunchErrorFromSpawn("codex", Object.assign(new Error("EACCES"), { code: "EACCES" })).code, "not_executable");
  assert.equal(cliLaunchErrorFromSpawn("codex", Object.assign(new Error("boom"), { code: "EPIPE" })), null);
});

async function freePort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test("server answers Codex RPC with 503 not_installed (not 502) when codex is absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-codex-missing-"));
  const authPassword = "codex-missing-password-123";
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: "http://127.0.0.1:9",
      CODEX_CWD: home,
      CODEX_BIN: join(home, "no-such-codex"),
      DEVMOTER_AUTH_PASSWORD: authPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server not ready: ${output}`)), 8000);
      child.stdout.on("data", chunk => {
        output += chunk;
        if (output.includes("DevMoter FAST:")) { clearTimeout(timer); resolve(); }
      });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`exited ${code}: ${output}`)); });
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const authorization = `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`;

    const rpc = await fetch(`${baseUrl}/api/codex/rpc`, {
      method: "POST",
      headers: { authorization, origin: baseUrl, "content-type": "application/json", "x-pocket-operation-id": "codex-missing-rpc" },
      body: JSON.stringify({ method: "thread/list", params: {} })
    });
    assert.equal(rpc.status, 503);
    const payload = await rpc.json();
    assert.equal(payload.code, "not_installed");
    assert.match(payload.error, /見つからない/);

    const health = await (await fetch(`${baseUrl}/api/health`, { headers: { authorization } })).json();
    assert.equal(health.backends.codex.online, false);
    assert.equal(health.backends.codex.code, "not_installed");
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex UI labels a missing CLI as 未インストール and recovers when it comes online", async t => {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "https://devmoter.example/?surface=codex",
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const requests = [];
  let eventSource;
  let threadReadCount = 0;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.setInterval = () => 1;
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.confirm = () => true;
  window.localStorage.setItem("opencode-pocket-codex-thread", "thread-1");
  window.EventSource = class {
    listeners = new Map();
    constructor() { eventSource = this; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    close() {}
    emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
  };
  window.fetch = async (input, init = {}) => {
    const path = String(input);
    requests.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
    const ok = (result, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => result });
    const okRpc = result => ok({ result });
    if (path === "/api/projects") return ok({ projects: [] });
    if (path !== "/api/codex/rpc") throw new Error(`Unexpected request: ${path}`);
    const { method, params } = JSON.parse(String(init.body));
    if (method === "model/list") return okRpc({ models: [] });
    if (method === "thread/list") return okRpc({ data: [{ id: "thread-1", name: "Test thread" }] });
    if (method === "thread/resume") return okRpc({});
    if (method === "thread/read") {
      if (!params.includeTurns) return okRpc({ thread: { id: "thread-1", status: {}, turns: [] } });
      threadReadCount += 1;
      return okRpc({ thread: {
        status: {},
        turns: threadReadCount <= 2 ? [] : [{
          id: "turn-1",
          status: "failed",
          error: { message: "The requested model is unavailable", codexErrorInfo: { category: "Model" } },
          items: [{ type: "userMessage", content: [{ type: "text", text: "Please do the work" }] }]
        }]
      } });
    }
    if (method === "turn/start") return okRpc({ turn: { id: "turn-1" } });
    return okRpc({});
  };

  const require = name => {
    if (modules.has(name)) return modules.get(name);
    if (name === "./i18n") return { speechRecognitionLanguage: () => "en-US" };
    if (name === "./dev-workflows-ui") return { createDevWorkflowPanel: () => ({ show: async () => {} }) };
    if (name === "./mcp-result") return { isMcpToolItem: () => false, mcpToolSummary: () => ({}), normalizeStructuredMcpResult: value => ({ value, rawText: "", truncated: false }) };
    if (name === "./bounded-transcript") return { enforceTranscriptLimit() {} };
    if (name === "./codex-plugin-metadata.mjs") return pluginMetadata;
    if (name === "./execution-state.mjs") return execution;
    if (name === "./codex-reasoning.mjs") return reasoning;
    if (name === "./reconnect-policy.mjs") return reconnect;
    if (name === "./chat-markdown.mjs") return markdown;
    if (name === "./codex-send-error.mjs") return sendError;
    if (name === "./wake-lock") return { setWakeLockExecutionActive() {} };
    if (name === "./safety-client") return { runPreExecutionGuard: async () => ({ decision: "allow" }), guardMessage: () => "", continueAgentRun: async () => {}, loopMessage: () => "", matchRememberedPermission: async () => ({ matched: false }), recordAgentAction: async () => null, rememberPermission: async () => {}, scanCommand: async () => ({ dangerous: false }) };
    if (name.endsWith(".css")) return {};
    throw new Error(`Unexpected module: ${name}`);
  };
  window.exports = {};
  window.Function("require", "exports", compiled)(require, window.exports);
  const controller = window.exports.mountCodexRemote(document.querySelector("#root"));
  const notice = "codex が見つからないよ。入れ方: npm install -g @openai/codex";
  controller.setOnline(false, notice, "not_installed");
  const status = document.querySelector("#cxSideStatus");
  assert.match(status.textContent, /未インストール/);
  assert.equal(status.classList.contains("missing"), true);
  assert.equal(status.dataset.codexState, "not_installed");
  assert.equal(document.querySelector(".cx-welcome p").textContent, notice);
  assert.equal(document.querySelector("#cxPromptInput").disabled, true);

  controller.setOnline(false);
  assert.match(status.textContent, /Offline/);
  assert.equal(status.classList.contains("missing"), false);

  controller.setOnline(true);
  await settle();
  assert.match(status.textContent, /Online/);
  assert.equal(status.dataset.codexState, "online");
  void requests;
  void eventSource;
  void threadReadCount;
});

test("automation Codex task reports a missing CLI as 503 not_installed instead of 502", async () => {
  const { createAutomationApi } = await import("../server/automation-api.mjs");
  const { EventEmitter } = await import("node:events");
  const missing = await assertCliReady("/nonexistent/devmoter-test/codex").catch(caught => caught);
  const codex = Object.assign(new EventEmitter(), { request: async () => { throw missing; } });
  const responses = [];
  const api = createAutomationApi({
    readProjectRegistry: async () => [{ id: "p1", name: "Demo", path: "/safe/demo", addedAt: 1 }],
    getProjectById: async () => ({ id: "p1", name: "Demo", path: "/safe/demo", addedAt: 1 }),
    normalizeExistingProjectPath: async path => path,
    fetchOpenCodeJson: async () => [],
    codex,
    json: (_res, status, body) => responses.push({ status, body }),
    readJson: async () => ({ project: "p1", agent: "codex", task: "run", backend: "codex" }),
    operationId: () => "op-test",
    claimOperation: () => true,
    publicOrigin: "https://devmoter.example.test",
    taskTimeoutMs: 1000
  });
  await api.handle(
    { method: "POST", headers: {}, socket: {} },
    { writeHead() {}, write() {}, end() {} },
    new URL("https://devmoter.example.test/api/automation/tasks")
  );
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 503);
  assert.equal(responses[0].body.code, "not_installed");
});
