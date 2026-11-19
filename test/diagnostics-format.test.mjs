import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDiagnosticsReport, classifyFetchFailure, describeConnection, describeFetchFailure, describeHealthFetch,
  formatBuildId, formatNodeVersion, listConnections, UNKNOWN_LABEL
} from "../src/diagnostics-format.mjs";
import { classifyBackendFailure, createSystemFeatures, safeBuildId, summarizeConnection } from "../server/system-features.mjs";

test("#469 Node.js version shows only a plain server-reported version", () => {
  assert.equal(formatNodeVersion("v22.11.0"), "v22.11.0");
  assert.equal(formatNodeVersion("20.9.1"), "v20.9.1");
  assert.equal(formatNodeVersion("v23.0.0-nightly2024"), "v23.0.0-nightly2024");
  for (const bad of [undefined, null, "", "latest", "v22", "v22.1.0 TOKEN=abc", "<b>v1.2.3</b>", 22]) {
    assert.equal(formatNodeVersion(bad), UNKNOWN_LABEL, String(bad));
  }
});

test("#470 build identifier is shown as 不明 instead of guessing or echoing odd values", () => {
  assert.equal(formatBuildId("0123456789abcdef0123456789abcdef01234567"), "0123456789ab");
  assert.equal(formatBuildId("v0.2.0-build.17"), "v0.2.0-build.17");
  for (const bad of [undefined, null, "", "  ", "sk-live key", "a=b", "x".repeat(65), "-leading", "../etc"]) {
    assert.equal(formatBuildId(bad), UNKNOWN_LABEL, String(bad));
  }
});

test("#470 server only returns a build id that looks like a plain identifier", () => {
  assert.equal(safeBuildId("fe7dd4e84bcec955ba5bf96d64c85e463f0827d9"), "fe7dd4e84bcec955ba5bf96d64c85e463f0827d9");
  assert.equal(safeBuildId("release-42"), "release-42");
  assert.equal(safeBuildId(undefined), null);
  assert.equal(safeBuildId(""), null);
  assert.equal(safeBuildId("PASSWORD=hunter2"), null);
  assert.equal(safeBuildId("token with spaces"), null);
});

test("#473 fetch state distinguishes success, failure (stale) and never-fetched", () => {
  assert.equal(describeHealthFetch({ fetchedAt: null, failedAt: null }).text, "Not fetched yet");
  assert.equal(describeHealthFetch({ fetchedAt: null, failedAt: null, loading: true }).text, "Fetching…");
  assert.equal(describeHealthFetch({ fetchedAt: null, failedAt: null }, "ja-JP").text, "まだ取得していません");
  assert.equal(describeHealthFetch({ fetchedAt: null, failedAt: null, loading: true }, "ja-JP").text, "取得中…");
  const ok = describeHealthFetch({ fetchedAt: Date.UTC(2026, 10, 3, 7, 0, 0), failedAt: null }, "ja-JP");
  assert.equal(ok.tone, "ok");
  assert.match(ok.text, /^最終取得: /);
  const stale = describeHealthFetch({ fetchedAt: Date.UTC(2026, 10, 3, 7, 0, 0), failedAt: Date.UTC(2026, 10, 3, 7, 5, 0) }, "ja-JP");
  assert.equal(stale.tone, "error");
  assert.match(stale.text, /取得に失敗しました/);
  assert.match(stale.text, /最新ではありません/);
  assert.match(stale.text, /最後に成功した取得: /);
  const neverOk = describeHealthFetch({ fetchedAt: null, failedAt: Date.UTC(2026, 10, 3, 7, 5, 0) }, "ja-JP");
  assert.match(neverOk.text, /成功した取得はまだありません/);
  const recovered = describeHealthFetch({ fetchedAt: Date.UTC(2026, 10, 3, 7, 6, 0), failedAt: Date.UTC(2026, 10, 3, 7, 5, 0) }, "ja-JP");
  assert.equal(recovered.tone, "ok");
});

