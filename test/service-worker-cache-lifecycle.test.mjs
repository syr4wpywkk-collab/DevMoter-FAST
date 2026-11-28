import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://devmoter.test";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function loadWorker({ cacheNames = [], network, windows = [], matchFails = false } = {}) {
  const listeners = new Map();
  const stores = new Map(cacheNames.map(name => [name, new Map()]));
  const deleted = [];
  const fetchCalls = [];
  const matchCalls = [];
  const matchAllCalls = [];
  const openWindowCalls = [];
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
      matchCalls.push(key);
      if (matchFails) throw new Error("cache storage unavailable");
      for (const store of stores.values()) if (store.has(key)) return store.get(key);
      return undefined;
    }
  };
  let claimed = false;
  let skipped = false;
  const self = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    skipWaiting() { skipped = true; },
    clients: {
      claim: async () => { claimed = true; },
      matchAll: async options => { matchAllCalls.push({ ...options }); return windows; },
      openWindow: async url => { openWindowCalls.push(url); return { url }; }
    },
    location: { origin: ORIGIN },
    registration: {}
  };
  const fetchImpl = async (request, init) => {
    fetchCalls.push({ url: String(request.url ?? request), init });
    if (network) return network(request, init);
    throw new Error("offline");
  };
  const context = vm.createContext({ self, caches, URL, Response, fetch: fetchImpl, console });
  vm.runInContext(source, context);
  const cacheName = vm.runInContext("CACHE", context);
  return {
    listeners,
    stores,
    deleted,
    cacheName,
    fetchCalls,
    matchCalls,
    matchAllCalls,
    openWindowCalls,
    state: () => ({ claimed, skipped })
  };
}

async function dispatch(handler, extra = {}) {
  const waits = [];
  let responded;
  handler({ waitUntil: promise => waits.push(promise), respondWith: promise => { responded = promise; }, ...extra });
  await Promise.all(waits);
  return responded === undefined ? undefined : await responded;
}

async function dispatchFetch(worker, request) {
  let intercepted = false;
  let responded;
  await dispatch(worker.listeners.get("fetch"), {
    request,
    respondWith: promise => {
      intercepted = true;
      responded = promise;
    }
  });
  return {
    intercepted,
    response: responded === undefined ? undefined : await responded
  };
}

