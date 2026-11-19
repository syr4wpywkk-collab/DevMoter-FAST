import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DevMoterClient, sdkInternals } from "../sdk/index.mjs";
import {
  EXIT,
  fixedBrowserCommand,
  main,
  parseArgs,
  validateBrowserUrl
} from "../cli/devmoter.mjs";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../cli/devmoter.mjs", import.meta.url));

test("SDK uses Basic auth, same-origin mutation headers, and operation ids", async () => {
  const calls = [];
  const client = new DevMoterClient({
    baseUrl: "http://127.0.0.1:8787",
    username: "devmoter",
    password: "0123456789abcdef",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await client.projects();
  await client.runTask({
    project: "p1",
    agent: "build",
    backend: "opencode",
    task: "test"
  }, { operationId: "op-fixed" });

  const getHeaders = new Headers(calls[0].init.headers);
  const postHeaders = new Headers(calls[1].init.headers);
  assert.match(getHeaders.get("authorization") || "", /^Basic /);
  assert.equal(getHeaders.get("origin"), null);
  assert.match(postHeaders.get("authorization") || "", /^Basic /);
  assert.equal(postHeaders.get("origin"), "http://127.0.0.1:8787");
  assert.equal(postHeaders.get("x-pocket-operation-id"), "op-fixed");
  assert.equal(
    Buffer.from((postHeaders.get("authorization") || "").slice(6), "base64").toString("utf8"),
    "devmoter:0123456789abcdef"
  );
});

test("SDK refuses insecure non-loopback HTTP targets and URL credentials", () => {
  assert.throws(
    () => new DevMoterClient({ baseUrl: "http://example.test:8787" }),
    /requires HTTPS/
  );
  assert.throws(
    () => new DevMoterClient({ baseUrl: "https://user:pass@example.test" }),
    /embed DevMoter credentials/
  );
  assert.doesNotThrow(
    () => new DevMoterClient({ baseUrl: "https://example.test" })
  );
});

test("CLI no longer exposes bearer token options", () => {
  const parsed = parseArgs([
    "task",
    "--project", "p",
    "--agent", "build",
    "--task", "run",
    "--password-file", "/tmp/devmoter-password"
  ]);
  assert.equal(parsed.options["password-file"], "/tmp/devmoter-password");
  assert.equal(parsed.options.token, undefined);
});

test("SDK helper classifies mutation methods", () => {
  assert.equal(sdkInternals.isMutation("GET"), false);
  assert.equal(sdkInternals.isMutation("HEAD"), false);
  assert.equal(sdkInternals.isMutation("POST"), true);
});

test("SDK rejects cross-origin, dot-segment, and encoded traversal request paths and disables redirects", async () => {
  const calls = [];
  const client = new DevMoterClient({
    baseUrl: "https://devmoter.example/control",
    password: "0123456789abcdef",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  for (const unsafe of [
    "//attacker.example/api/health",
    "https://attacker.example/api/health",
    "/api/../secret",
    "/api/%2e%2e/secret",
    "/api/%252e%252e/secret",
    "/api/projects/%2f/context",
    "/api\\evil"
  ]) {
    await assert.rejects(() => client.request(unsafe), /Invalid DevMoter request path/, unsafe);
  }
  assert.equal(calls.length, 0);

  await client.health();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://devmoter.example/control/api/health");
  assert.equal(calls[0].init.redirect, "error");
});

function createIo() {
  let out = "";
  let err = "";
  return {
    stdout: { write(chunk) { out += String(chunk); } },
    stderr: { write(chunk) { err += String(chunk); } },
    readOut() { return out; },
    readErr() { return err; }
  };
}

function mockOpenFetch(payload) {
  return async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("validateBrowserUrl accepts same-origin absolute and relative http(s) URLs", () => {
  assert.equal(
    validateBrowserUrl("http://127.0.0.1:8787/?project=p1", "http://127.0.0.1:8787/"),
    "http://127.0.0.1:8787/?project=p1"
  );
  assert.equal(
    validateBrowserUrl("https://devmoter.example/?project=p1", new URL("https://devmoter.example/control/")),
    "https://devmoter.example/?project=p1"
  );
  assert.equal(
    validateBrowserUrl("/?project=p1", new URL("https://devmoter.example/control/")),
    "https://devmoter.example/?project=p1"
  );
  assert.equal(
    validateBrowserUrl("workspace?project=p1", new URL("https://devmoter.example/control/")),
    "https://devmoter.example/control/workspace?project=p1"
  );
});

test("validateBrowserUrl rejects unsafe schemes, cross-origin URLs, and values beginning with '-'", () => {
  const base = new URL("https://devmoter.example/control/");
  for (const unsafe of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "custom+scheme://open/p1",
    "vscode://file/etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://devmoter.example/123",
    "https://evil.example/",
    "http://devmoter.example/?project=p1",
    "https://devmoter.example:8443/?project=p1",
    "//evil.example/path",
    "///evil.example/path",
    "/\\evil.example/path",
    "https:evil.example",
    "http:evil.example",
    "https://user:pass@devmoter.example/",
    "-flag",
    "--browser",
    " -flag",
    "-/etc/passwd",
    "java\tscript:alert(1)",
    "https://devmoter.example/\n--flag",
    "",
    "   ",
    null,
    undefined
  ]) {
    assert.throws(
      () => validateBrowserUrl(unsafe, base),
      /Invalid browser launch URL|Server returned an (?:invalid|empty) browser launch URL/,
      String(unsafe)
    );
  }

  assert.throws(
    () => validateBrowserUrl("http://localhost:8787/?project=p1", "http://127.0.0.1:8787/"),
    /origin http:\/\/localhost:8787 does not match http:\/\/127\.0\.0\.1:8787/
  );
  assert.throws(
    () => validateBrowserUrl("https://devmoter.example/", "ftp://devmoter.example/"),
    /Invalid DevMoter base URL/
  );
});

test("fixedBrowserCommand validates URLs and builds platform commands", () => {
  assert.throws(
    () => fixedBrowserCommand("javascript:alert(1)", "https://devmoter.example/", "linux"),
    /only http and https URLs are allowed/
  );
  assert.deepEqual(
    fixedBrowserCommand("/?project=p1", "https://devmoter.example/control/", "linux"),
    ["xdg-open", ["https://devmoter.example/?project=p1"]]
  );
  assert.deepEqual(
    fixedBrowserCommand("/?project=p1", "https://devmoter.example/control/", "darwin"),
    ["open", ["https://devmoter.example/?project=p1"]]
  );
  assert.deepEqual(
    fixedBrowserCommand("/?project=p1", "https://devmoter.example/control/", "win32"),
    ["rundll32", ["url.dll,FileProtocolHandler", "https://devmoter.example/?project=p1"]]
  );
});

test("CLI open --browser rejects unsafe server URLs without launching or printing", async () => {
  const rejectedInputs = [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "devmoter+custom://open/p1",
    "https://evil.example/",
    "-flag",
    "--open"
  ];

  for (const unsafeUrl of rejectedInputs) {
    const io = createIo();
    const spawns = [];
    const code = await main(["open", "p1", "--browser", "--url", "https://devmoter.example"], {
      env: { DEVMOTER_AUTH_PASSWORD: "0123456789abcdef" },
      fetchImpl: mockOpenFetch({
        apiVersion: 1,
        project: { id: "p1", name: "Demo" },
        url: unsafeUrl
      }),
      spawnImpl: (bin, args, opts) => {
        spawns.push({ bin, args, opts });
        return { unref() {} };
      },
      stdout: io.stdout,
      stderr: io.stderr,
      platform: "linux"
    });

    assert.equal(code, EXIT.SERVER, unsafeUrl);
    assert.equal(spawns.length, 0, "browser must not launch for " + unsafeUrl);
    assert.equal(io.readOut(), "", "stdout must remain empty on rejection for " + unsafeUrl);
    assert.match(io.readErr(), /browser launch URL/i, unsafeUrl);
  }

  const nonBrowserIo = createIo();
  const nonBrowserCode = await main(["open", "p1", "--url", "https://devmoter.example"], {
    env: { DEVMOTER_AUTH_PASSWORD: "0123456789abcdef" },
    fetchImpl: mockOpenFetch({ url: "https://evil.example/" }),
    spawnImpl: () => { throw new Error("must not spawn"); },
    stdout: nonBrowserIo.stdout,
    stderr: nonBrowserIo.stderr
  });
  assert.equal(nonBrowserCode, EXIT.SERVER);
  assert.equal(nonBrowserIo.readOut(), "");
  assert.match(nonBrowserIo.readErr(), /does not match/);
});

test("CLI open accepts valid same-origin and relative http(s) URLs for printing and launching", async () => {
  for (const [baseUrl, serverUrl, expected] of [
    ["https://devmoter.example", "https://devmoter.example/?project=p1", "https://devmoter.example/?project=p1"],
    ["http://127.0.0.1:8787", "http://127.0.0.1:8787/?project=p1", "http://127.0.0.1:8787/?project=p1"],
    ["https://devmoter.example/control", "/?project=p1", "https://devmoter.example/?project=p1"]
  ]) {
    const io = createIo();
    const spawns = [];
    let unrefCalled = false;
    const code = await main(["open", "p1", "--browser", "--url", baseUrl], {
      env: { DEVMOTER_AUTH_PASSWORD: "0123456789abcdef" },
      fetchImpl: mockOpenFetch({
        apiVersion: 1,
        project: { id: "p1", name: "Demo" },
        url: serverUrl
      }),
      spawnImpl: (bin, args, opts) => {
        spawns.push({ bin, args, opts });
        return { unref() { unrefCalled = true; } };
      },
      stdout: io.stdout,
      stderr: io.stderr,
      platform: "linux"
    });

    assert.equal(code, EXIT.OK);
    assert.equal(io.readOut(), expected + "\n");
    assert.equal(io.readErr(), "");
    assert.equal(unrefCalled, true);
    assert.deepEqual(spawns, [{
      bin: "xdg-open",
      args: [expected],
      opts: { detached: true, stdio: "ignore" }
    }]);
  }

  const plainIo = createIo();
  const plainCode = await main(["open", "p1", "--url", "https://devmoter.example/control"], {
    env: { DEVMOTER_AUTH_PASSWORD: "0123456789abcdef" },
    fetchImpl: mockOpenFetch({
      apiVersion: 1,
      project: { id: "p1", name: "Demo" },
      url: "?project=p1"
    }),
    spawnImpl: () => { throw new Error("must not spawn without --browser"); },
    stdout: plainIo.stdout,
    stderr: plainIo.stderr
  });
  assert.equal(plainCode, EXIT.OK);
  assert.equal(plainIo.readOut(), "https://devmoter.example/control/?project=p1\n");
  assert.equal(plainIo.readErr(), "");

  const jsonIo = createIo();
  const jsonCode = await main(["open", "p1", "--json", "--url", "https://devmoter.example/control"], {
    env: { DEVMOTER_AUTH_PASSWORD: "0123456789abcdef" },
    fetchImpl: mockOpenFetch({
      apiVersion: 1,
      project: { id: "p1", name: "Demo" },
      url: "/?project=p1"
    }),
    spawnImpl: () => { throw new Error("must not spawn without --browser"); },
    stdout: jsonIo.stdout,
    stderr: jsonIo.stderr
  });
  assert.equal(jsonCode, EXIT.OK);
  assert.deepEqual(JSON.parse(jsonIo.readOut()), {
    apiVersion: 1,
    project: { id: "p1", name: "Demo" },
    url: "https://devmoter.example/?project=p1"
  });
});

test("CLI entrypoint enforces launch URL validation in a subprocess", async t => {
  let nextUrl = "/?project=p1";
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      apiVersion: 1,
      project: { id: "p1", name: "Demo" },
      url: nextUrl
    }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DEVMOTER_AUTH_PASSWORD: "0123456789abcdef" };

  const ok = await execFileAsync(process.execPath, [cliPath, "open", "p1", "--url", baseUrl], { env });
  assert.equal(ok.stdout, `${baseUrl}/?project=p1\n`);
  assert.equal(ok.stderr, "");

  for (const unsafeUrl of ["file:///etc/passwd", "javascript:alert(1)", "https://evil.example/", "-flag"]) {
    nextUrl = unsafeUrl;
    await assert.rejects(
      () => execFileAsync(process.execPath, [cliPath, "open", "p1", "--browser", "--url", baseUrl], { env }),
      err => err.code === EXIT.SERVER && err.stdout === "" && /browser launch URL/i.test(err.stderr)
    );
  }
});
