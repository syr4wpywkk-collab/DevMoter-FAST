import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchAllCodexModels, normalizeCodexModels } from "../src/codex-reasoning.mjs";

test("Codex malformed model catalogs fail before assignment and retain the prior list", async () => {
  const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function loadModelCatalog()");
  const end = source.indexOf("async function applyModelSelection", start);
  const loader = source.slice(start, end);
  assert.ok(loader.indexOf("fetchAllCodexModels(") < loader.indexOf("modelCatalog = normalizedModels"));
  assert.throws(() => normalizeCodexModels({ data: "corrupt" }), /invalid model catalog/);
  assert.throws(() => normalizeCodexModels({ models: [null] }), /invalid model catalog/);
});

test("Codex model picker loads every model/list page, including hidden models (missing-model regression)", async () => {
  const pages = {
    "": { data: [{ id: "gpt-5", model: "gpt-5", isDefault: true }, { id: "gpt-5-mini", model: "gpt-5-mini" }], nextCursor: "p2" },
    p2: { data: [{ id: "gpt-5-codex", model: "gpt-5-codex", hidden: true }, { id: "gpt-5", model: "gpt-5" }], nextCursor: "p3" },
    p3: { data: [{ id: "o4-mini", model: "o4-mini" }], nextCursor: null }
  };
  const calls = [];
  const models = await fetchAllCodexModels(async params => { calls.push(params); return pages[params.cursor || ""]; });
  assert.deepEqual(models.map(model => model.model), ["gpt-5", "gpt-5-mini", "gpt-5-codex", "o4-mini"], "later pages and hidden models are kept, duplicates dropped");
  assert.deepEqual(calls.map(call => call.cursor ?? null), [null, "p2", "p3"]);
  assert.ok(calls.every(call => call.includeHidden === true));
  // The old loader asked for one page and the picker then dropped hidden rows.
  const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /for \(const model of models\.filter\(model => !model\.hidden\)\)/);
  assert.doesNotMatch(source, /rpc<Json>\("model\/list", \{ limit: 100 \}\)/);
  // Codex's picker-listed models come first; hidden ones follow under a quiet group label.
  assert.match(source, /models\.filter\(model => !model\.hidden\), \.\.\.models\.filter\(model => model\.hidden\)/);
});

test("model/list pagination stops on a repeated cursor and still rejects corrupt pages", async () => {
  let count = 0;
  const models = await fetchAllCodexModels(async () => { count += 1; return { data: [{ id: "m" + count, model: "m" + count }], nextCursor: "same" }; });
  assert.equal(count, 2);
  assert.equal(models.length, 2);
  await assert.rejects(fetchAllCodexModels(async () => ({ data: "corrupt" })), /invalid model catalog/);
});
