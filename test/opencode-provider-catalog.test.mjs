import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildOpenCodeProviderCatalog, filterOpenCodePickerModels, normalizeOpenCodeProviderCatalog, openCodePickerWindow } from "../src/opencode-provider-catalog.mjs";

test("OpenCode provider catalog normalizes canonical provider metadata", () => {
  const payload = {
    all: [{ id: "provider-1", name: "Provider", models: { model: { name: "Model" } } }],
    default: { "provider-1": "model" },
    connected: ["provider-1"]
  };
  assert.deepEqual(normalizeOpenCodeProviderCatalog(payload), {
    providers: payload.all,
    defaults: payload.default,
    connected: payload.connected
  });
});

test("OpenCode rejects malformed or duplicate provider catalogs", () => {
  for (const payload of [
    {},
    { all: "provider" },
    { all: [null] },
    { all: [{ id: "same" }, { id: "same" }] },
    { all: [{ id: "provider", models: "invalid" }] },
    { all: [], default: [] },
    { all: [], connected: [1] }
  ]) {
    assert.throws(() => normalizeOpenCodeProviderCatalog(payload), /invalid provider catalog/);
  }
});

test("provider catalog comes from /api/provider + /api/model and keeps picker semantics", () => {
  const catalog = buildOpenCodeProviderCatalog({
    generation: "v2",
    version: "2.0.9",
    providers: { data: [{ id: "opencode", name: "OpenCode" }] },
    models: {
      data: [
        { id: "free", providerID: "opencode", name: "Free", cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true },
        { id: "paid", providerID: "opencode", name: "Paid", cost: [{ input: 2, output: 8 }, { tier: { type: "context", size: 1 }, input: 4, output: 16 }] },
        { id: "old", providerID: "opencode", name: "Old", cost: [{ input: 0, output: 0 }], status: "deprecated" }
      ]
    },
    integrations: { data: [] },
    defaultModel: { data: { id: "free", providerID: "opencode" } }
  });

  assert.equal(catalog.apiVersion, "v2");
  assert.deepEqual(catalog.connected, ["opencode"]);
  assert.deepEqual(catalog.default, { opencode: "free" });
  assert.equal(catalog.all[0].models.free.free, true);
  assert.equal(catalog.all[0].models.free.available, true);
  assert.equal(catalog.all[0].models.paid.free, false);
  assert.deepEqual(catalog.all[0].models.paid.cost, { input: 2, output: 8 });
  assert.equal(catalog.all[0].models.old.deprecated, true);
  assert.deepEqual(normalizeOpenCodeProviderCatalog(catalog).defaults, { opencode: "free" });

  const free = filterOpenCodePickerModels(catalog.all, { connected: catalog.connected, free: true, available: true });
  assert.deepEqual(free.active.map(row => row.model.id), ["free"]);
  assert.deepEqual(free.deprecated.map(row => row.model.id), ["old"]);
  assert.equal(free.counts.needsKey, 0, "OpenCode's /api routes expose no unconnected models");
});

test("free filter keeps cost-zero rows and does not change availability", () => {
  const providers = [{
    id: "agentrouter",
    name: "AgentRouter",
    models: {
      zero: { id: "zero", name: "Zero", cost: { input: 0, output: 0 }, available: false, requiresKey: ["AGENT_ROUTER_API_KEY"], free: false },
      priced: { id: "priced", name: "Priced", cost: { input: 0, output: 2 }, available: false, requiresKey: ["AGENT_ROUTER_API_KEY"], free: true },
      unknown: { id: "unknown", name: "Unknown", cost: null, available: true, free: true, status: "active" },
      usable: { id: "usable", name: "Usable", cost: { input: 0, output: 0 }, available: true, status: "active" }
    }
  }];
  const onlyFree = filterOpenCodePickerModels(providers, { free: true, connected: [] });
  assert.deepEqual(onlyFree.active.map(row => row.model.id), ["usable", "zero"]);
  assert.equal(onlyFree.active.find(row => row.model.id === "zero").needsKey, true);
  assert.equal(onlyFree.active.find(row => row.model.id === "zero").reason, "Needs key (AGENT_ROUTER_API_KEY)");
  assert.equal(onlyFree.active.find(row => row.model.id === "zero").selectable, false);
  assert.equal(onlyFree.active.find(row => row.model.id === "usable").selectable, true);
  assert.equal(onlyFree.counts.shown, 2);
  assert.equal(onlyFree.counts.needsKey, 1);
  assert.equal(onlyFree.counts.available, 1);

  const intersection = filterOpenCodePickerModels(providers, { free: true, available: true, needsKey: true, connected: ["agentrouter"] });
  assert.equal(intersection.counts.shown, 0);
  assert.deepEqual(intersection.active, []);
});

