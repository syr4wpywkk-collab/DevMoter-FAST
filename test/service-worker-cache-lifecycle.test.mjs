import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://devmoter.test";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function loadWorker({ cacheNames = [], network } = {}) {
  const listeners = new Map();
  const stores = new Map(cacheNames.map(name => [name, new Map()]));
  const deleted = [];
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(urls) { for (const url of urls) { const href = new URL(String(url), ORIGIN).href; store.set(href, { url: href, shell: true }); } },
        async put(request, response) { store.set(String(request.url ?? request), response); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { deleted.push(name); return stores.delete(name); },
    async match(request) {
      const key = String(request.url ?? request);
      for (const store of stores.values()) if (store.has(key)) return store.get(key);
      return undefined;
    }
  };
  let claimed = false;
  let skipped = false;
  const self = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    skipWaiting() { skipped = true; },
    clients: { claim: async () => { claimed = true; } },
    location: { origin: "https://devmoter.test" },
    registration: {}
  };
  const context = vm.createContext({ self, caches, URL, fetch: network ?? (async () => { throw new Error("offline"); }), console });
  vm.runInContext(source, context);
  const cacheName = vm.runInContext("CACHE", context);
  return { listeners, stores, deleted, cacheName, state: () => ({ claimed, skipped }) };
}

async function dispatch(handler, extra = {}) {
  const waits = [];
  let responded;
  handler({ waitUntil: promise => waits.push(promise), respondWith: promise => { responded = promise; }, ...extra });
  await Promise.all(waits);
  return responded === undefined ? undefined : await responded;
}

test("install precaches the app shell and activates without waiting", async () => {
  const worker = loadWorker();
  await dispatch(worker.listeners.get("install"));
  const shell = worker.stores.get(worker.cacheName);
  assert.ok(shell.has(`${ORIGIN}/`));
  assert.ok(shell.has(`${ORIGIN}/manifest.webmanifest`));
  assert.equal(worker.state().skipped, true);
});

test("activate removes every cache from older builds and claims open clients", async () => {
  const worker = loadWorker({ cacheNames: ["devmoter-fast-v1", "devmoter-fast-v20", "unrelated-old"] });
  await dispatch(worker.listeners.get("install"));
  await dispatch(worker.listeners.get("activate"));
  assert.deepEqual([...worker.stores.keys()], [worker.cacheName]);
  assert.deepEqual(worker.deleted.sort(), ["devmoter-fast-v1", "devmoter-fast-v20", "unrelated-old"].sort());
  assert.equal(worker.state().claimed, true);
});

test("cache name is versioned so a new build replaces the old shell", () => {
  const worker = loadWorker();
  assert.match(worker.cacheName, /^devmoter-fast-v\d+$/);
});

test("navigation and assets are network-first with no-store and refresh the cache", async () => {
  const calls = [];
  const worker = loadWorker({
    network: async (request, init) => {
      calls.push({ url: request.url, init });
      return { ok: true, redirected: false, clone() { return { body: "fresh-copy" }; }, body: "fresh" };
    }
  });
  const request = { method: "GET", url: "https://devmoter.test/assets/app.js" };
  const response = await dispatch(worker.listeners.get("fetch"), { request });
  assert.equal(response.body, "fresh");
  assert.equal(calls[0].init.cache, "no-store");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.stores.get(worker.cacheName).get(request.url).body, "fresh-copy");
});

test("offline requests fall back to the cached copy", async () => {
  const worker = loadWorker();
  await dispatch(worker.listeners.get("install"));
  const response = await dispatch(worker.listeners.get("fetch"), { request: { method: "GET", url: `${ORIGIN}/` } });
  assert.equal(response.shell, true);
});

test("API, login, and non-GET requests are never served from the cache", async () => {
  const worker = loadWorker();
  for (const request of [
    { method: "GET", url: "https://devmoter.test/api/health" },
    { method: "GET", url: "https://devmoter.test/login.html" },
    { method: "POST", url: "https://devmoter.test/" }
  ]) {
    assert.equal(await dispatch(worker.listeners.get("fetch"), { request }), undefined, request.url);
  }
});

test("redirected or failed responses are not written to the cache", async () => {
  for (const response of [{ ok: false, redirected: false }, { ok: true, redirected: true }]) {
    const worker = loadWorker({ network: async () => ({ ...response, clone() { return { body: "x" }; } }) });
    const request = { method: "GET", url: "https://devmoter.test/page" };
    await dispatch(worker.listeners.get("fetch"), { request });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(worker.stores.get(worker.cacheName)?.has(request.url) ?? false, false);
  }
});