function makeClient(url) {
  const events = [];
  const navigated = [];
  let focused = 0;
  return {
    url,
    events,
    navigated,
    focused: () => focused,
    async navigate(target) {
      events.push(`navigate:${target}`);
      navigated.push(target);
      return this;
    },
    async focus() {
      events.push("focus");
      focused += 1;
      return this;
    }
  };
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

test("upgrading from v21 removes old login and cross-origin entries", async () => {
  const legacyCache = "devmoter-fast-v21";
  const worker = loadWorker({ cacheNames: [legacyCache] });
  const urls = [`${ORIGIN}/login.js`, "https://other.test/app.js"];
  for (const url of urls) worker.stores.get(legacyCache).set(url, { body: "legacy" });

  await dispatch(worker.listeners.get("install"));
  await dispatch(worker.listeners.get("activate"));

  assert.deepEqual(worker.deleted, [legacyCache]);
  assert.deepEqual([...worker.stores.keys()], [worker.cacheName]);
  assert.ok(worker.stores.get(worker.cacheName).has(`${ORIGIN}/`));
  for (const url of urls) assert.equal(worker.stores.get(worker.cacheName).has(url), false);
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

async function assertUnavailable(response, label) {
  assert.ok(response, `${label}: respondWith must settle with a Response`);
  assert.equal(response.status, 503, label);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
  assert.equal(response.headers.get("retry-after"), "5", label);
  assert.match(await response.text(), /temporarily unavailable/, label);
}

test("network failure with a cache miss answers an explicit 503, never undefined", async () => {
  const worker = loadWorker();
  const { intercepted, response } = await dispatchFetch(worker, { method: "GET", url: `${ORIGIN}/assets/missing.js` });
  assert.equal(intercepted, true);
  await assertUnavailable(response, "cache miss");
});

test("network failure with a failing cache lookup answers an explicit 503", async () => {
  const worker = loadWorker({ matchFails: true });
  const { response } = await dispatchFetch(worker, { method: "GET", url: `${ORIGIN}/` });
  assert.deepEqual(worker.matchCalls, [`${ORIGIN}/`]);
  await assertUnavailable(response, "cache rejection");
});

test("a network fetch that resolves with nothing still falls back to a valid Response", async () => {
  const worker = loadWorker({ network: async () => undefined });
  const { response } = await dispatchFetch(worker, { method: "GET", url: `${ORIGIN}/page` });
  await assertUnavailable(response, "empty fetch result");
});

test("network failure serves a cached copy when one exists", async () => {
  const worker = loadWorker();
  await dispatch(worker.listeners.get("install"));
  const { response } = await dispatchFetch(worker, { method: "GET", url: `${ORIGIN}/manifest.webmanifest` });
  assert.equal(response.shell, true);
});

test("HTTP error responses pass through unchanged and are not cached", async () => {
  const notFound = { ok: false, redirected: false, status: 404, clone() { return { body: "copy" }; }, body: "nope" };
  const worker = loadWorker({ network: async () => notFound });
  const request = { method: "GET", url: `${ORIGIN}/gone.js` };
  const { response } = await dispatchFetch(worker, request);
  assert.equal(response, notFound);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.stores.get(worker.cacheName)?.has(request.url) ?? false, false);
  assert.deepEqual(worker.matchCalls, []);
});

test("a throwing response clone does not lose the live response", async () => {
  const live = { ok: true, redirected: false, clone() { throw new Error("body used"); }, body: "live" };
  const worker = loadWorker({ network: async () => live });
  const { response } = await dispatchFetch(worker, { method: "GET", url: `${ORIGIN}/page` });
  assert.equal(response, live);
});

test("API, login, and non-GET requests are never intercepted or cached", async () => {
  const worker = loadWorker({
    network: async () => ({ ok: true, redirected: false, clone() { return { body: "secret" }; }, body: "secret" })
  });
  for (const request of [
    { method: "GET", url: "https://devmoter.test/api/health" },
    { method: "GET", url: "https://devmoter.test/login.html" },
    { method: "GET", url: "https://devmoter.test/login.js" },
    { method: "GET", url: "https://devmoter.test/login.js?v=1" },
    { method: "POST", url: "https://devmoter.test/" }
  ]) {
    const result = await dispatchFetch(worker, request);
    assert.equal(result.intercepted, false, request.url);
    assert.equal(result.response, undefined, request.url);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(worker.fetchCalls, []);
  assert.deepEqual(worker.matchCalls, []);
  assert.equal(worker.stores.has(worker.cacheName), false);
});

test("cross-origin and non-http(s) fetches are never intercepted, fetched, or cached", async () => {
  const worker = loadWorker({
    network: async () => ({ ok: true, redirected: false, clone() { return { body: "remote-copy" }; }, body: "remote" })
  });
  worker.stores.set(worker.cacheName, new Map());
  worker.stores.get(worker.cacheName).set("https://evil.example/seeded.js", { body: "poisoned" });

  for (const request of [
    { method: "GET", url: "https://evil.example/seeded.js" },
    { method: "GET", url: "https://evil.example/script.js" },
    { method: "GET", url: "http://devmoter.test/app.js" },
    { method: "GET", url: "https://devmoter.test:8443/app.js" },
    { method: "GET", url: "https://sub.devmoter.test/app.js" },
    { method: "GET", url: "blob:https://devmoter.test/00000000-0000-0000-0000-000000000000" },
    { method: "GET", url: "data:text/javascript,alert(1)" },
    { method: "GET", url: "not-a-valid-url" }
  ]) {
    const result = await dispatchFetch(worker, request);
    assert.equal(result.intercepted, false, request.url);
    assert.equal(result.response, undefined, request.url);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(worker.fetchCalls, []);
  assert.deepEqual(worker.matchCalls, []);
  assert.deepEqual([...worker.stores.get(worker.cacheName).keys()], ["https://evil.example/seeded.js"]);
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

test("notificationclick navigates same-origin URLs and skips cross-origin clients", async () => {
  const crossOrigin = makeClient("https://evil.example/app");
  const sameOrigin = makeClient(`${ORIGIN}/old`);
  const worker = loadWorker({ windows: [crossOrigin, sameOrigin] });
  let closed = false;

  await dispatch(worker.listeners.get("notificationclick"), {
    notification: {
      close() { closed = true; },
      data: { url: "/?backend=codex&session=thread-1#latest" }
    }
  });

  assert.equal(closed, true);
  assert.deepEqual(worker.matchAllCalls, [{ type: "window", includeUncontrolled: true }]);
  assert.deepEqual(crossOrigin.navigated, []);
  assert.equal(crossOrigin.focused(), 0);
  assert.deepEqual(sameOrigin.events, [
    `navigate:${ORIGIN}/?backend=codex&session=thread-1#latest`,
    "focus"
  ]);
  assert.deepEqual(worker.openWindowCalls, []);
});

test("notificationclick opens same-origin absolute URLs in a new window when no client matches", async () => {
  const crossOrigin = makeClient("https://evil.example/app");
  const worker = loadWorker({ windows: [crossOrigin] });

  await dispatch(worker.listeners.get("notificationclick"), {
    notification: {
      close() {},
      data: { url: `${ORIGIN}/sessions/42` }
    }
  });

  assert.deepEqual(crossOrigin.navigated, []);
  assert.deepEqual(worker.openWindowCalls, [`${ORIGIN}/sessions/42`]);
});

test("notificationclick falls back to root for cross-origin, non-http(s), or invalid URLs", async () => {
  const unsafeTargets = [
    "https://evil.example/phish",
    "http://devmoter.test/downgrade",
    "https://devmoter.test:8443/alt-port",
    "//evil.example/protocol-relative",
    "///evil.example/triple-slash",
    "/\\evil.example/backslash",
    "javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://devmoter.test/123",
    "https://[invalid",
    "",
    undefined
  ];

  for (const url of unsafeTargets) {
    const sameOrigin = makeClient(`${ORIGIN}/current`);
    const workerWithClient = loadWorker({ windows: [sameOrigin] });
    await dispatch(workerWithClient.listeners.get("notificationclick"), {
      notification: {
        close() {},
        data: url === undefined ? {} : { url }
      }
    });
    assert.deepEqual(sameOrigin.navigated, [`${ORIGIN}/`], `navigate fallback for ${String(url)}`);
    assert.equal(sameOrigin.focused(), 1);

    const workerNoClient = loadWorker({ windows: [] });
    await dispatch(workerNoClient.listeners.get("notificationclick"), {
      notification: {
        close() {},
        data: url === undefined ? {} : { url }
      }
    });
    assert.deepEqual(workerNoClient.openWindowCalls, [`${ORIGIN}/`], `openWindow fallback for ${String(url)}`);
  }
});
