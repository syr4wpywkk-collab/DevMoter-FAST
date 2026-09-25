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
  assert.ok(control.includes("renderProjectOptions();
      return refreshTerminalSessions();"));
});

test("terminal trusted-device failure exposes direct recovery navigation", async () => {
  const control = await source("src/control-center.ts");
  assert.ok(control.includes("This browser is not a Trusted device"));
  assert.ok(control.includes('button("Open Trusted devices")'));
  assert.ok(control.includes('detail: { page: "devices" }'));
  assert.ok(control.includes("/trusted device/i"));
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
