import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DICTIONARIES } from "../src/i18n-core.mjs";

test("session handoff inherits remaining budget before first Codex or OpenCode turn", async () => {
  const source = await readFile(new URL("../src/session-control.ts", import.meta.url), "utf8");
  assert.match(source, /await inheritBudget\(source,\{\.\.\.source,backend:"codex",id\}\);onSessionReady\?\.\(\);await codex\("turn\/start"/);
  assert.match(source, /await inheritBudget\(source,\{\.\.\.source,backend:"opencode",id\}\);onSessionReady\?\.\(\);await oc\("\/session\/"\+encodeURIComponent\(id\)\+"\/prompt"/);
  assert.match(source, /t\("sessionControl\.budgetExhaustedNoStart"\)/);
  assert.match(DICTIONARIES.en["sessionControl.budgetExhaustedNoStart"], /Inherited agent budget is exhausted; new run was not started/);
  assert.match(source, /await preflightBudget\(source\);if\(targetBackend===\"codex\"\)/);
  assert.match(source, /budget\/remaining/);
});

test("side conversation retains a registered workspace once the agent session starts", async () => {
  const source = await readFile(new URL("../src/session-control.ts", import.meta.url), "utf8");
  assert.match(source, /side-readonly",\(\)=>\{sessionStarted=true;\}\);await event\(s\.key,"side"/);
  assert.match(source, /finally\{if\(scratchId&&!sessionStarted\)await json\("\/api\/projects\//);
  assert.doesNotMatch(source, /finally\{if\(scratchId\)await json\("\/api\/projects\//);
});

test("queue UI distinguishes uncertain sends from pending follow-ups", async () => {
  const source = await readFile(new URL("../src/session-control.ts", import.meta.url), "utf8");
  assert.match(source, /t\("sessionControl\.deliveryUncertain"\)/);
  assert.match(source, /t\("sessionControl\.retryAfterReview"\)/);
  assert.match(source, /t\("sessionControl\.uncertainWarning"\)/);
  assert.match(DICTIONARIES.en["sessionControl.deliveryUncertain"], /DELIVERY UNCERTAIN/);
  assert.match(DICTIONARIES.en["sessionControl.retryAfterReview"], /Retry after review/);
  assert.match(DICTIONARIES.en["sessionControl.uncertainWarning"], /may already have reached the agent/);
});
