import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child, timeoutMs = 30000) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DevMoter did not become ready: ${output}`)), timeoutMs);
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes("DevMoter FAST:")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`DevMoter exited early with code ${code}: ${output}`));
    });
  });
}

function rawGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

// #771: sessions run in their project's directory, and OpenCode publishes
// events per directory, so the browser stream must cover every project.
test("OpenCode event stream merges OPENCODE_DIRECTORY and registered project directories", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "devmoter-opencode-events-")));
  const defaultDir = join(home, "default");
  const projectDir = join(home, "project");
  await mkdir(defaultDir);
  await mkdir(projectDir);
  await mkdir(join(home, ".config", "opencode-pocket"), { recursive: true });
  await writeFile(join(home, ".config", "opencode-pocket", "projects.json"), JSON.stringify({
    version: 1,
    projects: [
      { id: "p-default", name: "default", path: defaultDir, addedAt: 1 },
      { id: "p-project", name: "project", path: projectDir, addedAt: 2 },
      { id: "p-gone", name: "gone", path: join(home, "gone"), addedAt: 3 }
    ]
  }));
  const authPassword = "event-directories-password-123";
  const fixture = JSON.parse(await readFile(new URL("./fixtures/opencode/opencode-v1.19.5.json", import.meta.url), "utf8"));

  const eventDirectories = [];
  const openCode = http.createServer((req, res) => {
    if (req.url === "/event") {
      const directory = String(req.headers["x-opencode-directory"] || "");
      eventDirectories.push(directory);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = { type: "session.updated", properties: { sessionID: `ses_${eventDirectories.length}`, info: { id: `ses_${eventDirectories.length}`, title: directory } } };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (directory === defaultDir) setTimeout(() => res.end(), 300);
      else res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(fixture[req.url] ?? { ok: true, path: req.url }));
  });
  openCode.listen(0, "127.0.0.1");
  await once(openCode, "listening");

  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: `http://127.0.0.1:${openCode.address().port}`,
      OPENCODE_DIRECTORY: defaultDir,
      CODEX_CWD: defaultDir,
      DEVMOTER_AUTH_PASSWORD: authPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);
    const response = await rawGet(port, "/api/opencode/event", {
      authorization: `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`,
      origin: `http://127.0.0.1:${port}`,
      accept: "text/event-stream"
    });
    assert.equal(response.status, 200, response.body);
    assert.deepEqual([...eventDirectories].sort(), [defaultDir, projectDir].sort());
    const titles = response.body.split("\n")
      .filter(line => line.startsWith("data: "))
      .map(line => JSON.parse(line.slice(6)).properties?.info?.title);
    assert.deepEqual([...titles].sort(), [defaultDir, projectDir].sort());
  } finally {
    child.kill();
    openCode.close();
    await rm(home, { recursive: true, force: true });
  }
});
