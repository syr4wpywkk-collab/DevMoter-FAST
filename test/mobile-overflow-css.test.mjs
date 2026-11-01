import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = name => readFile(new URL("../src/" + name, import.meta.url), "utf8");
const rule = (source, selector) => {
  const match = new RegExp("(?:^|\\n)\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(source);
  assert.ok(match, `missing ${selector}`);
  return match[1];
};

// A closed off-canvas panel parked past the right edge is still rendered unless
// it is visibility:hidden, and iOS Safari widens the layout viewport for it
// (the band on the right of every screen).
test("closed off-canvas panels are not rendered past the right edge", async () => {
  const session = await css("session-control.css");
  assert.match(rule(session, ".sc-panel"), /visibility:\s*hidden/);
  assert.match(session, /\.sc-panel\.open\s*\{[^}]*visibility:\s*visible/);
  const codex = await css("codex-chat.css");
  assert.match(codex, /\.cx-app \.cx-details-panel \{[^}]*translateX\(105%\)[^}]*visibility:\s*hidden/);
  assert.match(codex, /\.cx-app \.cx-details-panel\.open\s*\{[^}]*visibility:\s*visible/);
});

test("full-width fixed layers size to the containing block, not 100vw", async () => {
  assert.match(rule(await css("office.css"), ".dm-office"), /\n\s*width:\s*100%;/);
  assert.doesNotMatch(await css("app-shell.css"), /min\(100vw,\s*460px\)/);
});
