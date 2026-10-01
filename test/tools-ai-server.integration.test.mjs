import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createProjectIndex } from "../server/project-index.mjs";
const exec = promisify(execFile);
const listen = async server => { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port; };
const repoRoot = new URL("..", import.meta.url).pathname;
const password = "tools-ai-integration-only-password";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;

test("authenticated Tools AI HTTP uses actual project helpers, bounded provider transport, and persistent state", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ai-http-"));
  const requests = [];
  const provider = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); requests.push(payload);
    const goal = payload.messages.at(-1).content;
    let content;
    if (payload.messages[0].content.includes("ONE")) {
      let proposal = { operationId: "git.inspect", input: {} };
      if (goal.includes("認証")) proposal = { operationId: "project.search", input: { query: "authenticate" } };
      if (goal.includes("構成")) proposal = { operationId: "project.map", input: {} };
      if (goal.includes("README")) proposal = { operationId: "doc.read", input: { path: goal.includes("escape") ? "../outside.md" : goal.includes("symlink") ? "outside.md" : goal.includes("alias") ? "alias.md" : goal.includes("fifo") ? "pipe.md" : "README.md" } };
      if (goal.includes("接続")) proposal = { operationId: "diagnostics.read", input: {} };
      content = goal.includes("malformed") ? "{broken" : JSON.stringify(proposal);
    } else content = JSON.stringify({ factIds: JSON.parse(goal).facts.slice(0, 4).map(f => f.id) });
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  let child; let output = "";
  try {
    const providerPort = await listen(provider);
    const probe = createServer(); const port = await listen(probe); await new Promise(r => probe.close(r));
    const origin = `http://127.0.0.1:${port}`;
    const project = { id: "fixture-project", name: "Real project", path: join(root, "project") };
    await mkdir(project.path); await mkdir(join(root, ".config", "opencode-pocket"), { recursive: true });
    await writeFile(join(root, ".config", "opencode-pocket", "projects.json"), JSON.stringify({ projects: [project] }));
    await exec("git", ["init", "-q"], { cwd: project.path });
    await writeFile(join(project.path, "README.md"), "# Example\nStart with npm start\n");
    await writeFile(join(project.path, "auth.ts"), "export function authenticate() { return true; }\n");
    await exec("git", ["add", "."], { cwd: project.path });
    await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], { cwd: project.path });
    await writeFile(join(project.path, "auth.ts"), "export function authenticate() { return false; }\nconst API_KEY = 'fixture-hidden-credential';\n");
    const index = createProjectIndex({ stateDir: join(root, ".local", "state", "opencode-pocket", "project-indexes"), resolveProject: async () => project });
    const built = await index.rebuild(project.id);
    await writeFile(join(root, "outside.md"), "outside must not be read"); await symlink(join(root, "outside.md"), join(project.path, "outside.md"));
    await symlink(join(project.path, "auth.ts"), join(project.path, "alias.md"));
    await exec("mkfifo", [join(project.path, "pipe.md")]);
    child = spawn(process.execPath, ["server.mjs"], { cwd: repoRoot, env: { ...process.env,
      HOME: root, POCKET_HOST: "127.0.0.1", POCKET_PORT: String(port), DEVMOTER_AUTH_PASSWORD: password,
      CODEX_BIN: "__tools_ai_missing_codex__", OPENCODE_URL: "http://127.0.0.1:1",
      TOOLS_AI_FIXTURE_KEY: "fixture-provider-key",
      DEVMOTER_LLM_PROVIDERS_JSON: JSON.stringify([{ id: "fixture", name: "Fixture model", protocol: "openai-compatible", baseUrl: `http://127.0.0.1:${providerPort}/v1`, apiKeyEnv: "TOOLS_AI_FIXTURE_KEY", models: ["fixture-model"] }]) }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", c => { output += c; }); child.stderr.on("data", c => { output += c; });
    for (let i = 0; i < 200 && !output.includes("DevMoter FAST:"); i++) await new Promise(r => setTimeout(r, 20));
    assert.match(output, /DevMoter FAST:/);
    const request = async (path, body) => {
      const response = await fetch(origin + path, { method: body ? "POST" : "GET", headers: { authorization, origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await fetch(origin + "/api/tools-ai/context")).status, 401);
    assert.equal((await fetch(origin + "/api/tools-ai/runs", { method: "POST", headers: { authorization, origin: "https://wrong.invalid" }, body: "{}" })).status, 403);
    const context = await request("/api/tools-ai/context"); assert.equal(context.status, 200, JSON.stringify(context.data)); assert.equal(context.data.providers[0].ready, true);
    assert.equal(context.data.catalog.filter(o => o.status === "supported").length, 1);
    const observe = async (goal, requestId) => {
      const started = await request("/api/tools-ai/runs", { goal, projectId: project.id, providerId: "fixture", model: "fixture-model", requestId });
      assert.equal(started.status, 202, JSON.stringify(started.data));
      let run;
      for (let i = 0; i < 300; i++) {
        run = (await request(`/api/tools-ai/runs/${started.data.runId}`)).data;
        if (["completed", "failed"].includes(run.status)) break;
        await new Promise(r => setTimeout(r, 20));
      }
      return run;
    };
    for (const [goal, type] of [["今の変更を調べて", "git"], ["認証処理を探して", "search"], ["プロジェクト構成を教えて", "map"], ["READMEから起動方法を教えて", "document"], ["接続できない理由を調べて", "diagnostics"]]) {
      const run = await observe(goal, `request-${type}`);
      assert.equal(run.status, "completed", JSON.stringify(run)); assert.equal(run.steps[0].result.type, type);
      assert.equal(run.context.project.id, project.id);
      if (type === "git") { assert.ok(run.steps[0].result.data.files.files.some(f => f.path === "auth.ts")); assert.equal(run.steps[0].result.sharing.excluded, true); }
      if (["search", "map"].includes(type)) assert.equal(run.steps[0].result.builtAt, built.builtAt);
      if (type === "document") assert.match(run.steps[0].result.data.content, /npm start/);
    }
    const bad = await observe("malformed", "bad-json-request"); assert.equal(bad.status, "failed"); assert.equal(bad.steps.length, 0);
    const escape = await observe("README escape", "escape-request"); assert.equal(escape.status, "failed"); assert.equal(escape.steps.length, 0);
    const escapedLink = await observe("README symlink", "symlink-request"); assert.equal(escapedLink.status, "failed"); assert.match(escapedLink.failure, /escapes/);
    const aliasedCode = await observe("README alias", "alias-request"); assert.equal(aliasedCode.status, "failed"); assert.match(aliasedCode.failure, /also be .md/);
    const fifo = await observe("README fifo", "fifo-request"); assert.equal(fifo.status, "failed"); assert.match(fifo.failure, /regular file/);
    const duplicate = await request("/api/tools-ai/runs", { goal: "今の変更を調べて", projectId: project.id, providerId: "fixture", model: "fixture-model", requestId: "request-git" });
    assert.equal(duplicate.status, 409); assert.equal(duplicate.data.outcome, "completed");
    const reconciled = await request("/api/tools-ai/requests/request-git"); assert.equal(reconciled.data.status, "completed");
    assert.equal((await request("/api/tools-ai/requests/unknown-request")).status, 404);
    assert.ok(!JSON.stringify(requests).includes("fixture-hidden-credential"));
    const persisted = await readFile(join(root, ".config", "opencode-pocket", "tools-ai-runs.json"), "utf8");
    assert.ok(!persisted.includes("fixture-hidden-credential"));
  } finally {
    if (child && child.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; }
    await new Promise(r => provider.close(r)); await rm(root, { recursive: true, force: true });
  }
});
