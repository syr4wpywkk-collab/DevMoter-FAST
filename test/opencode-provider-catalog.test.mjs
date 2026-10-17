import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeOpenCodeProviderCatalog } from "../src/opencode-provider-catalog.mjs";

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

test("OpenCode validates provider payload before replacing the current catalog", async () => {
  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function loadProviders()");
  const end = source.indexOf("async function loadAgents", start);
  const loader = source.slice(start, end);
  assert.ok(loader.indexOf("normalizeOpenCodeProviderCatalog(payload)") < loader.indexOf("providers = catalog.providers"));
  assert.match(loader, /const requestGeneration = providerCatalogRequests.begin()/);
});
