import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createLatestRequestGuard } from "../src/latest-request.mjs";

test("history refresh applies only the newest request result", () => {
  const requests = createLatestRequestGuard();
  const slow = requests.begin();
  const fast = requests.begin();

  assert.equal(requests.isCurrent(fast), true);
  assert.equal(requests.isCurrent(slow), false);
});

test("Codex and OpenCode guard history and model catalogs before assignment", async () => {
  const [codex, opencode] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);

  assert.match(codex, /const requestGeneration = threadListRequests\.begin\(\);[\s\S]{0,180}if \(!threadListRequests\.isCurrent\(requestGeneration\)\) return;[\s\S]{0,80}allThreads = result\?\.data/);
  assert.match(opencode, /const requestGeneration = sessionListRequests\.begin\(\);[\s\S]{0,180}if \(!sessionListRequests\.isCurrent\(requestGeneration\)\) return;[\s\S]{0,80}sessions = Array\.isArray\(data\)/);
  assert.match(codex, /const requestGeneration = modelCatalogRequests\.begin\(\);[\s\S]{0,180}if \(!modelCatalogRequests\.isCurrent\(requestGeneration\)\) return modelCatalog;[\s\S]{0,80}modelCatalog = normalizeCodexModels/);
  assert.match(opencode, /const requestGeneration = providerCatalogRequests\.begin\(\);[\s\S]{0,300}if \(!providerCatalogRequests\.isCurrent\(requestGeneration\)\) return;[\s\S]{0,100}providers = Array\.isArray/);
});
