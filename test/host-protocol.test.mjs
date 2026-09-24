import test from "node:test";
import assert from "node:assert/strict";
import { createHostAdapter, LinuxHost, MacOSHost, WindowsWSLHost } from "../server/host/adapters.mjs";
import { DevMoterHost, HOST_CAPABILITY_IDS, HOST_PROTOCOL_VERSION } from "../server/host/protocol.mjs";

test("Linux host reports the shared protocol and fails closed for unregistered capabilities", async () => {
  const host = createHostAdapter({
    platform: "linux",
    architecture: "x64",
    env: {},
    capabilities: {
      terminal: { state: "available", features: ["pty", "ndjson-stream"] },
      secrets: { state: "unavailable", reason: "host_vault_not_implemented" }
    }
  });

  assert.ok(host instanceof LinuxHost);
  const snapshot = await host.snapshot();
  assert.equal(snapshot.protocolVersion, HOST_PROTOCOL_VERSION);
  assert.deepEqual(snapshot.host, {
    id: "local",
    platform: "linux",
    runtime: "native",
    architecture: "x64",
    protocolVersion: HOST_PROTOCOL_VERSION
  });
  assert.deepEqual(snapshot.capabilities.terminal, {
    state: "available",
    reason: null,
    features: ["pty", "ndjson-stream"]
  });
  assert.deepEqual(snapshot.capabilities.secrets, {
    state: "unavailable",
    reason: "host_vault_not_implemented",
    features: []
  });
  assert.deepEqual(snapshot.capabilities.processes, {
    state: "unavailable",
    reason: "not_implemented",
    features: []
  });
  assert.deepEqual(Object.keys(snapshot.capabilities).sort(), [...HOST_CAPABILITY_IDS].sort());
  assert.equal(Object.hasOwn(snapshot.host, "hostname"), false);
  assert.equal(Object.hasOwn(snapshot.host, "homeDirectory"), false);

  snapshot.capabilities.terminal.features.push("mutated");
  assert.deepEqual((await host.capabilities()).terminal.features, ["pty", "ndjson-stream"]);
});

test("WSL is identified as Windows with Linux capabilities only when running inside WSL", async () => {
  const connected = createHostAdapter({
    platform: "linux",
    architecture: "x64",
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    capabilities: { terminal: { state: "available", features: ["pty"] } }
  });
  assert.ok(connected instanceof WindowsWSLHost);
  assert.deepEqual(await connected.info(), {
    id: "local",
    platform: "windows",
    runtime: "wsl",
    architecture: "x64",
    protocolVersion: HOST_PROTOCOL_VERSION
  });
  assert.equal((await connected.capabilities()).terminal.state, "available");

  const disconnected = createHostAdapter({ platform: "win32", architecture: "x64", env: {} });
  assert.ok(disconnected instanceof WindowsWSLHost);
  assert.equal((await disconnected.info()).runtime, "wsl_disconnected");
  const disconnectedCapabilities = await disconnected.capabilities();
  assert.ok(Object.values(disconnectedCapabilities).every(item => item.state === "unavailable"));
  assert.equal(disconnectedCapabilities.terminal.reason, "wsl_engine_not_connected");
});

test("WSL Host Protocol can advertise terminal only when the engine reports an implementation", async () => {
  const host = createHostAdapter({
    platform: "linux",
    env: { WSL_DISTRO_NAME: "DevMoter" },
    capabilities: { terminal: { state: "available", features: ["pty"] } }
  });
  assert.equal((await host.info()).platform, "windows");
  assert.deepEqual((await host.capabilities()).terminal.features, ["pty"]);
});

test("macOS adapter does not advertise Linux-only implementations as available", async () => {
  const host = createHostAdapter({ platform: "darwin", architecture: "arm64", env: {} });
  assert.ok(host instanceof MacOSHost);
  const capabilities = await host.capabilities();
  assert.ok(Object.values(capabilities).every(item => item.state === "unavailable"));
  assert.equal(capabilities.terminal.reason, "macos_adapter_not_implemented");
});

test("host protocol rejects unknown capabilities, invalid states, and unsafe response fields", () => {
  assert.throws(() => new DevMoterHost({
    platform: "linux",
    capabilities: { shellCommand: { state: "available" } }
  }), /Unknown host capability/);
  assert.throws(() => new DevMoterHost({
    platform: "linux",
    capabilities: { terminal: { state: "enabled" } }
  }), /Invalid host capability state/);
  assert.throws(() => new DevMoterHost({
    platform: "linux",
    capabilities: { terminal: { state: "unavailable" } }
  }), /requires a reason/);
  assert.throws(() => new DevMoterHost({
    platform: "linux",
    capabilities: { terminal: { state: "available", reason: "fallback" } }
  }), /cannot have an unavailable reason/);
  assert.throws(() => new DevMoterHost({
    platform: "linux",
    capabilities: { terminal: { state: "available", features: ["Bad Feature"] } }
  }), /Invalid host feature/);
});
