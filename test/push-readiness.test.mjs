import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/push-readiness.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, setTimeout, clearTimeout });
const { boundedPushWait, inspectPushReadiness } = exports;

test("push readiness reports unsupported and denied states without waiting", async () => {
  assert.equal((await inspectPushReadiness(null, null)).state, "unsupported");

  let called = false;
  const result = await inspectPushReadiness({
    getRegistration: () => { called = true; return Promise.resolve({}); },
    ready: Promise.resolve({})
  }, "denied");
  assert.equal(result.state, "denied");
  assert.equal(called, false);
});

test("push readiness distinguishes an unregistered service worker from a ready one", async () => {
  const missing = await inspectPushReadiness({
    getRegistration: async () => undefined,
    ready: new Promise(() => {})
  }, "granted", 15);
  assert.equal(missing.state, "unregistered");

  const registration = { scope: "/" };
  const ready = await inspectPushReadiness({
    getRegistration: async () => registration,
    ready: Promise.resolve(registration)
  }, "granted");
  assert.equal(ready.state, "ready");
  assert.equal(ready.registration, registration);
});

test("push readiness bounds a service worker that never becomes ready", async () => {
  const result = await inspectPushReadiness({
    getRegistration: async () => ({ scope: "/" }),
    ready: new Promise(() => {})
  }, "granted", 15);
  assert.equal(result.state, "error");
});

test("push subscription lookups can be bounded with the same wait helper", async () => {
  await assert.rejects(boundedPushWait(new Promise(() => {}), 15), /timed out/);
});
