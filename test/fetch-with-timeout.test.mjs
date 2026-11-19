import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DICTIONARIES } from "../src/i18n-core.mjs";
import { fetchWithTimeout } from "../src/fetch-with-timeout.mjs";

test("fetchWithTimeout passes through a successful response", async () => {
  const response = { ok: true };
  const result = await fetchWithTimeout(async () => response, "/", {}, 50, () => new Error("timeout"));
  assert.equal(result, response);
});

test("fetchWithTimeout aborts and settles even if the fetcher ignores abort", async () => {
  let signal;
  const failure = new Error("upload timeout");
  await assert.rejects(
    fetchWithTimeout((_input, init) => {
      signal = init.signal;
      return new Promise(() => {});
    }, "/", {}, 5, () => failure),
    error => error === failure
  );
  assert.equal(signal.aborted, true);
});

test("API Chat image uploads use the bounded fetch helper", async () => {
  const source = await readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8");
  assert.match(source, /fetchWithTimeout\(\s*\(input, init\) => fetch\(input, init\),\s*"\/api\/llm\/attachments"/);
  assert.match(source, /t\("apiChat\.imageUploadTimeout"\)/);
  assert.match(DICTIONARIES.en["apiChat.imageUploadTimeout"], /Image upload timed out/);
});

test("#329: reads time out, writes and caller-managed requests are never cut off", async () => {
  const { fetchReadWithTimeout, READ_REQUEST_TIMEOUT_MS } = await import("../src/fetch-with-timeout.mjs");
  assert.equal(READ_REQUEST_TIMEOUT_MS, 30_000);
  const seen = [];
  const hang = (input, init) => { seen.push(init); return new Promise(() => {}); };
  await assert.rejects(fetchReadWithTimeout(hang, "/api/x", {}, () => new Error("timed out"), 5), /timed out/);
  await assert.rejects(fetchReadWithTimeout(hang, "/api/x", { method: "head" }, () => new Error("timed out"), 5), /timed out/);
  assert.equal(seen[0].signal.aborted, true);

  const ok = new Response("{}");
  const echo = async (input, init) => { seen.push(init); return ok; };
  const own = new AbortController();
  assert.equal(await fetchReadWithTimeout(echo, "/api/x", { method: "POST", body: "{}" }, () => new Error("x"), 1), ok);
  assert.equal(seen.at(-1).signal, undefined);
  assert.equal(await fetchReadWithTimeout(echo, "/api/x", { signal: own.signal }, () => new Error("x"), 1), ok);
  assert.equal(seen.at(-1).signal, own.signal);
});

test("#329: shared JSON helpers bound their reads and show a translated timeout", async () => {
  for (const file of ["settings.ts", "system-panel.ts", "remote-control.ts", "workspace-tools.ts"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(source, /fetchReadWithTimeout\(\(input, request\) => fetch\(input, request\)/, file);
    assert.match(source, /new Error\(t\("common\.requestTimeout"\)\)/, file);
  }
  for (const [locale, messages] of Object.entries(DICTIONARIES)) {
    assert.ok(messages["common.requestTimeout"], locale);
  }
  assert.equal(Object.keys(DICTIONARIES).length >= 4, true);
});

test("#329: a body that stalls after the headers still times out", async () => {
  const { fetchReadWithTimeout } = await import("../src/fetch-with-timeout.mjs");
  let signal;
  const stalledBody = async (input, init) => {
    signal = init.signal;
    return { ok: true, status: 200, json: () => new Promise(() => {}), text: () => new Promise(() => {}) };
  };
  // Rejects from the helper itself, so `response.json().catch(() => ({}))` cannot hide it.
  await assert.rejects(fetchReadWithTimeout(stalledBody, "/api/x", {}, () => new Error("timed out"), 5), /timed out/);
  assert.equal(signal.aborted, true);

  const invalid = await fetchReadWithTimeout(async () => new Response("not json"), "/api/x", {}, () => new Error("timed out"), 50);
  await assert.rejects(invalid.json(), SyntaxError, "bad JSON still rejects at json(), as before");

  const fast = await fetchReadWithTimeout(async () => new Response('{"ok":1}'), "/api/x", {}, () => new Error("timed out"), 50);
  assert.deepEqual(await fast.json(), { ok: 1 });
});
