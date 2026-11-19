import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DICTIONARIES } from "../src/i18n-core.mjs";

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
  // Terminal, Safety and Index share one section gate: an unregistered or revoked
  // device replaces the tab with an explanation and link into Settings → Trusted devices.
  assert.ok(body.includes("showSectionGate(terminalSection, error)"));
  const gateStart = control.indexOf("function showSectionGate(");
  const gate = control.slice(gateStart, control.indexOf("function clearSectionGate(", gateStart));
  assert.ok(gate.includes("isDeviceAuthError(error)"));
  assert.ok(gate.includes("createDeviceGate(document,"));
  assert.ok(gate.includes('t("deviceGate.unregisteredTitle")'));
  assert.ok(gate.includes('t("deviceGate.toolsLockedCopy"'));
  assert.ok(gate.includes('t("deviceGate.openToRegisterButton")'));
  assert.ok(body.includes('showTerminalError(t("terminal.loadSessionsFailed"), error)'));
  assert.equal(DICTIONARIES.en["terminal.loadSessionsFailed"], "Could not load sessions");
  // The raw 401 text is not shown alongside the gate, and the old bespoke gate is gone.
  assert.ok(!control.includes("This browser is not a Trusted device"));
  assert.ok(!control.includes("/trusted device/i"));
  for (const [key, expectedEn] of [
    ["terminal.startFailed", "Could not start terminal"],
    ["terminal.attachFailed", "Could not attach session"]
  ]) {
    assert.ok(control.includes(`showTerminalError(t("${key}"), error)`), key);
    assert.equal(DICTIONARIES.en[key], expectedEn, key);
  }
});

test("remote browsers are not offered localhost-only trusted-device bootstrap", async () => {
  const settings = await source("src/settings.ts");
  assert.ok(settings.includes("function isLoopbackBrowser()"));
  assert.ok(settings.includes('host === "localhost"'));
  assert.ok(settings.includes('host === "127.0.0.1"'));
  assert.ok(settings.includes("localBootstrap"));
  assert.ok(settings.includes('t("settings.devices.guidanceRemote")'));
  assert.ok(settings.includes('t("settings.devices.guidanceBootstrap")'));
  assert.ok(DICTIONARIES.ja["settings.devices.guidanceRemote"].includes("信頼済み端末でペアリングコードを作成"));
  assert.ok(DICTIONARIES.ja["settings.devices.guidanceBootstrap"].includes("最初の信頼済み端末は、セキュリティのため localhost（127.0.0.1）から登録"));
});
