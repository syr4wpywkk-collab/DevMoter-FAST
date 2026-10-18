import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(source, /Image upload timed out/);
});
