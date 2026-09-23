import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project deep-link is consumed once in shared startup before either backend mounts", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const read = source.indexOf('startupParams.get("project")');
  const persist = source.indexOf('localStorage.setItem("opencode-pocket-project", requestedProject)');
  const remove = source.indexOf('startupParams.delete("project")');
  const replace = source.indexOf("window.history.replaceState");
  const openCodeMount = source.indexOf("mountOpenCodeRemote(");
  const codexMount = source.indexOf("mountCodexRemote(");

  assert.ok(read >= 0);
  assert.ok(persist > read);
  assert.ok(remove > persist);
  assert.ok(replace > remove);
  assert.ok(openCodeMount > replace);
  assert.ok(codexMount > replace);
  assert.equal(
    (source.match(/startupParams\.get\("project"\)/g) || []).length,
    1
  );
});

test("automation and attachment routes stay after the owner-session/same-origin boundary", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const auth = source.indexOf("if (!basicAuthenticated && !ownerSession)");
  const origin = source.indexOf("requireSameOriginMutation(req, res, DEVMOTER_PUBLIC_ORIGIN)", auth);
  const automation = source.indexOf("automationApi.handle(req, res, url)");
  const upload = source.indexOf('url.pathname === "/api/codex/upload"');

  assert.ok(auth >= 0);
  assert.ok(origin > auth);
  assert.ok(automation > origin);
  assert.ok(upload > origin);
});
