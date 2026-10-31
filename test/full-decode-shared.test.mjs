import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fullyDecodePath } from "../server/security-helpers.mjs";
import { resolveLivePreviewTarget } from "../server/advanced-api.mjs";

test("fullyDecodePath undoes nested percent-encoding", () => {
  assert.equal(fullyDecodePath("/plain/path"), "/plain/path");
  assert.equal(fullyDecodePath("/a%2Fb"), "/a/b");
  assert.equal(fullyDecodePath("/%252e%252e/x"), "/../x");
  assert.equal(fullyDecodePath("/%25252e"), "/.");
  assert.equal(fullyDecodePath(""), "");
});

test("fullyDecodePath rejects malformed or endlessly nested input", () => {
  assert.equal(fullyDecodePath("/%E0%A4%A"), null);
  assert.equal(fullyDecodePath("/%"), null);
  // Five levels of encoding still changes after 4 rounds.
  assert.equal(fullyDecodePath("/%252525252e"), null);
});

test("the nested-decode loop is defined once and shared by both path checks", async () => {
  const files = ["../server.mjs", "../server/advanced-api.mjs", "../server/security-helpers.mjs"];
  const sources = await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), "utf8")));
  const all = sources.join("\n");
  assert.equal((all.match(/decodeURIComponent\(current\)/g) || []).length, 1);
  assert.doesNotMatch(all, /fullyDecodeOpenCodePath|fullyDecodePreviewPath/);
  assert.match(sources[0], /fullyDecodePath\(rawPath\)/);
  assert.match(sources[1], /fullyDecodePath\(rawSuffix\)/);
});

test("live preview still rejects double-encoded traversal", () => {
  assert.throws(() => resolveLivePreviewTarget("127.0.0.1", 3000, "/%252e%252e/secret"), /Invalid live preview path/);
  assert.throws(() => resolveLivePreviewTarget("127.0.0.1", 3000, "/%E0%A4%A"), /Invalid live preview path/);
});