test("picker window stays small across a 9k model list", () => {
  for (const scrollTop of [0, 560, 18000, 56 * 8900]) {
    const window = openCodePickerWindow(scrollTop, 700, 9000, 56);
    assert.ok(window.end - window.start <= 20, `${scrollTop} mounted ${window.end - window.start}`);
    assert.ok(window.start >= 0 && window.end <= 9000);
  }
  assert.deepEqual(openCodePickerWindow(0, 0, 9000), { start: 0, end: 0 });
});

test("OpenCode validates provider payload before replacing the current catalog", async () => {
  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function loadProviders(");
  const end = source.indexOf("async function loadAgents", start);
  const loader = source.slice(start, end);
  assert.ok(loader.indexOf("normalizeOpenCodeProviderCatalog(payload)") < loader.indexOf("providers = catalog.providers"));
  assert.match(loader, /const requestGeneration = providerCatalogRequests.begin()/);
  assert.match(loader, /refresh=1/);
  assert.match(source, /PROVIDER_REFRESH_MS/);
  assert.match(source, /provider\.updated/);
  assert.match(source, /Search models/);
  // PR #500 item N: one filter select (all / free / ready / needs key / deprecated) replaces the chips;
  // a single choice keeps "ready" and "needs key" mutually exclusive.
  assert.match(source, /const MODEL_FILTERS: ModelPickerFilter\[\] = \["all", "free", "available", "needsKey", "deprecated"\]/);
  assert.match(source, /modelPickerAvailable = value === "available";\n\s*modelPickerNeedsKey = value === "needsKey";/);
  assert.match(source, /ocxModelScroll/);
  assert.doesNotMatch(source, /ocxDeprecatedScroll/);
  assert.match(source, /modalTitle\.textContent = "Provider · Model";/);
  assert.doesNotMatch(source, /async function showModels\(/);
});

test("OpenCode provider route builds one catalog from the shared /api routes", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function opencodeProviders(");
  const end = source.indexOf("function taskTimeoutMs", start);
  const route = source.slice(start, end);
  assert.match(route, /loadOpenCodeProviderCatalog/);
  assert.match(route, /refresh/);
  assert.match(source, /openCode\.catalogInputs\(\)/);
  assert.match(source, /buildOpenCodeProviderCatalog/);
  // The 1.x-only catalog route is gone (2.x serves its web UI there).
  assert.doesNotMatch(source, /fetchOpenCodeJson\("\/provider"/);
  assert.doesNotMatch(source, /readOpenCodeModelOverrides/);
});

test("OpenCode 1.x marks native-API models unrunnable; 2.x keeps them selectable", () => {
  // Shapes from real OpenCode 1.19.5 / 2.0.9 GET /api/model.
  const providers = { data: [{ id: "opencode", name: "OpenCode" }] };
  const models = { data: [
    { providerID: "opencode", id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free", api: { type: "native" }, cost: { input: 0, output: 0 } },
    { providerID: "opencode", id: "muse-wonder-1.0", name: "Muse Wonder", api: { type: "aisdk" } }
  ] };
  const v1 = buildOpenCodeProviderCatalog({ generation: "v1", providers, models });
  const native = v1.all[0].models["deepseek-v4.1-flash-free"];
  assert.equal(native.enabled, false);
  assert.match(native.unsupported, /1\.x/);
  assert.equal(v1.all[0].models["muse-wonder-1.0"].enabled, true);
  const rows = filterOpenCodePickerModels(v1.all, { connected: ["opencode"] }).active;
  const row = rows.find(item => item.model.id === "deepseek-v4.1-flash-free");
  assert.equal(row.selectable, false);
  assert.equal(row.reason, native.unsupported);

  const v2 = buildOpenCodeProviderCatalog({ generation: "v2", providers, models });
  assert.equal(v2.all[0].models["deepseek-v4.1-flash-free"].enabled, true);
  assert.equal("unsupported" in v2.all[0].models["deepseek-v4.1-flash-free"], false);
});
