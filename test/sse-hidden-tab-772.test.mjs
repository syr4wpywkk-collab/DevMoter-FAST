import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

// #772: each tab kept three EventSources open, and HTTP/1.1 allows six per host,
// so a second tab could not load. A hidden tab closes its streams and never
// reopens them; the existing resume-on-visible path resyncs and reconnects.
test("every always-on event stream closes in a hidden tab and stays closed until it is visible", async () => {
  const surfaces = {
    "../src/opencode.ts": { open: /function connectEvents\(\) \{[\s\S]{0,200}?document\.visibilityState === "hidden"\) return;/, close: /visibilitychange", \(\) => \{\s*if \(document\.visibilityState === "visible"\) void resumeFromBackground\(\);\s*else disconnectEvents\(\);/ },
    "../src/codex.ts": { open: /function connectEvents\(\) \{[\s\S]{0,200}?document\.visibilityState === "hidden"\) return;/, close: /visibilitychange", \(\) => \{[\s\S]{0,300}?events\?\.close\(\);\s*events = null;/ },
    "../src/host-agent-runtime.ts": { open: /private connectEvents\(\) \{[\s\S]{0,200}?document\.visibilityState === "hidden"\) return;/, close: /visibilitychange", \(\) => \{[\s\S]{0,400}?this\.events\?\.close\(\);\s*this\.events = null;/ }
  };
  for (const [path, { open, close }] of Object.entries(surfaces)) {
    const source = await read(path);
    assert.match(source, open, `${path} must not open a stream while hidden`);
    assert.match(source, close, `${path} must close its stream when hidden`);
  }
});
