import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { stampBuiltServiceWorker, stampServiceWorkerCache } from "../scripts/service-worker-cache.mjs";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function cacheNameOf(workerSource) {
  const context = vm.createContext({ self: { addEventListener() {}, location: { origin: "https://devmoter.test" } } });
  vm.runInContext(workerSource, context);
  return vm.runInContext("CACHE", context);
}

async function activate(workerSource, existingCaches) {
  const stores = new Set(existingCaches);
  let activateHandler;
  const context = vm.createContext({
    self: {
      addEventListener(type, handler) { if (type === "activate") activateHandler = handler; },
      skipWaiting() {},
      clients: { claim: async () => {} },
      location: { origin: "https://devmoter.test" }
    },
    caches: {
      keys: async () => [...stores],
      delete: async name => stores.delete(name)
    }
  });
  vm.runInContext(workerSource, context);
  const waits = [];
  activateHandler({ waitUntil: promise => waits.push(promise) });
  await Promise.all(waits);
  return [...stores];
}

test("each build gets its own service worker cache name", () => {
  const base = cacheNameOf(source);
  const first = stampServiceWorkerCache(source, "1111111111111111111111111111111111111111");
  const second = stampServiceWorkerCache(source, "2222222222222222222222222222222222222222");
  assert.equal(cacheNameOf(first), `${base}-1111111111111111111111111111111111111111`);
  assert.equal(cacheNameOf(second), `${base}-2222222222222222222222222222222222222222`);
  assert.notEqual(first, second, "a new build must change sw.js bytes so the browser installs it");
});

test("stamping only rewrites the cache name", () => {
  const stamped = stampServiceWorkerCache(source, "abc123def456-dirty");
  const strip = text => text.split("\n").slice(1).join("\n");
  assert.equal(strip(stamped), strip(source));
});

test("a missing or unsafe build id leaves the committed cache name", () => {
  for (const id of [undefined, "", "   ", "bad\"; self.x=1; //", "../etc", "x".repeat(65)]) {
    assert.equal(stampServiceWorkerCache(source, id), source, String(id));
  }
});

test("stamping fails the build if sw.js no longer declares its cache name", () => {
  assert.throws(() => stampServiceWorkerCache("const OTHER = 1;", "abc123"), /must declare/);
});

test("the next build's worker deletes the previous build's cache on activate", async () => {
  const previous = stampServiceWorkerCache(source, "aaaaaaaaaaaa");
  const next = stampServiceWorkerCache(source, "bbbbbbbbbbbb");
  const remaining = await activate(next, [cacheNameOf(previous), cacheNameOf(next), "devmoter-fast-v21"]);
  assert.deepEqual(remaining, [cacheNameOf(next)]);
});

test("the built sw.js in the output directory is stamped in place", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-sw-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "sw.js"), source);
  await stampBuiltServiceWorker(root, "dist", "cafe1234");
  assert.equal(cacheNameOf(await readFile(join(root, "dist", "sw.js"), "utf8")), `${cacheNameOf(source)}-cafe1234`);
});

test("vite build registers the service worker cache stamp", async () => {
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /plugins: \[[^\]]*serviceWorkerCacheVersion\(\)/);
  assert.match(config, /stampBuiltServiceWorker\(root, outDir, buildId\)/);
});
