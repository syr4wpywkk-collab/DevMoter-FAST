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

  assert.match(codex, /const requestGeneration = threadListRequests\.begin\(\);[\s\S]{0,500}if \(!threadListRequests\.isCurrent\(requestGeneration\)\) return false;[\s\S]{0,240}allThreads = normalizeCodexThreadList\(result\)/);
  const sessionLoaderStartForGeneration = opencode.indexOf("async function loadSessions()");
  const sessionLoaderEndForGeneration = opencode.indexOf("async function syncPendingPermission", sessionLoaderStartForGeneration);
  const sessionLoaderForGeneration = opencode.slice(sessionLoaderStartForGeneration, sessionLoaderEndForGeneration);
  assert.match(sessionLoaderForGeneration, /const requestGeneration = sessionListRequests\.begin\(\)/);
  assert.match(sessionLoaderForGeneration, /if \(!sessionListRequests\.isCurrent\(requestGeneration\)\) return false;[\s\S]{0,100}sessions = normalizeOpenCodeSessionList\(data\)/);
  const sessionLoaderStart = opencode.indexOf("async function loadSessions()");
  const sessionLoaderEnd = opencode.indexOf("async function syncPendingPermission", sessionLoaderStart);
  const sessionLoader = opencode.slice(sessionLoaderStart, sessionLoaderEnd);
  assert.match(sessionLoader, /catch \{[\s\S]{0,180}if \(!sessionListRequests\.isCurrent\(requestGeneration\)\) return false;[\s\S]{0,100}if \(activeSession\)/);
  assert.match(codex, /const requestGeneration = modelCatalogRequests\.begin\(\);[\s\S]{0,180}if \(!modelCatalogRequests\.isCurrent\(requestGeneration\)\) return modelCatalog;[\s\S]{0,80}modelCatalog = normalizeCodexModels/);
  assert.match(opencode, /const requestGeneration = providerCatalogRequests\.begin\(\);[\s\S]{0,300}if \(!providerCatalogRequests\.isCurrent\(requestGeneration\)\) return;[\s\S]{0,100}providers = Array\.isArray/);
});
