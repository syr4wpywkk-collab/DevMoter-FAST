import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeCodexModels } from "../src/codex-reasoning.mjs";

test("Codex malformed model catalogs fail before assignment and retain the prior list", async () => {
  const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function loadModelCatalog()");
  const end = source.indexOf("async function applyModelSelection", start);
  const loader = source.slice(start, end);
  assert.ok(loader.indexOf("normalizeCodexModels(result)") < loader.indexOf("modelCatalog = normalizedModels"));
  assert.throws(() => normalizeCodexModels({ data: "corrupt" }), /invalid model catalog/);
  assert.throws(() => normalizeCodexModels({ models: [null] }), /invalid model catalog/);
});
