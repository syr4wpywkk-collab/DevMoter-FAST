import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describeHealthFetch, formatBuildId, formatNodeVersion, UNKNOWN_LABEL } from "../src/diagnostics-format.mjs";
import { safeBuildId } from "../server/system-features.mjs";

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
  assert.equal(describeHealthFetch({ fetchedAt: null, failedAt: null }).text, "まだ取得していません");
  assert.equal(describeHealthFetch({ fetchedAt: null, failedAt: null, loading: true }).text, "取得中…");
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
