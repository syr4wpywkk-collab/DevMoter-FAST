import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

// Run server.mjs from a checkout view that has no dist/ at all, so the test
// proves the login page does not depend on `npm run build`.
async function checkoutWithoutDist() {
  const root = await mkdtemp(join(tmpdir(), "devmoter-no-dist-"));
  for (const entry of await readdir(repoRoot)) {
    if (entry === "dist" || entry === ".git") continue;
    await symlink(join(repoRoot, entry), join(root, entry));
  }
  return root;
}

test("login page and script are served before auth even when dist/ was never built", async t => {
  const root = await checkoutWithoutDist();
  const home = await mkdtemp(join(tmpdir(), "devmoter-no-dist-home-"));
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, "server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: "http://127.0.0.1:9",
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: "login-no-dist-password-123",
      DEVMOTER_PASSKEY_REQUIRED: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.resume();
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server not ready: ${output}`)), 10_000);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("DevMoter FAST:")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  const origin = `http://127.0.0.1:${port}`;

  const script = await fetch(`${origin}/login.js`, { redirect: "manual" });
  assert.equal(script.status, 200);
  assert.match(String(script.headers.get("content-type")), /javascript/);
  assert.equal(script.headers.get("cache-control"), "no-store");
  assert.equal(await script.text(), await readFile(join(repoRoot, "public", "login.js"), "utf8"));

  const page = await fetch(`${origin}/login.html`, { redirect: "manual" });
  assert.equal(page.status, 200);
  assert.match(String(page.headers.get("content-type")), /text\/html/);
  assert.match(await page.text(), /<script src="\/login\.js" defer><\/script>/);

  const head = await fetch(`${origin}/login.js`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  // Everything else still requires auth.
  assert.equal((await fetch(`${origin}/`, { redirect: "manual" })).status, 302);
  assert.equal((await fetch(`${origin}/api/health`)).status, 401);
  assert.equal((await fetch(`${origin}/login.js`, { method: "POST" })).status, 401);
});
