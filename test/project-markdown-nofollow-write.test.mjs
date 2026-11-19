import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { assertNoFollowSupported, writeFileNoFollow } from "../server/safe-file.mjs";

test("writeFileNoFollow creates and overwrites a regular file", async t => {
  const dir = await mkdtemp(join(tmpdir(), "md-nofollow-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "note.md");
  const created = await writeFileNoFollow(file, "one");
  assert.equal(created.size, 3);
  const updated = await writeFileNoFollow(file, "two");
  assert.equal(updated.size, 3);
  assert.equal(await readFile(file, "utf8"), "two");
});

test("writeFileNoFollow refuses a symlink and a dangling symlink", async t => {
  const dir = await mkdtemp(join(tmpdir(), "md-nofollow-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outside = join(dir, "outside.txt");
  await writeFile(outside, "secret");
  const link = join(dir, "note.md");
  await symlink(outside, link);
  await assert.rejects(writeFileNoFollow(link, "pwned"), error => error.code === "ELOOP");
  assert.equal(await readFile(outside, "utf8"), "secret");

  const dangling = join(dir, "missing.md");
  await symlink(join(dir, "does-not-exist.txt"), dangling);
  await assert.rejects(writeFileNoFollow(dangling, "pwned"), error => error.code === "ELOOP");
  await assert.rejects(readFile(join(dir, "does-not-exist.txt")), error => error.code === "ENOENT");
});

test("writeFileNoFollow refuses a non-regular final path", async t => {
  const dir = await mkdtemp(join(tmpdir(), "md-nofollow-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const nested = join(dir, "dir.md");
  await mkdir(nested);
  await assert.rejects(writeFileNoFollow(nested, "x"), error => error.code === "EISDIR" || error.code === "EINVAL");
});

test("no-follow writes fail closed when the platform lacks O_NOFOLLOW", () => {
  assert.throws(
    () => assertNoFollowSupported(0),
    error => error.code === "ENOTSUP" && error.statusCode === 501
  );
});

test("project markdown save uses the no-follow writer", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function projectWriteFile"), source.indexOf("async function projectGitStatus"));
  assert.match(body, /writeFileNoFollow\(/);
  assert.doesNotMatch(body, /writeFile\(/);
});

async function startMarkdownServer(t, { noFollow = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), "md-save-http-"));
  const project = join(home, "project");
  const config = join(home, ".config", "opencode-pocket");
  let child;
  let exit;
  t.after(async () => {
    if (child) child.kill("SIGKILL");
    try {
      await exit;
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  await mkdir(project);
  await mkdir(config, { recursive: true });
  await writeFile(join(config, "projects.json"), JSON.stringify({
    version: 1, projects: [{ id: "markdown-test", name: "Test project", path: project }]
  }));

  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));

  const args = [];
  if (!noFollow) {
    const fsWithoutNoFollow = "data:text/javascript," + encodeURIComponent(
      'import { constants } from "node:fs"; export const unavailable = { ...constants, O_NOFOLLOW: 0 }; export { unavailable as constants };'
    );
    const preload = `
      import { registerHooks } from "node:module";
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === "node:fs" && context.parentURL?.endsWith("/server/safe-file.mjs")) {
            return { url: ${JSON.stringify(fsWithoutNoFollow)}, shortCircuit: true };
          }
          return nextResolve(specifier, context);
        }
      });
    `;
    args.push("--import", "data:text/javascript," + encodeURIComponent(preload));
  }
  const password = "markdown-http-test-password";
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [...args, "server.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env, HOME: home, POCKET_HOST: "127.0.0.1", POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_markdown_test_codex__",
      DEVMOTER_PUBLIC_ORIGIN: origin, DEVMOTER_AUTH_USERNAME: "devmoter", DEVMOTER_AUTH_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  exit = once(child, "exit");
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Markdown server did not start: ${stderr}`)), 8000);
    child.stdout.setEncoding("utf8").on("data", chunk => {
      output += chunk;
      if (output.includes("DevMoter FAST:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    exit.then(([code]) => {
      clearTimeout(timeout);
      reject(new Error(`Markdown server exited (${code}): ${stderr}`));
    }, reject);
  });

  return {
    home,
    project,
    save(path, content) {
      return fetch(`${origin}/api/projects/markdown-test/file`, {
        method: "PUT",
        headers: {
          authorization: `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`,
          origin,
          "content-type": "application/json",
          "x-pocket-operation-id": randomUUID()
        },
        body: JSON.stringify({ path, content }),
        signal: AbortSignal.timeout(4000)
      });
    }
  };
}

test("HTTP Markdown save creates and replaces files but rejects symlinks", async t => {
  const { home, project, save } = await startMarkdownServer(t);
  for (const content of ["first draft", "final"]) {
    const response = await save("note.md", content);
    const saved = await response.json();
    assert.equal(response.status, 200, saved.error);
    assert.equal(saved.path, "note.md");
    assert.equal(saved.size, Buffer.byteLength(content));
    assert.equal(await readFile(join(project, "note.md"), "utf8"), content);
  }

  const outside = join(home, "outside.md");
  await writeFile(outside, "unchanged");
  await symlink(outside, join(project, "link.md"));
  const response = await save("link.md", "replacement");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /symlink/i);
  assert.equal(await readFile(outside, "utf8"), "unchanged");
});

test("HTTP Markdown save returns 501 without O_NOFOLLOW and does not create a file", async t => {
  const { project, save } = await startMarkdownServer(t, { noFollow: false });
  const response = await save("note.md", "first draft");
  assert.equal(response.status, 501);
  assert.match((await response.json()).error, /secure Markdown writes are not supported/i);
  await assert.rejects(readFile(join(project, "note.md")), { code: "ENOENT" });
});
