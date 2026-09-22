import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project deep link is consumed before backend mount and removed from the URL", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const startup = source.indexOf('const requestedProject = startupParams.get("project")');
  const store = source.indexOf('localStorage.setItem("opencode-pocket-project", requestedProject)', startup);
  const remove = source.indexOf('startupParams.delete("project")', startup);
  const replace = source.indexOf("window.history.replaceState", startup);
  const mount = source.indexOf("const openCodeRemote = mountOpenCodeRemote", replace);

  assert.ok(startup >= 0);
  assert.ok(store > startup);
  assert.ok(remove > store);
  assert.ok(replace > remove);
  assert.ok(mount > replace);
  assert.equal(source.indexOf('startupParams.get("project")', startup + 1), -1);
});

test("browser attachment state uses opaque IDs instead of host paths", async () => {
  const [codex, opencode] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);

  assert.match(codex, /uploadId: String\(payload\.uploadId/);
  assert.match(codex, /uploadId: attachment\.uploadId/);
  assert.doesNotMatch(codex, /path: String\(payload\.path/);

  assert.match(opencode, /uploadId: String\(payload\.uploadId/);
  assert.match(opencode, /devmoter-upload:/);
  assert.doesNotMatch(opencode, /path: String\(payload\.path/);
});

test("context resolution failure preserves the composer draft and runtime picker is unified", async () => {
  const [codex, opencode] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);

  const codexResolve = codex.indexOf("contextText = await resolvedContextText(text)");
  const codexClear = codex.indexOf('promptInput.value = ""', codexResolve);
  const codexFailure = codex.indexOf("Project context could not be resolved", codexResolve);
  assert.ok(codexResolve >= 0 && codexFailure > codexResolve && codexClear > codexFailure);

  const openResolve = opencode.indexOf("contextText = await resolveProjectContext(text)");
  const openClear = opencode.indexOf('promptInput.value = ""', openResolve);
  const openFailure = opencode.indexOf("Project context could not be resolved", openResolve);
  assert.ok(openResolve >= 0 && openFailure > openResolve && openClear > openFailure);

  assert.match(codex, /Provider · Model · Agent/);
  assert.match(opencode, /Provider · Model · Agent/);
  assert.match(opencode, /provider unavailable/);
});
