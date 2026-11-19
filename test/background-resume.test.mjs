import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// #326: returning from the background (tab visible again, bfcache restore,
// network back online) must resync and reconnect both streaming chat backends.
const sources = await Promise.all(["codex", "opencode"].map(async name => [
  name,
  await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8")
]));

test("#326: both chat backends resume on visibility, pageshow and online", () => {
  for (const [name, source] of sources) {
    assert.match(
      source,
      /document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(document\.visibilityState === "visible"\) void resumeFromBackground\(\);\s*\}\);/,
      `${name}: visibilitychange only resumes when the page becomes visible`
    );
    assert.match(source, /window\.addEventListener\("pageshow", \(\) => void resumeFromBackground\(\)\);/, `${name}: pageshow`);
    assert.match(source, /window\.addEventListener\("online", \(\) => void resumeFromBackground\(\)\);/, `${name}: online`);
  }
});

test("#326: a resume is skipped while offline and never runs twice at once", () => {
  for (const [name, source] of sources) {
    const body = source.slice(source.indexOf("async function resumeFromBackground()"));
    assert.ok(body.length > 0, `${name}: resumeFromBackground exists`);
    assert.match(body, /^async function resumeFromBackground\(\) \{\s*if \(!online \|\| resumeSyncInFlight\) return;\s*resumeSyncInFlight = true;/, name);
    const end = body.indexOf("\n  }\n");
    assert.match(body.slice(0, end), /finally \{[\s\S]*resumeSyncInFlight = false;/, `${name}: the in-flight flag is always cleared`);
  }
});
