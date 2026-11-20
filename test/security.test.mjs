import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInsideHome, normalizeNewProjectPath, sanitizeUploadName, createUploadPath, decodeUploadDataUrl, assertSafeMarkdownRelativePath, isAllowedCodexRpc, codexRpcAuthorityOverride } from "../server/security-helpers.mjs";

test("project paths stay inside HOME and exclude HOME itself", () => {
  const home = "/home/tester";
  assert.equal(normalizeNewProjectPath("/home/tester/project", home), "/home/tester/project");
  assert.throws(() => normalizeNewProjectPath("/tmp/project", home), /inside your home/);
  assert.throws(() => normalizeNewProjectPath("/home/tester/../other", home), /inside your home/);
  assert.throws(() => normalizeNewProjectPath(home, home), /whole home/);
  assert.equal(isInsideHome(home, "/home/tester/a/b"), true);
  assert.equal(isInsideHome(home, "/home/tester2"), false);
});

test("resolved project symlinks cannot cross the HOME boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "pocket-security-"));
  const home = join(root, "home");
  const outside = join(root, "outside");
  await mkdir(home);
  await mkdir(outside);
  const link = join(home, "linked-project");
  await symlink(outside, link, "dir");
  try {
    assert.equal(isInsideHome(home, link), true, "lexical check alone is not enough");
    assert.equal(isInsideHome(home, await realpath(link)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upload names cannot escape the upload directory", () => {
  const safe = sanitizeUploadName("../../etc/passwd");
  assert.equal(safe, "_.._etc_passwd");
  const result = createUploadPath("/tmp/uploads", "../../etc/passwd");
  assert.match(result.path, /^\/tmp\/uploads\/\d+-[0-9a-f-]{36}-_\.\._etc_passwd$/);
  assert.equal(decodeUploadDataUrl("data:text/plain;base64,SGk=").buffer.toString(), "Hi");
  assert.throws(() => decodeUploadDataUrl("not-a-data-url"), /base64 data URL/);
  assert.throws(() => decodeUploadDataUrl(`data:text/plain;base64,${Buffer.alloc(16).toString("base64")}`, 15), /larger/);
});

test("Codex RPC requests are constrained to the explicit allowlist", () => {
  assert.equal(isAllowedCodexRpc("thread/list"), true);
  assert.equal(isAllowedCodexRpc("turn/start"), true);
  assert.equal(isAllowedCodexRpc("shell/exec"), false);
  assert.equal(isAllowedCodexRpc({ toString: () => "thread/list" }), false);
});


test("Codex thread creation resolves project ids server-side", async () => {
  const [client, server] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8")
  ]);

  assert.match(client, /params\.projectId = activeProject\.id/);
  assert.doesNotMatch(client, /params\.cwd = activeProject\.path/);
  assert.match(server, /codexRpcAuthorityOverride\(method, params\)/);
  assert.equal(codexRpcAuthorityOverride("thread/start", { cwd: "/tmp" }), "cwd");
  assert.equal(codexRpcAuthorityOverride("turn/start", { threadId: "t", sandboxPolicy: {} }), "sandboxPolicy");
  assert.equal(codexRpcAuthorityOverride("thread/resume", { threadId: "t", approvalPolicy: "never" }), "approvalPolicy");
  assert.equal(codexRpcAuthorityOverride("thread/fork", { threadId: "t", config: {} }), "config");
  assert.equal(codexRpcAuthorityOverride("turn/start", { threadId: "t", input: [], model: "m" }), null);
  assert.equal(codexRpcAuthorityOverride("model/list", { cwd: "/tmp" }), null);
  assert.match(server, /nextParams\.cwd = project\.path/);
});

test("generated OpenCode operation ids take precedence over caller headers", async () => {
  const [{ DICTIONARIES }, source] = await Promise.all([
    import("../src/i18n-core.mjs"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);
  const start = source.indexOf("headers: {", source.indexOf("async function api"));
  const end = source.indexOf("},", start);
  const block = source.slice(start, end);
  assert.ok(block.indexOf("...(init.headers || {})") >= 0);
  assert.ok(block.indexOf("x-pocket-operation-id") > block.indexOf("...(init.headers || {})"));
  assert.match(source, /t\("opencode\.errors\.duplicate"/);
  assert.match(DICTIONARIES.en["opencode.errors.duplicate"], /earlier outcome is unknown/);
});

test("Markdown paths fail closed on absolute, traversal, Windows, and NUL input", () => {
  assert.equal(assertSafeMarkdownRelativePath("notes/readme.md"), "notes/readme.md");
  assert.equal(assertSafeMarkdownRelativePath("./notes/readme.md"), "notes/readme.md");
  for (const unsafe of ["/tmp/secret.md", "//host/file.md", "../escape.md", "notes/../../escape.md",
    "..\\escape.md", "C:\\Users\\secret.md", "notes\\file.md", "notes/evil\u0000.md", ""]) {
    assert.throws(() => assertSafeMarkdownRelativePath(unsafe), /Invalid Markdown path/);
  }
});

test("upload decoder rejects oversized base64 before allocating decoded data", () => {
  const raw = Buffer.alloc(256).toString("base64");
  assert.throws(() => decodeUploadDataUrl("data:application/octet-stream;base64," + raw, 64), /larger/);
  assert.throws(() => decodeUploadDataUrl("data:text/plain;base64,###", 64), /base64 data URL/);
  assert.throws(() => decodeUploadDataUrl("data:text/plain;base64,A", 64), /base64 data URL/);
  assert.throws(() => decodeUploadDataUrl("data:text/plain;base64,SGk= extra", 64), /base64 data URL/);
  assert.throws(() => decodeUploadDataUrl("data:text/plain;base64,SGk=", -1), /Invalid upload size limit/);
  assert.equal(decodeUploadDataUrl("data:text/plain;base64,SGk=", 2).buffer.toString(), "Hi");
});

test("read-only dev-workflow agent turns run in the Codex read-only sandbox", async () => {
  const source = await readFile(new URL("../server/dev-workflows.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(readOnly\) Object\.assign\(params, \{ sandbox: "read-only", approvalPolicy: "on-request" \}\)/);
});
