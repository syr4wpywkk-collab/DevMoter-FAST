import test from "node:test";
import assert from "node:assert/strict";
import { REMOTE_BROWSER_HOST_FEATURES, remoteBrowserHostCapability } from "../server/browser-session.mjs";
import { createHostAdapter } from "../server/host/adapters.mjs";

function fakeSpawn(installed) {
  const calls = [];
  const spawn = (command) => {
    calls.push(command);
    return installed.includes(command) ? { status: 0, stdout: command + " 1.0\n" } : { status: 127, stdout: "" };
  };
  return { spawn, calls };
}

test("remote browser capability is unavailable without the opt-in and probes nothing", () => {
  const { spawn, calls } = fakeSpawn(["chromium", "bwrap"]);
  assert.deepEqual(remoteBrowserHostCapability({ env: {}, spawnSyncImpl: spawn }), {
    state: "unavailable",
    reason: "browser_automation_disabled"
  });
  assert.deepEqual(calls, []);
});

test("remote browser capability reports a missing browser binary", () => {
  const { spawn } = fakeSpawn(["bwrap"]);
  assert.deepEqual(remoteBrowserHostCapability({ env: { DEVMOTER_BROWSER_AUTOMATION: "1" }, spawnSyncImpl: spawn }), {
    state: "unavailable",
    reason: "browser_binary_not_found"
  });
});

test("remote browser capability is unavailable when bubblewrap cannot be used", () => {
  const { spawn } = fakeSpawn(["chromium"]);
  assert.deepEqual(remoteBrowserHostCapability({ env: { DEVMOTER_BROWSER_AUTOMATION: "1" }, spawnSyncImpl: spawn }), {
    state: "unavailable",
    reason: "sandbox_unavailable"
  });
  const withBwrap = fakeSpawn(["chromium", "bwrap"]);
  assert.deepEqual(remoteBrowserHostCapability({
    env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: "off" },
    spawnSyncImpl: withBwrap.spawn
  }), { state: "unavailable", reason: "sandbox_disabled" });
});

test("remote browser capability is available with opt-in, browser and bubblewrap, and fits Host Protocol v1", async () => {
  const { spawn } = fakeSpawn(["chromium", "bwrap"]);
  const browser = remoteBrowserHostCapability({ env: { DEVMOTER_BROWSER_AUTOMATION: "1" }, spawnSyncImpl: spawn });
  assert.deepEqual(browser, { state: "available", features: [...REMOTE_BROWSER_HOST_FEATURES] });
  const host = createHostAdapter({ platform: "linux", architecture: "x64", env: {}, capabilities: { browser } });
  assert.deepEqual((await host.capabilities()).browser, { state: "available", reason: null, features: [...REMOTE_BROWSER_HOST_FEATURES] });
  for (const reason of ["browser_automation_disabled", "browser_binary_not_found", "sandbox_unavailable", "sandbox_disabled"]) {
    const degradedHost = createHostAdapter({ platform: "linux", env: {}, capabilities: { browser: { state: "unavailable", reason } } });
    assert.equal((await degradedHost.capabilities()).browser.reason, reason);
  }
});
