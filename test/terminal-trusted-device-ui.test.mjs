import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("terminal project loading is independent from trusted-device session loading", async () => {
  const control = await source("src/control-center.ts");
  const start = control.indexOf("async function loadProjects()");
  const end = control.indexOf("function clearTrustedDeviceGate()", start);
  assert.ok(start >= 0 && end > start);
  const loadProjects = control.slice(start, end);
  assert.ok(loadProjects.includes('fetch("/api/projects"'));
  assert.ok(!loadProjects.includes("refreshTerminalSessions()"));
  assert.ok(control.includes("renderProjectOptions();"));
  assert.ok(control.includes("return refreshTerminalSessions();"));
});

test("terminal device-auth failures use the shared registration gate", async () => {
  const control = await source("src/control-center.ts");
  assert.ok(control.includes('from "./device-gate.mjs"'));
  const start = control.indexOf("function showTerminalError(");
  const end = control.indexOf("async function refreshTerminalSessions()", start);
  const body = control.slice(start, end);
  assert.ok(body.includes("isDeviceAuthError(error)"));
  assert.ok(body.includes("createDeviceGate(document"));
  assert.ok(body.includes('showTerminalError("Could not load sessions", error)'));
  // The raw 401 text is not shown alongside the gate, and the old bespoke gate is gone.
  assert.ok(!control.includes("This browser is not a Trusted device"));
  assert.ok(!control.includes("/trusted device/i"));
  for (const prefix of ["Could not start terminal", "Could not attach session"]) {
    assert.ok(control.includes(`showTerminalError("${prefix}", error)`), prefix);
  }
});

test("remote browsers are not offered localhost-only trusted-device bootstrap", async () => {
  const settings = await source("src/settings.ts");
  assert.ok(settings.includes("function isLoopbackBrowser()"));
  assert.ok(settings.includes('host === "localhost"'));
  assert.ok(settings.includes('host === "127.0.0.1"'));
  assert.ok(settings.includes("localBootstrap"));
  assert.ok(settings.includes("既存のTrusted deviceでペアリングコードを作成"));
  assert.ok(settings.includes("最初のTrusted deviceはセキュリティ上localhost / 127.0.0.1から作成"));
});
