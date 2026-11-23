import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRemoteBrowserSandbox, createPreviewNavigationPolicy, startPreviewRelay } from "../server/browser-session.mjs";
import { readListenerIdentity } from "../server/listener-identity.mjs";

// Runs the real bubblewrap command the remote browser uses, with a probe in
// place of Chromium, to check what page content could reach at the OS level.
function sandboxWorks() {
  try {
    return spawnSync("bwrap", ["--die-with-parent", "--unshare-net", "--unshare-pid", "--ro-bind", "/", "/", "true"], { timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}

const usable = process.platform === "linux" && sandboxWorks();
const required = process.env.DEVMOTER_TEST_SANDBOX === "required";

const PROBE = `
const fs = require("node:fs");
const net = require("node:net");
const dns = require("node:dns");
const dgram = require("node:dgram");
const out = {};
const projectFile = process.env.PROBE_PROJECT + "/secret.txt";
try { fs.readFileSync(projectFile, "utf8"); out.readProject = "read"; } catch (error) { out.readProject = error.code; }
try { fs.writeFileSync(process.env.PROBE_PROJECT + "/pwned.txt", "x"); out.writeProject = "written"; } catch (error) { out.writeProject = error.code; }
try { fs.writeFileSync(process.cwd() + "/profile-ok.txt", "x"); out.writeProfile = "written"; } catch (error) { out.writeProfile = error.code; }
const tcp = (host, port) => new Promise(resolve => {
  const socket = net.connect({ host, port });
  socket.setTimeout(3000, () => { socket.destroy(); resolve("timeout"); });
  socket.on("connect", () => {
    socket.write("GET / HTTP/1.0\\r\\nHost: x\\r\\n\\r\\n");
    let body = "";
    socket.on("data", chunk => { body += chunk; });
    socket.on("end", () => resolve(body.includes("preview-ok") ? "preview" : body ? "other" : "empty"));
  });
  socket.on("error", error => resolve(error.code));
});
(async () => {
  out.preview = await tcp("127.0.0.1", Number(process.env.PROBE_PREVIEW_PORT));
  out.otherLoopback = await tcp("127.0.0.1", Number(process.env.PROBE_OTHER_PORT));
  out.external = await tcp("1.1.1.1", 443);
  out.dns = await new Promise(resolve => dns.lookup("example.com", error => resolve(error ? error.code : "resolved")));
  out.udp = await new Promise(resolve => {
    const socket = dgram.createSocket("udp4");
    socket.send("x", 3478, "8.8.8.8", error => { socket.close(); resolve(error ? error.code : "sent"); });
  });
  fs.writeSync(3, JSON.stringify(out));
  process.exit(0);
})();
`;

async function listen(body) {
  const server = createServer((req, res) => res.end(body));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

test("#706 #707 the remote browser sandbox cannot touch the project or any network but the preview", { skip: usable ? false : (required ? false : "bubblewrap cannot start a sandbox here") }, async t => {
  assert.ok(usable, "DEVMOTER_TEST_SANDBOX=required but bubblewrap cannot start a sandbox");
  const preview = await listen("preview-ok");
  const other = await listen("devmoter-api");
  const root = await mkdtemp(join(tmpdir(), "dm-sbx-"));
  const project = join(root, "project");
  const profileDir = join(root, "profile");
  const relayDir = join(root, "r");
  const binDir = join(root, "bin");
  for (const dir of [project, profileDir, relayDir, binDir]) spawnSync("mkdir", ["-p", dir]);
  await writeFile(join(project, "secret.txt"), "top secret");
  // The probe's directory is granted like Chromium's install dir, so it must not contain the project.
  const probe = join(binDir, "probe.cjs");
  await writeFile(probe, "#!" + process.execPath + "\n" + PROBE);
  await chmod(probe, 0o755);
  t.after(async () => {
    preview.close();
    other.close();
    await rm(root, { recursive: true, force: true });
  });
  const port = preview.address().port;
  const policy = createPreviewNavigationPolicy({ host: "127.0.0.1", port });
  const listener = readListenerIdentity("127.0.0.1", port);
  const relaySocket = join(relayDir, "s");
  const relay = await startPreviewRelay({ socketPath: relaySocket, host: policy.host, port, allow: () => readListenerIdentity("127.0.0.1", port) === listener });
  t.after(() => relay.close());
  const wrapped = buildRemoteBrowserSandbox({
    projectPath: project, profileDir, relaySocket, binary: probe, browserArgs: [], policy,
    env: { ...process.env, DEVMOTER_SANDBOX: "required" }
  });
  assert.equal(wrapped.command, "bwrap");
  const child = spawn(wrapped.command, wrapped.args, {
    cwd: profileDir,
    env: { PATH: process.env.PATH, PROBE_PROJECT: project, PROBE_PREVIEW_PORT: String(port), PROBE_OTHER_PORT: String(other.address().port) },
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  let report = "";
  child.stdio[3].on("data", chunk => { report += chunk; });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, stderr);
  const result = JSON.parse(report);
  t.diagnostic("sandbox probe: " + JSON.stringify(result));
  assert.equal(result.readProject, "ENOENT", "the project is not mounted");
  assert.notEqual(result.writeProject, "written");
  assert.equal(result.writeProfile, "written", "the ephemeral profile stays writable");
  assert.equal(await readFile(join(project, "secret.txt"), "utf8"), "top secret");
  assert.equal(result.preview, "preview", "the approved preview is reachable through the relay");
  assert.notEqual(result.otherLoopback, "other", "other host loopback ports are unreachable");
  assert.ok(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "timeout", "empty"].includes(result.otherLoopback), result.otherLoopback);
  assert.ok(["ENETUNREACH", "EHOSTUNREACH", "timeout"].includes(result.external), result.external);
  assert.notEqual(result.dns, "resolved");
  assert.notEqual(result.udp, "sent");
});
