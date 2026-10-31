import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const password = "pwa-public-assets-password-123";

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function startServer() {
  const home = await mkdtemp(join(tmpdir(), "devmoter-pwa-public-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: "http://127.0.0.1:9",
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password,
      DEVMOTER_PASSKEY_REQUIRED: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.resume();
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server not ready: ${output}`)), 10_000);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("DevMoter FAST:")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      await rm(home, { recursive: true, force: true });
    }
  };
}

// Raw request so paths like /sw.js/../index.html reach the server unnormalized.
function rawGet(port, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("PWA files are served without login, and nothing else is", async t => {
  const server = await startServer();
  t.after(() => server.stop());

  // A credential-less manifest fetch (what browsers do) gets the real JSON, not the login page.
  const manifest = await rawGet(server.port, "/manifest.webmanifest");
  assert.equal(manifest.status, 200);
  assert.match(String(manifest.headers["content-type"]), /application\/manifest\+json/);
  const parsed = JSON.parse(manifest.body);
  assert.equal(parsed.short_name, "DevMoter");
  assert.doesNotMatch(manifest.body, /<html/i);

  for (const icon of parsed.icons) {
    const response = await rawGet(server.port, icon.src);
    assert.equal(response.status, 200, `${icon.src} must be public`);
    assert.match(String(response.headers["content-type"]), /image\/svg\+xml/);
  }

  const worker = await rawGet(server.port, "/sw.js");
  assert.equal(worker.status, 200);
  assert.match(String(worker.headers["content-type"]), /javascript/);
  assert.match(worker.body, /addEventListener\("fetch"/);

  const head = await rawGet(server.port, "/manifest.webmanifest", "HEAD");
  assert.equal(head.status, 200);

  // Everything else still needs auth: pages redirect to login, APIs answer 401.
  for (const path of [
    "/",
    "/index.html",
    "/licenses/marked.txt",
    "/qr/claude-code.png",
    "/sw.js/../index.html",
    "/manifest.webmanifest/../index.html",
    "/%2e%2e/index.html",
    "/icon.svg/",
    "/MANIFEST.WEBMANIFEST",
    "/manifest.webmanifest.bak"
  ]) {
    const response = await rawGet(server.port, path);
    assert.ok([302, 400, 401, 404].includes(response.status), `${path} must not be public (got ${response.status})`);
    assert.notEqual(response.status, 200, `${path} must not be public`);
  }
  for (const path of ["/api/health", "/api/projects", "/api/codex/health", "/api/settings", "/api/manifest.webmanifest"]) {
    const response = await rawGet(server.port, path);
    assert.equal(response.status, 401, `${path} must require auth`);
  }
  const postWorker = await rawGet(server.port, "/sw.js", "POST");
  assert.equal(postWorker.status, 401, "only GET/HEAD of public files skip auth");

  const authorized = await fetch(`${server.origin}/api/health`, {
    headers: { authorization: `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}` }
  });
  assert.equal(authorized.status, 200);
});
