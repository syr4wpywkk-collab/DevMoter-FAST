import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createOpenCodeClient } from "../server/opencode-api.mjs";
import { buildOpenCodeProviderCatalog } from "../src/opencode-provider-catalog.mjs";

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/opencode/opencode-${name}.json`, import.meta.url), "utf8"));
const v2 = await fixture("v2.0.9");
const v1 = await fixture("v1.19.5");

const HTML = "<!doctype html><html><head></head><body>OpenCode</body></html>";

// Serves a captured fixture the way the real server does: JSON routes as
// application/json; anything else falls through to the web UI as text/html.
function fixtureFetch(routes, calls = []) {
  return async url => {
    const { pathname, search } = new URL(url);
    calls.push(pathname + search);
    const value = routes[pathname];
    if (value === undefined || typeof value === "string") {
      return new Response(HTML, { status: 200, headers: { "content-type": "text/html;charset=UTF-8" } });
    }
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("detects OpenCode 2.x from GET /api/info and 1.x from GET /global/health", async () => {
  const two = createOpenCodeClient({ baseUrl: "http://oc.test", fetchImpl: fixtureFetch(v2) });
  assert.deepEqual(await two.info(), { generation: "v2", version: "2.0.9", source: "/api/info" });

  const one = createOpenCodeClient({ baseUrl: "http://oc.test", fetchImpl: fixtureFetch(v1) });
  assert.deepEqual(await one.info(), { generation: "v1", version: "1.19.5", source: "/global/health" });
});

test("detection fails clearly when no version endpoint answers", async () => {
  const client = createOpenCodeClient({ baseUrl: "http://oc.test", fetchImpl: fixtureFetch({}) });
  await assert.rejects(client.info(), /Could not detect the OpenCode API version \(\/api\/info: .*instead of JSON.*; \/global\/health: /);
  const mismatched = createOpenCodeClient({ baseUrl: "http://oc.test", fetchImpl: fixtureFetch({ "/api/info": { version: "1.19.5" } }) });
  await assert.rejects(mismatched.info(), /reported 1\.19\.5, which is not a v2 server/);
});

test("generation is cached, expires, and is re-detected after OpenCode goes offline", async () => {
  let clock = 0;
  let routes = v2;
  let offline = false;
  const calls = [];
  const client = createOpenCodeClient({
    baseUrl: "http://oc.test",
    now: () => clock,
    infoTtlMs: 1000,
    fetchImpl: async (url, init) => {
      if (offline) throw new TypeError("fetch failed");
      return fixtureFetch(routes, calls)(url, init);
    }
  });
  assert.equal((await client.info()).generation, "v2");
  const probes = calls.length;
  await client.info();
  assert.equal(calls.length, probes, "cached within TTL");

  // OpenCode restarts as 1.19.5: a connectivity failure drops the cache.
  offline = true;
  await assert.rejects(client.fetchJson("/api/session"), /fetch failed/);
  offline = false;
  routes = v1;
  assert.equal((await client.info()).generation, "v1");

  clock += 1001;
  routes = v2;
  assert.equal((await client.info()).generation, "v2", "TTL expiry re-detects");
});

test("fetchJson rejects the 2.x web-UI fallthrough instead of parsing HTML", async () => {
  const client = createOpenCodeClient({ baseUrl: "http://oc.test", fetchImpl: fixtureFetch(v2) });
  await assert.rejects(
    client.fetchJson("/provider"),
    error => {
      assert.match(error.message, /OpenCode answered \/provider with text\/html;charset=UTF-8 instead of JSON \(HTTP 200\)/);
      assert.match(error.message, /does not exist on the running OpenCode version/);
      assert.equal(error.status, 200);
      return true;
    }
  );
});

test("catalog inputs use the shared /api routes and /api/model/default only on 2.x", async () => {
  const calls2 = [];
  const inputs2 = await createOpenCodeClient({ baseUrl: "http://oc.test", fetchImpl: fixtureFetch(v2, calls2) }).catalogInputs();
  assert.equal(inputs2.generation, "v2");
  assert.ok(calls2.includes("/api/model/default"));
  assert.ok(!calls2.includes("/provider"));

  assert.equal(inputs2.runnerCatalog, null);

  const calls1 = [];
  const inputs1 = await createOpenCodeClient({ baseUrl: "http://oc.test", fetchImpl: fixtureFetch(v1, calls1) }).catalogInputs();
  assert.equal(inputs1.generation, "v1");
  assert.equal(inputs1.defaultModel, null);
  assert.ok(!calls1.includes("/api/model/default"));
  // 1.x prompts run on the classic runner, whose own catalog says which models run.
  assert.ok(calls1.includes("/provider"));
  assert.deepEqual(inputs1.runnerCatalog.connected, ["opencode", "opencode-go"]);
  for (const path of ["/api/provider", "/api/model", "/api/integration"]) {
    assert.ok(calls1.includes(path) && calls2.includes(path), path);
  }
});

test("pending requests: classic /permission + /question (1.x) or session permissions + forms (2.x), one shape", async () => {
  const form = {
    id: "frm_1", sessionID: "ses_1", title: "Questions",
    fields: [{ key: "q0", type: "string", title: "Pick", description: "Which?", options: [{ value: "A", label: "A" }], custom: true }]
  };
  const calls2 = [];
  const pending2 = await createOpenCodeClient({
    baseUrl: "http://oc.test",
    fetchImpl: fixtureFetch({
      ...v2,
      "/api/session/ses_1/permission": { data: [{ id: "per_2", sessionID: "ses_1", action: "shell", resources: ["ls"], save: ["ls *"], source: { type: "tool", messageID: "msg_1", id: "call_1" } }] },
      "/api/session/ses_1/form": { data: [form] }
    }, calls2)
  }).pendingRequests("ses_1");
  assert.deepEqual(pending2.permissions, [{
    id: "per_2", sessionID: "ses_1", action: "shell", resources: ["ls"], save: ["ls *"],
    metadata: { command: "ls" }, tool: { messageID: "msg_1", callID: "call_1" }
  }]);
  assert.deepEqual(pending2.questions, [{
    id: "frm_1", sessionID: "ses_1",
    questions: [{ header: "Pick", question: "Which?", options: [{ label: "A" }], multiple: false, custom: true }]
  }]);
  assert.ok(!calls2.some(path => path.endsWith("/question")));

  // Captured from 1.19.5 GET /permission and GET /question (all sessions).
  const calls1 = [];
  const pending1 = await createOpenCodeClient({
    baseUrl: "http://oc.test",
    fetchImpl: fixtureFetch({
      ...v1,
      "/permission": [
        { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["ls"], metadata: { command: "ls" }, always: ["ls *"], tool: { messageID: "msg_1", callID: "call_1" } },
        { id: "per_9", sessionID: "ses_other", permission: "edit", patterns: ["a.txt"], metadata: {}, always: [] }
      ],
      "/question": [{ id: "que_1", sessionID: "ses_1", questions: [{ question: "Which?", header: "Pick", options: [{ label: "A" }] }] }]
    }, calls1)
  }).pendingRequests("ses_1");
  assert.deepEqual(pending1.permissions, [{
    id: "per_1", sessionID: "ses_1", action: "bash", resources: ["ls"], save: ["ls *"],
    metadata: { command: "ls" }, tool: { messageID: "msg_1", callID: "call_1" }
  }]);
  assert.deepEqual(pending1.questions, pending2.questions.map(question => ({ ...question, id: "que_1" })));
  assert.ok(calls1.includes("/permission") && calls1.includes("/question"));
  assert.ok(!calls1.some(path => path.startsWith("/api/session/")), "1.x never reads the new-runner request lists");
});

test("provider catalog builds from captured 2.0.9 responses", () => {
  const catalog = buildOpenCodeProviderCatalog({
    generation: "v2",
    version: "2.0.9",
    providers: v2["/api/provider"],
    models: v2["/api/model"],
    integrations: v2["/api/integration"],
    defaultModel: v2["/api/model/default"],
    directory: "/proj"
  });
  assert.equal(catalog.apiVersion, "v2");
  assert.equal(catalog.opencodeVersion, "2.0.9");
  assert.deepEqual(catalog.connected.sort(), ["opencode", "opencode-go"]);
  assert.equal(catalog.default["opencode-go"], "iceman-contributor-free");
  const go = catalog.all.find(provider => provider.id === "opencode-go");
  assert.equal(go.name, "OpenCode Go");
  assert.deepEqual(go.env, ["OPENCODE_API_KEY"]);
  const free = go.models["iceman-contributor-free"];
  assert.equal(free.free, true);
  assert.equal(free.available, true);
  assert.deepEqual(free.requiresKey, []);

  // Tiered pricing: the base tier (no `tier` qualifier) is the model's price.
  const tiered = v2["/api/model"].data.find(model => Array.isArray(model.cost) && model.cost.length > 1);
  const built = catalog.all.find(provider => provider.id === tiered.providerID).models[tiered.id];
  const base = tiered.cost.find(tier => tier.tier == null);
  assert.equal(built.cost.input, base.input);
  assert.equal(built.cost.output, base.output);
  assert.equal(built.cost.cache_read, base.cache.read);

  const variants = v2["/api/model"].data.find(model => model.variants?.length);
  assert.deepEqual(
    catalog.all.find(provider => provider.id === variants.providerID).models[variants.id].variants.map(variant => variant.id),
    variants.variants.map(variant => variant.id)
  );
});

test("2.x catalog still lists models when /api/provider is empty", () => {
  const catalog = buildOpenCodeProviderCatalog({
    generation: "v2",
    providers: { data: [] },
    models: v2["/api/model"],
    integrations: v2["/api/integration"],
    defaultModel: { data: null }
  });
  assert.deepEqual(catalog.connected.sort(), ["opencode", "opencode-go"]);
  assert.equal(catalog.all.find(provider => provider.id === "opencode").name, "OpenCode", "integration name used");
  assert.deepEqual(catalog.default, {});
});

test("provider catalog builds from captured 1.19.5 responses", () => {
  const catalog = buildOpenCodeProviderCatalog({
    generation: "v1",
    version: "1.19.5",
    providers: v1["/api/provider"],
    models: v1["/api/model"],
    integrations: v1["/api/integration"],
    runnerCatalog: v1["/provider"]
  });
  assert.equal(catalog.apiVersion, "v1");
  assert.equal(catalog.source, "/api/provider + /api/model + /api/integration + /provider");
  // Native-API models (iceman, flint) run on the classic runner and stay selectable.
  const opencode = catalog.all.find(provider => provider.id === "opencode").models;
  assert.equal(opencode["flint-40b-free"].enabled, true);
  assert.equal(catalog.all.find(provider => provider.id === "opencode-go").models["iceman-contributor-free"].enabled, true);
  // The deprecated model the runner no longer resolves is listed but not selectable.
  assert.equal(opencode["gemini-3-pro"].enabled, false);
  assert.equal(opencode["gemini-3-pro"].deprecated, true);
  assert.ok(!catalog.all.some(provider => provider.id === "anthropic"), "unconnected runner providers are not added");
  assert.deepEqual(catalog.default, {});
  const model = v1["/api/model"].data[0];
  const built = catalog.all.find(provider => provider.id === model.providerID).models[model.id];
  assert.equal(built.modelID, model.id, "1.x models have no separate modelID");
  assert.equal(built.available, true);
  assert.throws(() => buildOpenCodeProviderCatalog({ generation: "v1", providers: v1["/api/provider"], models: "<html>", runnerCatalog: v1["/provider"] }), /GET \/api\/model returned no model list/);
  assert.throws(() => buildOpenCodeProviderCatalog({ providers: [], models: [] }), /generation is unknown/);
});

// Records method/path/body and answers from a route table (method + path).
function recordingFetch(routes, calls) {
  return async (url, init = {}) => {
    const { pathname } = new URL(url);
    const method = init.method || "GET";
    calls.push({ method, path: pathname, body: init.body ? JSON.parse(init.body) : undefined });
    const key = method + " " + pathname;
    const value = typeof routes[key] === "function" ? routes[key]() : routes[key];
    if (value === undefined) return new Response(HTML, { status: 200, headers: { "content-type": "text/html" } });
    if (value === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("1.x session operations go to the classic runner; the session supplies an unnamed model", async () => {
  const calls = [];
  let busy = true;
  const client = createOpenCodeClient({
    baseUrl: "http://oc.test",
    fetchImpl: recordingFetch({
      "GET /global/health": v1["/global/health"],
      "GET /api/session/ses_1": { data: { id: "ses_1", agent: "build", model: { id: "deepseek-v4.1-flash-free", providerID: "opencode" } } },
      "POST /session/ses_1/prompt_async": null,
      "GET /session/status": () => (busy ? { ses_1: { type: "busy" } } : {}),
      "GET /session/ses_1/message": [
        { info: { id: "msg_u", role: "user", time: { created: 20 } }, parts: [{ type: "text", text: "hi" }] },
        { info: { id: "msg_a", role: "assistant", time: { created: 21, completed: 22 }, modelID: "deepseek-v4.1-flash-free", providerID: "opencode" }, parts: [{ type: "text", text: "answer" }] }
      ],
      "GET /api/session/ses_1/context": { data: [{ id: "msg_old", type: "user", text: "older", time: { created: 5 } }] },
      "POST /session/ses_1/abort": true
    }, calls)
  });
  await client.prompt("ses_1", { text: "hi" });
  assert.deepEqual(calls.find(call => call.path === "/session/ses_1/prompt_async").body, {
    parts: [{ type: "text", text: "hi" }],
    model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" },
    agent: "build"
  });

  assert.deepEqual(await client.active(), { ses_1: { type: "running" } });
  const running = await client.context("ses_1");
  assert.deepEqual(running.map(item => item.id), ["msg_old", "msg_u", "msg_a"], "no idle marker while busy");

  const waiting = client.waitForIdle("ses_1", { pollMs: 5 });
  setTimeout(() => { busy = false; }, 20);
  await waiting;
  const done = await client.context("ses_1");
  assert.deepEqual(done.at(-1), { id: "msg_a:idle", type: "idle", time: { created: 22 }, outcome: "succeeded" });

  await client.interrupt("ses_1");
  assert.ok(calls.some(call => call.method === "POST" && call.path === "/session/ses_1/abort"));
  assert.ok(!calls.some(call => call.path === "/api/session/ses_1/prompt" || call.path === "/api/session/ses_1/interrupt"));
});

test("2.x session operations use /api/session; a named model/agent skips the session lookup when unchanged", async () => {
  const calls = [];
  const client = createOpenCodeClient({
    baseUrl: "http://oc.test",
    fetchImpl: recordingFetch({
      "GET /api/info": v2["/api/info"],
      "GET /api/session/ses_2": { data: { id: "ses_2", agent: "build", model: { id: "mock-1", providerID: "mock" } } },
      "POST /api/session/ses_2/prompt": { data: { id: "msg_u", type: "user" } },
      "GET /api/session/active": { data: {} },
      "GET /api/session/ses_2/context": { data: [{ id: "msg_a", type: "assistant", content: [{ type: "text", text: "two" }] }] },
      "POST /api/session/ses_2/interrupt": null,
      "POST /api/session": { data: { id: "ses_new" } }
    }, calls)
  });
  await client.prompt("ses_2", { text: "hi", agent: "build", model: { providerID: "mock", modelID: "mock-1" } });
  assert.deepEqual(calls.filter(call => call.method === "POST").map(call => [call.path, call.body]), [["/api/session/ses_2/prompt", { text: "hi" }]]);
  assert.deepEqual(await client.active(), {});
  assert.deepEqual(await client.context("ses_2"), [{ id: "msg_a", type: "assistant", content: [{ type: "text", text: "two" }] }]);
  await client.interrupt("ses_2");
  assert.ok(calls.some(call => call.path === "/api/session/ses_2/interrupt"));
  assert.deepEqual(await client.createSession({ agent: "build" }), { id: "ses_new" });
});

test("fetchJson rejects cross-origin, dot-segment, and encoded traversal paths and sets redirect: error", async () => {
  const seen = [];
  const client = createOpenCodeClient({
    baseUrl: "http://oc.test/subpath",
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), redirect: init.redirect });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  for (const unsafe of [
    "//attacker.example/api/info",
    "http://attacker.example/api/info",
    "https://attacker.example/api/info",
    "/api/../admin",
    "/api/%2e%2e/admin",
    "/api/%252e%252e/admin",
    "/api/session/%2f/context",
    "/api\\evil",
    "/api/info\u0000"
  ]) {
    await assert.rejects(() => client.fetchJson(unsafe), /Invalid OpenCode request path/, unsafe);
  }
  assert.equal(seen.length, 0);

  await client.fetchJson("/api/info");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://oc.test/subpath/api/info");
  assert.equal(seen[0].redirect, "error");
});
