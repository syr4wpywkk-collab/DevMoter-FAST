import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

test("wake lock request is coalesced and released if the turn finishes while acquisition is pending", async t => {
  const saved = new Map();
  const storage = new Map();
  const visibility = { visibilityState: "visible", addEventListener() {} };
  let resolveRequest;
  let requests = 0;
  let releases = 0;
  const sentinel = {
    addEventListener() {},
    async release() { releases += 1; }
  };
  const acquisition = new Promise(resolve => { resolveRequest = resolve; });
  const globals = {
    navigator: { wakeLock: { request() { requests += 1; return acquisition; } } },
    document: visibility,
    window: { addEventListener() {} },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); }
    }
  };
  for (const [name, value] of Object.entries(globals)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const source = await readFile(new URL("../src/wake-lock.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const wake = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

  wake.setWakeLockEnabled(true);
  wake.setWakeLockExecutionActive("opencode", true);
  wake.setWakeLockExecutionActive("codex", true);
  assert.equal(requests, 1, "concurrent status changes must not acquire multiple sentinels");

  wake.setWakeLockExecutionActive("opencode", false);
  wake.setWakeLockExecutionActive("codex", false);
  resolveRequest(sentinel);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases, 1, "a late browser response must be immediately released");
});
