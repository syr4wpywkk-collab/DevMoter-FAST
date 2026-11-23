import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  browserAutomationPolicy,
  binaryGrant,
  sandboxedBinaryPath,
  resolveExecutable,
  browserAutomationStatus,
  createBrowserAutomation
} from "../server/browser-tool.mjs";

function fakeChild({ output = "", close = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    process.nextTick(() => { child.emit("exit", null, "SIGTERM"); child.emit("close", null, "SIGTERM"); });
    return true;
  };
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
  assert.ok(spawns[0].args.includes("--remote-debugging-pipe"));
  assert.equal(spawns[0].args.some(arg => arg.startsWith("--remote-debugging-port")), false);
  assert.ok(spawns[0].args.includes("--proxy-server=http://127.0.0.1:1"));
  assert.equal(spawns[0].args.includes("--no-proxy-server"), false);

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

test("legacy browser tool mounts a project-local Chromium read-only inside the sandbox", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-browser-local-bin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, "project", ".browsers", "chromium");
  await mkdir(binDir, { recursive: true });
  const binary = join(binDir, "chrome");
  await writeFile(binary, "#!/bin/sh\n");
  await chmod(binary, 0o755);
  const spawns = [];
  const manager = createBrowserAutomation({
    configDir: join(root, "config"),
    resolveProject: async id => ({ id, path: join(root, "project"), name: "Project" }),
    getPreview: id => ({ projectId: id, host: "127.0.0.1", port: 3000 }),
    env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: "required", DEVMOTER_BROWSER_BIN: binary },
    spawnImpl: (command, args) => {
      spawns.push({ command, args });
      return fakeChild();
    },
    spawnSyncImpl: command => command === "bwrap" ? { status: 0, stdout: "bubblewrap 0.10.0" } : command === binary ? { status: 0, stdout: "Chromium 140.0" } : { status: 127, stdout: "" }
  });
  await manager.start("p1");
  const args = spawns[0].args;
  const mount = args.findIndex((value, index) => value === "--ro-bind" && args[index + 1] === binDir);
  assert.ok(mount >= 0, "the binary's directory is mounted read-only");
  assert.ok(!args.some((value, index) => (value === "--bind" || value === "--ro-bind") && args[index + 1] === join(root, "project")), "the project itself stays unmounted");
  assert.equal(args[args.indexOf("--") + 1], binary);
  await manager.stop("p1");
});

test("a browser binary reached through a symlink runs at its mounted real path", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-chrome-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const realDir = join(root, "real", "chromium");
  await mkdir(realDir, { recursive: true });
  await writeFile(join(realDir, "chrome"), "#!/bin/sh\n");
  await chmod(join(realDir, "chrome"), 0o755);
  await mkdir(join(root, "links"));
  const link = join(root, "links", "chrome");
  await symlink(join(realDir, "chrome"), link);
  const real = realpathSync(join(realDir, "chrome"));
  assert.equal(sandboxedBinaryPath(link, {}), real);
  assert.equal(sandboxedBinaryPath("/usr/bin/chromium", {}), "/usr/bin/chromium", "system binaries keep their own path");
  const spawns = [];
  const manager = createBrowserAutomation({
    configDir: join(root, "config"),
    resolveProject: async id => ({ id, path: join(root, "project"), name: "Project" }),
    getPreview: id => ({ projectId: id, host: "127.0.0.1", port: 3000 }),
    env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: "required", DEVMOTER_BROWSER_BIN: link },
    spawnImpl: (command, args) => {
      spawns.push({ command, args });
      return fakeChild();
    },
    spawnSyncImpl: command => command === "bwrap" ? { status: 0, stdout: "bubblewrap 0.10.0" } : command === link ? { status: 0, stdout: "Chromium 140.0" } : { status: 127, stdout: "" }
  });
  await manager.start("p1");
  const args = spawns[0].args;
  assert.equal(args[args.indexOf("--") + 1], real);
  await manager.stop("p1");
});

test("a non-executable file earlier on PATH does not shadow the browser", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-chrome-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  await writeFile(join(root, "a", "chromium"), "not a program\n");
  await writeFile(join(root, "b", "chromium"), "#!/bin/sh\n");
  await chmod(join(root, "b", "chromium"), 0o755);
  const env = { PATH: [join(root, "a"), join(root, "b")].join(":") };
  assert.equal(resolveExecutable("chromium", env), realpathSync(join(root, "b", "chromium")));
  assert.equal(resolveExecutable("chromium", { PATH: join(root, "a") }), null);
});

test("a browser binary directly in a temp or home directory is refused, not mounted", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-chrome-dir-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "chrome"), "#!/bin/sh\n");
  await chmod(join(dir, "chrome"), 0o755);
  assert.deepEqual(binaryGrant(join(dir, "chrome"), {}), { path: realpathSync(dir), mode: "read-only" });
  assert.throws(() => binaryGrant(join(dir, "chrome"), { TMPDIR: dir }), /own directory/);
  assert.throws(() => binaryGrant(join(dir, "chrome"), { HOME: dir }), /own directory/);
});
