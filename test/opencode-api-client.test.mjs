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

  const calls1 = [];
  const inputs1 = await createOpenCodeClient({ baseUrl: "http://oc.test", fetchImpl: fixtureFetch(v1, calls1) }).catalogInputs();
  assert.equal(inputs1.generation, "v1");
  assert.equal(inputs1.defaultModel, null);
  assert.ok(!calls1.includes("/api/model/default"));
  for (const path of ["/api/provider", "/api/model", "/api/integration"]) {
    assert.ok(calls1.includes(path) && calls2.includes(path), path);
  }
});

test("pending requests read permissions plus questions (1.x) or forms (2.x)", async () => {
  const form = {
    id: "frm_1", sessionID: "ses_1", title: "Questions",
    fields: [{ key: "q0", type: "string", title: "Pick", description: "Which?", options: [{ value: "A", label: "A" }], custom: true }]
  };
  const calls2 = [];
  const pending2 = await createOpenCodeClient({
    baseUrl: "http://oc.test",
    fetchImpl: fixtureFetch({ ...v2, "/api/session/ses_1/permission": { data: [] }, "/api/session/ses_1/form": { data: [form] } }, calls2)
  }).pendingRequests("ses_1");
  assert.deepEqual(pending2.permissions, []);
  assert.equal(pending2.questions[0].id, "frm_1");
  assert.deepEqual(pending2.questions[0].fields, [{ key: "q0", type: "string" }]);
  assert.ok(!calls2.some(path => path.endsWith("/question")));

  const calls1 = [];
  const pending1 = await createOpenCodeClient({
    baseUrl: "http://oc.test",
    fetchImpl: fixtureFetch({
      ...v1,
      "/api/session/ses_1/permission": { data: [{ id: "per_1", sessionID: "ses_1", action: "bash", resources: ["ls"] }] },
      "/api/session/ses_1/question": { data: [] }
    }, calls1)
  }).pendingRequests("ses_1");
  assert.equal(pending1.permissions[0].id, "per_1");
  assert.deepEqual(pending1.questions, []);
  assert.ok(calls1.includes("/api/session/ses_1/question"));
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
    integrations: v1["/api/integration"]
  });
  assert.equal(catalog.apiVersion, "v1");
  assert.equal(catalog.source, "/api/provider + /api/model + /api/integration");
  assert.deepEqual(catalog.default, {});
  const model = v1["/api/model"].data[0];
  const built = catalog.all.find(provider => provider.id === model.providerID).models[model.id];
  assert.equal(built.modelID, model.id, "1.x models have no separate modelID");
  assert.equal(built.available, true);
  assert.throws(() => buildOpenCodeProviderCatalog({ generation: "v1", providers: v1["/api/provider"], models: "<html>" }), /GET \/api\/model returned no model list/);
  assert.throws(() => buildOpenCodeProviderCatalog({ providers: [], models: [] }), /generation is unknown/);
});
