import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildOpenCodeProviderCatalog, filterOpenCodePickerModels, normalizeOpenCodeProviderCatalog } from "../src/opencode-provider-catalog.mjs";

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

test("provider catalog is built from v1 and only takes v2 status overrides", () => {
  const catalog = buildOpenCodeProviderCatalog({
    v1: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          env: [],
          models: {
            free: { id: "free", name: "Free", cost: { input: 0, output: 0 }, status: "active" },
            paid: { id: "paid", name: "Paid", cost: { input: 2, output: 8 } }
          }
        },
        {
          id: "oci",
          name: "OCI",
          env: ["OCI_GENAI_API_KEY"],
          models: {
            genai: { id: "genai", name: "GenAI", cost: { input: 1, output: 2 }, status: "active" },
            old: { id: "old", name: "Old", cost: { input: 0, output: 0 } }
          }
        }
      ],
      default: { opencode: "free" },
      connected: ["opencode"]
    },
    modelOverrides: [
      { id: "old", providerID: "oci", status: "deprecated", enabled: false },
      { id: "free", providerID: "opencode", status: "active", enabled: true }
    ],
    modelSource: "/api/model"
  });

  assert.equal(catalog.source, "/provider");
  assert.deepEqual(catalog.connected, ["opencode"]);
  assert.equal(catalog.all[0].models.free.free, true);
  assert.equal(catalog.all[0].models.free.available, true);
  assert.equal(catalog.all[0].models.paid.free, false);
  assert.equal(catalog.all[1].models.genai.available, false);
  assert.deepEqual(catalog.all[1].models.genai.requiresKey, ["OCI_GENAI_API_KEY"]);
  assert.equal(catalog.all[1].models.old.deprecated, true);
  assert.equal(catalog.all[1].models.old.enabled, false);
  assert.equal(catalog.all[1].models.old.free, true);

  const picked = filterOpenCodePickerModels(catalog.all, { connected: catalog.connected, needsKey: true });
  assert.deepEqual(picked.active.map(row => row.model.id), ["genai"]);
  assert.equal(picked.active[0].reason, "Needs key (OCI_GENAI_API_KEY)");
  assert.equal(picked.active[0].selectable, false);
  assert.deepEqual(picked.deprecated.map(row => row.model.id), ["old"]);

  const free = filterOpenCodePickerModels(catalog.all, { connected: catalog.connected, free: true, available: true });
  assert.deepEqual(free.active.map(row => row.model.id), ["free"]);
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
  assert.match(source, /Needs key/);
  assert.match(source, /Deprecated/);
  assert.match(source, /ocxModelScroll/);
  assert.doesNotMatch(source, /async function showModels\(/);
});

test("OpenCode provider route builds one catalog from v1", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function opencodeProviders(");
  const end = source.indexOf("function taskTimeoutMs", start);
  const route = source.slice(start, end);
  assert.match(route, /loadOpenCodeProviderCatalog/);
  assert.match(route, /refresh/);
  assert.match(source, /fetchOpenCodeJson\("\/provider"/);
  assert.match(source, /buildOpenCodeProviderCatalog/);
  assert.doesNotMatch(source, /\/api\/provider/);
});
