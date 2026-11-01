import test from "node:test";
import assert from "node:assert/strict";
import { parseSessionQuery, suggestSessionTokens, matchesSessionFilters } from "../src/session-search-query.mjs";

test("parses agent/project/state tokens and keeps the rest as free text", () => {
  assert.deepEqual(parseSessionQuery("fix login agent:Codex state:running project:DevMoter-FAST"), {
    text: "fix login", agent: "codex", project: "DevMoter-FAST", state: "running"
  });
  assert.deepEqual(parseSessionQuery("backend:opencode status:done"), { text: "", agent: "opencode", project: "", state: "done" });
});

test("quoted values allow names with spaces; quoted free text is unwrapped", () => {
  assert.deepEqual(parseSessionQuery('project:"My App" "exact words"'), { text: "exact words", agent: "", project: "My App", state: "" });
  assert.equal(parseSessionQuery('project:"Half typed').project, "Half typed");
});

test("unknown keys and URLs stay free text; an empty key filters nothing", () => {
  assert.deepEqual(parseSessionQuery("foo:bar http://x agent:"), { text: "foo:bar http://x", agent: "", project: "", state: "" });
  assert.deepEqual(parseSessionQuery(""), { text: "", agent: "", project: "", state: "" });
});

test("suggests keys, then known values, quoting names with spaces", () => {
  assert.deepEqual(suggestSessionTokens("fix st").map(s => s.label), ["state:"]);
  assert.equal(suggestSessionTokens("fix st")[0].value, "fix state:");
  assert.deepEqual(suggestSessionTokens("agent:o").map(s => s.label), ["agent:opencode", "agent:codex"]);
  assert.deepEqual(suggestSessionTokens("agent:").map(s => s.label), ["agent:codex", "agent:opencode"]);
  assert.deepEqual(suggestSessionTokens("state:ru").map(s => s.value), ["state:running ", "state:interrupted "], "prefix matches first");
  assert.deepEqual(suggestSessionTokens("x project:my", { projects: ["My App", "other"] }).map(s => s.value), ['x project:"My App" ']);
  assert.deepEqual(suggestSessionTokens("nope:"), []);
});

test("filters match backend, status and project name or path", () => {
  const session = { backend: "codex", status: "running", project: "/home/u/DevMoter-FAST/" };
  assert.equal(matchesSessionFilters(session, parseSessionQuery("agent:codex state:running project:devmoter-fast")), true);
  assert.equal(matchesSessionFilters(session, parseSessionQuery("project:/home/u/DevMoter-FAST")), true);
  assert.equal(matchesSessionFilters(session, parseSessionQuery("agent:opencode")), false);
  assert.equal(matchesSessionFilters(session, parseSessionQuery("state:done")), false);
  assert.equal(matchesSessionFilters({ backend: "opencode", status: "idle", project: "" }, parseSessionQuery("project:x")), false);
});