test("Settings diagnostics page renders Node.js, build, last-fetch status and a refresh button", async () => {
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const body = settings.slice(settings.indexOf("function renderDiagnostics()"), settings.indexOf("function renderGuide()"));
  assert.match(body, /formatNodeVersion\(diagnostics\?\.app\?\.node\)/);
  assert.match(body, /formatBuildId\(diagnostics\?\.app\?\.build\)/);
  assert.match(body, /describeHealthFetch\(diagnosticsFetch\)/);
  assert.match(body, /data-action="diagnostics:refresh"/);
  assert.match(settings, /action === "diagnostics:refresh"/);
  // Failures keep the last good values but record failedAt instead of silently looking fresh.
  const refresh = settings.slice(settings.indexOf("async function refreshDiagnostics()"), settings.indexOf("async function refresh()"));
  assert.match(refresh, /fetchedAt = Date\.now\(\)/);
  assert.match(refresh, /failedAt = Date\.now\(\)/);
});

const CHECKED = "2026-11-19T16:00:00.000Z";

test("#468 server lists each backend as connected / failed / unknown with its check time", async t => {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-diag-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const make = getBackendHealth => createSystemFeatures({ stateDir, appRoot: stateDir, distDir: join(stateDir, "dist"), version: "test", getProjects: async () => [], getBackendHealth });

  const mixed = await make(async () => ({
    opencode: { online: true, directory: "/home/me/secret-project" },
    codex: { online: false, error: "spawn codex ENOENT", code: "not_installed", cwd: "/home/me" }
  })).diagnostics();
  assert.match(mixed.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(mixed.connections, [
    { id: "opencode", state: "connected", failure: null, httpStatus: null, checkedAt: mixed.generatedAt },
    { id: "codex", state: "failed", failure: "offline", httpStatus: null, checkedAt: mixed.generatedAt }
  ]);
  assert.doesNotMatch(JSON.stringify(mixed.connections), /secret-project|ENOENT|\/home/);

  // A health probe that throws or returns nothing is unknown, never "connected" or "offline".
  for (const probe of [async () => { throw new Error("boom"); }, async () => ({}), async () => ({ opencode: { online: "yes" } })]) {
    const result = await make(probe).diagnostics();
    assert.deepEqual(result.connections.map(item => [item.state, item.failure, item.checkedAt]), [["unknown", null, null], ["unknown", null, null]]);
  }
});

test("#470 host build falls back to the served bundle's build.json and is null when absent", async t => {
  const appRoot = await mkdtemp(join(tmpdir(), "devmoter-build-"));
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  const saved = { build: process.env.DEVMOTER_BUILD, sha: process.env.GITHUB_SHA };
  delete process.env.DEVMOTER_BUILD;
  delete process.env.GITHUB_SHA;
  t.after(() => {
    if (saved.build !== undefined) process.env.DEVMOTER_BUILD = saved.build;
    if (saved.sha !== undefined) process.env.GITHUB_SHA = saved.sha;
  });
  const features = createSystemFeatures({ stateDir: appRoot, appRoot, distDir: join(appRoot, "dist"), version: "test", getProjects: async () => [], getBackendHealth: async () => ({}) });
  assert.equal((await features.diagnostics()).app.build, null);
  await mkdir(join(appRoot, "dist"));
  await writeFile(join(appRoot, "dist", "build.json"), JSON.stringify({ build: "abc123def456-dirty" }));
  assert.equal((await features.diagnostics()).app.build, "abc123def456-dirty");
  await writeFile(join(appRoot, "dist", "build.json"), JSON.stringify({ build: "TOKEN=hunter2 x" }));
  assert.equal((await features.diagnostics()).app.build, null);
  process.env.DEVMOTER_BUILD = "release-7";
  assert.equal((await features.diagnostics()).app.build, "release-7");
  delete process.env.DEVMOTER_BUILD;
});

test("#472 backend failures are classified as auth / offline / timeout, otherwise unknown", () => {
  assert.equal(classifyBackendFailure({ online: false, status: 401, error: "x" }), "auth");
  assert.equal(classifyBackendFailure({ online: false, status: 403 }), "auth");
  assert.equal(classifyBackendFailure({ online: false, error: "Unauthorized" }), "auth");
  assert.equal(classifyBackendFailure({ online: false, error: "The operation was aborted due to timeout" }), "timeout");
  assert.equal(classifyBackendFailure({ online: false, status: 504 }), "timeout");
  assert.equal(classifyBackendFailure({ online: false, error: "connect ECONNREFUSED 127.0.0.1:4096" }), "offline");
  assert.equal(classifyBackendFailure({ online: false, error: "fetch failed" }), "offline");
  assert.equal(classifyBackendFailure({ online: false, code: "not_installed", error: "codex ..." }), "offline");
  assert.equal(classifyBackendFailure({ online: false, status: 500, error: "OpenCode /api/location returned no directory" }), "unknown");
  assert.equal(classifyBackendFailure({ online: false }), "unknown");
  assert.equal(summarizeConnection("opencode", { online: false, status: 500 }, CHECKED).httpStatus, 500);
});

test("#468 #473 client shows unknown instead of a stale or unreported connection state", () => {
  const diagnostics = { generatedAt: CHECKED, connections: [
    { id: "opencode", state: "connected", failure: null, httpStatus: null, checkedAt: CHECKED },
    { id: "codex", state: "failed", failure: "auth", httpStatus: 401, checkedAt: CHECKED }
  ] };
  const fresh = listConnections(diagnostics);
  assert.deepEqual(fresh.map(item => item.state), ["connected", "failed"]);
  assert.equal(describeConnection(fresh[0], "ja").label, "接続中");
  assert.equal(describeConnection(fresh[1], "ja").label, "認証失敗");
  assert.match(describeConnection(fresh[1], "ja").guide, /再ログイン/);
  // stale: latest fetch failed -> nothing is shown as connected
  assert.deepEqual(listConnections(diagnostics, { stale: true }).map(item => item.state), ["unknown", "unknown"]);
  // nothing fetched / garbage
  for (const bad of [undefined, {}, { connections: [{ id: "opencode", state: "online" }] }, { connections: [{ id: "opencode", state: "connected" }] }]) {
    assert.deepEqual(listConnections(bad).map(item => item.state), ["unknown", "unknown"]);
  }
  assert.equal(describeConnection(listConnections({})[0], "ja").label, "不明");
  // unrecognised failure kind -> unknown guidance that says nothing was changed
  const odd = listConnections({ connections: [{ id: "codex", state: "failed", failure: "weird", checkedAt: CHECKED }] })[1];
  assert.equal(odd.failure, "unknown");
  assert.match(describeConnection(odd, "ja").guide, /設定は変更していません/);
  // older host without `connections`
  const legacy = listConnections({ generatedAt: CHECKED, backends: { opencode: { online: true }, codex: { online: false } } });
  assert.deepEqual(legacy.map(item => [item.state, item.failure]), [["connected", null], ["failed", "unknown"]]);
});

test("#472 host fetch failures map to guidance per kind", () => {
  assert.equal(classifyFetchFailure(Object.assign(new Error("x"), { status: 401 })), "auth");
  assert.equal(classifyFetchFailure(Object.assign(new Error("x"), { status: 403 })), "auth");
  assert.equal(classifyFetchFailure(new TypeError("Failed to fetch")), "offline");
  assert.equal(classifyFetchFailure(new Error("x"), { online: false }), "offline");
  assert.equal(classifyFetchFailure(Object.assign(new Error("x"), { name: "TimeoutError" })), "timeout");
  assert.equal(classifyFetchFailure(Object.assign(new Error("x"), { status: 500 })), "unknown");
  assert.equal(classifyFetchFailure(undefined), "unknown");
  assert.match(describeFetchFailure("offline", "ja").guide, /ネットワーク/);
  assert.match(describeFetchFailure("nonsense", "ja").guide, /設定は変更していません/);
});

test("#471 copied report is built from an allowlist and carries no secrets or personal data", () => {
  const SECRET = "sk-live-SECRET123";
  const diagnostics = {
    generatedAt: CHECKED,
    app: { name: "DevMoter FAST", version: "0.2.0", node: "v22.11.0", host: "my-laptop.tailnet.ts.net", build: "0123456789abcdef0123456789abcdef01234567", token: SECRET },
    backends: {
      opencode: { online: true, directory: "/home/tamina/private-repo", project: { name: "private-repo" } },
      codex: { online: false, error: `auth failed token=${SECRET}`, cwd: "/home/tamina", bin: "/home/tamina/.local/bin/codex" }
    },
    connections: [
      { id: "opencode", state: "connected", failure: null, httpStatus: null, checkedAt: CHECKED },
      { id: "codex", state: "failed", failure: "auth", httpStatus: 401, checkedAt: CHECKED, error: SECRET }
    ],
    prerequisites: { required: { node: { available: true, version: `v22 ${SECRET}`, path: "/home/tamina/bin/node" }, git: { available: false }, [`bad ${SECRET}=1`]: { available: true } } },
    projects: { count: 3, names: ["private-repo"] },
    deviceSecurity: { currentDeviceId: "device-abc", devices: [{ id: "device-abc", label: "Tamina iPhone" }] },
    network: { localhostFirst: true, message: SECRET }
  };
  const cliStatus = [
    { command: "codex", presence: "ready", version: "1.2.3", message: SECRET, resolvedPath: "/home/tamina/bin/codex" },
    { command: "opencode", presence: "missing", version: null },
    { command: `evil ${SECRET}`, presence: "ready", version: SECRET },
    { command: "gh", presence: "ready", version: `2.0 password=${SECRET}` }
  ];
  const report = buildDiagnosticsReport({
    diagnostics, cliStatus, clientBuild: "abc123def456-dirty",
    fetchState: { fetchedAt: Date.parse(CHECKED), failedAt: null }, now: Date.parse("2026-11-19T16:05:00.000Z")
  });
  assert.equal(report, [
    "DevMoter FAST diagnostics",
    "Copied at: 2026-11-19T16:05:00.000Z",
    "Last successful fetch: 2026-11-19T16:00:00.000Z",
    "Latest fetch: ok",
    "App version: 0.2.0",
    "Host build: 0123456789ab",
    "Device build: abc123def456-dirty",
    "Node.js: v22.11.0",
    "Connections:",
    "- opencode: connected @ 2026-11-19T16:00:00.000Z",
    "- codex: failed (auth, HTTP 401) @ 2026-11-19T16:00:00.000Z",
    "CLI:",
    "- codex: ready 1.2.3",
    "- opencode: missing",
    "- gh: ready 2.0",
    "Prerequisites: node=ok, git=missing",
    "Projects: 3",
    "Bind: localhost",
    ""
  ].join("\n"));
  assert.doesNotMatch(report, /SECRET|tamina|private-repo|device-abc|tailnet|password|token|\/home/i);

  const stale = buildDiagnosticsReport({ diagnostics, fetchState: { fetchedAt: 1000, failedAt: 2000 }, fetchFailure: "timeout", clientBuild: "", now: 3000 });
  assert.match(stale, /Latest fetch: failed \(timeout\)/);
  assert.match(stale, /Device build: unknown/);
  assert.match(stale, /- opencode: unknown\n- codex: unknown/);
  assert.doesNotMatch(stale, /connected/);

  const empty = buildDiagnosticsReport({});
  assert.match(empty, /Last successful fetch: never/);
  assert.match(empty, /Host build: unknown/);
  assert.match(empty, /Projects: unknown/);
});

test("build mismatch compares full identifiers, not the shortened display form", async () => {
  const { buildsDiffer, formatBuildId } = await import("../src/diagnostics-format.mjs");
  const host = "4db61e793d440000000000000000000000000000";
  const device = "4db61e793d440e1c99d6d72508969099bcb4af7a";
  assert.equal(formatBuildId(host), formatBuildId(device));
  assert.equal(buildsDiffer(host, device), true);
  assert.equal(buildsDiffer(host, host), false);
  assert.equal(buildsDiffer("other-build-1", device), true);
  assert.equal(buildsDiffer("", device), false);
  assert.equal(buildsDiffer(host, "bad id/../x"), false);
  assert.equal(buildsDiffer(null, undefined), false);
});

test("copied report keeps the version token from CLI output lines only", async () => {
  const { buildDiagnosticsReport } = await import("../src/diagnostics-format.mjs");
  const report = buildDiagnosticsReport({
    diagnostics: null, fetchState: { fetchedAt: null, failedAt: null }, fetchFailure: null, clientBuild: "",
    cliStatus: [
      { command: "codex", presence: "ready", version: "codex-cli 1.2.3" },
      { command: "opencode", presence: "ready", version: "0.9.1" },
      { command: "claude", presence: "ready", version: "2.0.14 (Claude Code)" },
      { command: "qwen", presence: "ready", version: "token sk-live-SECRET123 /home/alice" }
    ]
  });
  assert.match(report, /- codex: ready 1\.2\.3\n/);
  assert.match(report, /- opencode: ready 0\.9\.1\n/);
  assert.match(report, /- claude: ready 2\.0\.14\n/);
  assert.match(report, /- qwen: ready unknown\n/);
  assert.doesNotMatch(report, /SECRET|alice|codex-cli|Claude Code/);
});
