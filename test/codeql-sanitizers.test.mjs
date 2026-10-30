import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText } from "../server/attachments.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundle the vendored TypeScript helpers the same way the office engine is built.
const vendorDir = fileURLToPath(new URL("../vendor/genoffice/docx/", import.meta.url));
const outDir = await mkdtemp(join(tmpdir(), "codeql-sanitizers-"));
await build({
  stdin: {
    contents: 'export { stripXmlTags } from "./parse-xml-text.ts"; export { stripDoctype } from "./parse-package.ts";',
    resolveDir: vendorDir,
    loader: "ts"
  },
  outfile: join(outDir, "helpers.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent"
});
const { stripXmlTags, stripDoctype } = await import(pathToFileURL(join(outDir, "helpers.mjs")).href);
test.after(() => rm(outDir, { recursive: true, force: true }));

test("htmlToText drops markup, comments and script/style bodies in one pass", () => {
  assert.equal(htmlToText("<p>Hello <b>world</b></p>"), "Hello world");
  assert.equal(htmlToText("a<script>alert(1)</script>b<style>p{}</style>c<noscript>x</noscript>d"), "a b c d");
  assert.equal(htmlToText("<SCRIPT type='x'>if (a > b) {}</SCRIPT >ok"), "ok");
  assert.equal(htmlToText("x<!-- <script>bad</script> -->y"), "x y");
  assert.equal(htmlToText('<a title="a>b">link</a>'), "link");
  // Nested/split tags cannot reassemble into markup.
  assert.doesNotMatch(htmlToText("<scr<script>ipt>alert(1)</script>"), /<script/i);
  assert.doesNotMatch(htmlToText("<<script>script>alert(1)<</script>/script>"), /<script>/i);
  // Entities decode once: an escaped entity stays an entity.
  assert.equal(htmlToText("&amp;lt;b&amp;gt; &lt;i&gt; &quot;q&quot; &#39;s&#39;"), "&lt;b&gt; <i> \"q\" 's'");
  assert.equal(htmlToText("unterminated <b"), "unterminated");
});

test("stripXmlTags returns only text content", () => {
  assert.equal(stripXmlTags('<w:instrText xml:space="preserve"> EMBED Word.Document </w:instrText>'), " EMBED Word.Document ");
  assert.equal(stripXmlTags("a<b/>c<d e='1'>f</d>"), "acf");
  assert.equal(stripXmlTags("<x>keep</x><broken"), "keep");
});

test("stripDoctype removes one DOCTYPE in linear time", () => {
  assert.equal(stripDoctype('<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "x>y">]><r/>'), '<?xml version="1.0"?><r/>');
  assert.equal(stripDoctype("<!doctype r SYSTEM 'a>b'><r/>"), "<r/>");
  assert.equal(stripDoctype("<r/>"), "<r/>");
  assert.equal(stripDoctype("<!DOCTYPE r [ unterminated"), "<!DOCTYPE r [ unterminated");
  const hostile = "<!DOCTYPE " + "[".repeat(20000) + "'".repeat(20000);
  const started = Date.now();
  stripDoctype(hostile);
  assert.ok(Date.now() - started < 200, "no catastrophic backtracking");
});
