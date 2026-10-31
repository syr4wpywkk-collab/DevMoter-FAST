import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONTROL_CHARS } from "../server/security-helpers.mjs";
import { resolveLivePreviewTarget } from "../server/advanced-api.mjs";

test("CONTROL_CHARS matches the C0 range and DEL only, without regex state", () => {
  assert.equal(CONTROL_CHARS.global, false);
  assert.equal(CONTROL_CHARS.sticky, false);
  for (const code of [0x00, 0x09, 0x0a, 0x1f, 0x7f]) {
    assert.equal(CONTROL_CHARS.test(`a${String.fromCharCode(code)}b`), true, `0x${code.toString(16)}`);
  }
  for (const value of ["", "plain/path", " ", "~", "\u0080", "日本語"]) {
    assert.equal(CONTROL_CHARS.test(value), false, JSON.stringify(value));
  }
});

test("the control-character regex is defined once and shared by both path checks", async () => {
  const files = ["../server.mjs", "../server/advanced-api.mjs", "../server/security-helpers.mjs"];
  const sources = await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), "utf8")));
  const definitions = sources.join("\n").match(/\/\[\\u0000-\\u001f\\u007f\]\//g) || [];
  assert.equal(definitions.length, 1);
  assert.match(sources[0], /CONTROL_CHARS\.test\(decodedPath\)/);
  assert.match(sources[1], /CONTROL_CHARS\.test\(decoded\)/);
  assert.doesNotMatch(sources.join("\n"), /OPENCODE_CONTROL_CHARS|PREVIEW_CONTROL_CHARS/);
});

test("live preview still rejects percent-encoded control characters", () => {
  assert.throws(() => resolveLivePreviewTarget("127.0.0.1", 3000, "/a%00b"), /Invalid live preview path/);
  assert.throws(() => resolveLivePreviewTarget("127.0.0.1", 3000, "/a%7Fb"), /Invalid live preview path/);
  assert.doesNotThrow(() => resolveLivePreviewTarget("127.0.0.1", 3000, "/ok/path"));
});
