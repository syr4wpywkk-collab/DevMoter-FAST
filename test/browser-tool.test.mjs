import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserAutomationPolicy,
  browserAutomationStatus,
  createBrowserAutomation
} from "../server/browser-tool.mjs";

function fakeChild({ output = "", close = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  if (close) {
    process.nextTick(() => {
      if (output) child.stdout.write(output);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    });
  }
  return child;
}

function probe(command) {
  if (command === "chromium") return { status: 0, stdout: "Chromium 140.0" };
  if (command === "bwrap") return { status: 0, stdout: "bubblewrap 0.10.0" };
  return { status: 127, stdout: "" };
}

test("browser automation is explicit opt-in and advertises credential boundary", () => {
  const disabled = browserAutomationStatus({ env: {}, spawnSyncImpl: probe });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.available, false);
  assert.match(browserAutomationPolicy.credentials, /never mounts|personal browser/i);
  assert.match(browserAutomationPolicy.target, /loopback live preview/i);
});

test("browser automation only starts for an approved live preview and exposes stop state", async t => {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-browser-tool-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const spawns = [];
  const spawnImpl = (command, args) => {
    spawns.push({ command, args });
    const inspect = args.includes("--dump-dom");
    return fakeChild({ output: inspect ? "<html><body>ok</body></html>" : "", close: inspect });
  };
  const manager = createBrowserAutomation({
    configDir,
    resolveProject: async id => ({ id, path: "/tmp/devmoter-project", name: "Project" }),
    getPreview: id => id === "p1" ? { projectId: id, host: "127.0.0.1", port: 3000 } : null,
    env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: "required" },
    spawnImpl,
    spawnSyncImpl: probe
  });

  await assert.rejects(() => manager.start("missing"), /live preview/i);

  const started = await manager.start("p1");
  assert.equal(started.session.active, true);
  assert.equal(started.session.sandboxed, true);
  assert.equal(spawns[0].command, "bwrap");
  assert.ok(spawns[0].args.includes("--remote-debugging-port=0"));

  const inspected = await manager.inspect("p1");
  assert.match(inspected.content, /<body>ok<\/body>/);
  assert.equal(inspected.sandboxed, true);
  assert.ok(spawns[1].args.includes("--dump-dom"));

  await manager.stop("p1");
  assert.equal(manager.status("p1").session, null);
});

test("required browser sandbox fails closed when bwrap is missing", async t => {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-browser-required-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const spawnSyncImpl = command => {
    if (command === "chromium") return { status: 0, stdout: "Chromium" };
    return { status: 127, stdout: "" };
  };
  const manager = createBrowserAutomation({
    configDir,
    resolveProject: async id => ({ id, path: "/tmp/devmoter-project", name: "Project" }),
    getPreview: id => ({ projectId: id, host: "127.0.0.1", port: 3000 }),
    env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: "required" },
    spawnImpl: () => fakeChild(),
    spawnSyncImpl
  });

  await assert.rejects(() => manager.start("p1"), /sandbox is required.*unavailable/i);
});
