import test from "node:test";
import assert from "node:assert/strict";
import { inspectRequest, createRequestGuard } from "../scripts/lib/navigation-request-guard.mjs";

const opts = {
  origin: "http://localhost:4173", draft: "SYNTHETIC_DRAFT_X7",
  credential: "SYNTHETIC_CREDENTIAL_X7", allowedThreadIds: ["synthetic-thread"],
  allowedSessionIds: ["synthetic-retained-session"],
};
const req = overrides => ({ url: `${opts.origin}/api/projects`, method: "GET", resourceType: "fetch", headers: {}, body: "", ...overrides });
const rejects = record => assert.ok(inspectRequest(record, opts).includes("unexpected non-static request"));
const b64 = text => Buffer.from(text).toString("base64");

test("unknown same-origin GET fails without any sensitive value", () => rejects(req({ url: `${opts.origin}/unexpected` })));
test("dynamic GET paths, exact queries and synthetic IDs are explicitly allowlisted", async t => {
  for (const path of ["/api/projects", "/api/opencode/session?limit=80&order=desc", "/api/opencode/session/synthetic-retained-session"]) {
    await t.test(`allow ${path}`, () => assert.deepEqual(inspectRequest(req({ url: opts.origin + path }), opts), []));
  }
  for (const path of ["/api/codex/rpc", "/api/codex/rpc?method=thread/read&threadId=unknown", "/api/projects?unknown=1", "/api/opencode/session?limit=81&order=desc", "/api/opencode/session?limit=80&limit=80&order=desc", "/api/opencode/session/unknown", "/api/opencode/session/synthetic-retained-session?unknown=1", "/api/opencode/unexpected"]) {
    await t.test(`deny ${path}`, () => rejects(req({ url: opts.origin + path })));
  }
});
test("read RPC requires query-free endpoint and allowlisted thread ID", async t => {
  for (const [label, override] of [
    ["unknown ID", { body: JSON.stringify({ method: "thread/read", params: { threadId: "unknown" } }) }],
    ["missing ID", { body: JSON.stringify({ method: "thread/read" }) }],
    ["query", { url: `${opts.origin}/api/codex/rpc?x=1`, body: JSON.stringify({ method: "thread/list" }) }],
  ]) await t.test(label, () => rejects(req({ url: `${opts.origin}/api/codex/rpc`, method: "POST", ...override })));
  assert.deepEqual(inspectRequest(req({ url: `${opts.origin}/api/codex/rpc`, method: "POST", body: JSON.stringify({ method: "thread/read", params: { threadId: "synthetic-thread", includeTurns: false } }) }), opts), []);
});
test("individually decoded split header values are recombined", () => {
  assert.ok(inspectRequest(req({ headers: { a: "U1lOVEhFVElDX0RSQUZUXw==", b: "X7" } }), opts).includes("draft content leaked"));
});
test("double base64 draft in GET query is detected even on a denied endpoint", () => {
  assert.ok(inspectRequest(req({ url: `${opts.origin}/api/codex/rpc?x=${encodeURIComponent(b64(b64(opts.draft)))}` }), opts).includes("draft content leaked"));
});
test("double base64 draft in thread/read.params.threadId is detected, not only rejected as an unknown ID", () => {
  const record = req({ url: `${opts.origin}/api/codex/rpc`, method: "POST", body: JSON.stringify({ method: "thread/read", params: { threadId: b64(b64(opts.draft)) } }) });
  const findings = inspectRequest(record, opts);
  assert.ok(findings.includes("draft content leaked"));
  assert.ok(findings.includes("unexpected non-static request"));
});
test("bad%ZZ does not hide adjacent fully percent-encoded credential", () => {
  const encoded = [...opts.credential].map(c => `%${c.charCodeAt(0).toString(16)}`).join("");
  assert.ok(inspectRequest(req({ headers: { a: `bad%ZZ${encoded}` } }), opts).includes("credential leaked outside authentication header"));
  assert.ok(inspectRequest(req({ url: `${opts.origin}/api/projects?x=bad%ZZ${encoded}` }), opts).includes("credential leaked outside authentication header"), "query control remains detectable");
});
test("nested base64 and valid percent runs next to malformed percent are inspected", async t => {
  for (const [key, sentinel, finding] of [["draft", opts.draft, "draft content leaked"], ["credential", opts.credential, "credential leaked outside authentication header"]]) {
    for (const [encoding, value] of [["double base64", b64(b64(sentinel))], ["malformed percent mix", "%ZZ" + [...sentinel].map(c => `%${c.charCodeAt(0).toString(16)}`).join("")]]) {
      await t.test(`${key}: ${encoding}`, () => assert.ok(inspectRequest(req({ headers: { "x-note": value } }), opts).includes(finding)));
    }
  }
});
test("request-scoped checks do not replace bounded context-wide split auditing", async t => {
  for (const [sentinel, finding] of [[opts.draft, "draft content leaked"], [opts.credential, "credential leaked outside authentication header"]]) {
    await t.test(finding, () => {
      const guard = createRequestGuard(opts);
      const prefix = sentinel.slice(0, -2), suffix = sentinel.slice(-2);
      assert.deepEqual(guard(req({ headers: { a: b64(b64(prefix)) } })), []);
      assert.deepEqual(guard(req({ headers: { unrelated: "synthetic unrelated value" } })), []);
      assert.ok(guard(req({ headers: { b: suffix } })).includes(finding));
      assert.deepEqual(createRequestGuard(opts)(req({ headers: { b: suffix } })), [], "contexts do not share state");
    });
  }
});
test("split-audit budget exhaustion fails closed", () => {
  const guard = createRequestGuard({ ...opts, maxRequests: 2 });
  assert.deepEqual(guard(req()), []);
  assert.deepEqual(guard(req()), []);
  assert.deepEqual(guard(req()), ["request audit limit exceeded"]);
});

test("encoded sentinel strings split at every byte boundary across requests remain detectable", () => {
  for (const encoding of ["base64", "base64url"]) {
    for (const sentinel of [opts.draft, opts.credential]) {
      let encoded = sentinel;
      for (let depth = 1; depth <= 2; depth++) {
        encoded = Buffer.from(encoded).toString(encoding);
        for (let at = 1; at < encoded.length; at++) {
          const guard = createRequestGuard(opts);
          guard(req({ headers: { a: encoded.slice(0, at) } }));
          const findings = guard(req({ headers: { b: encoded.slice(at) } }));
          assert.ok(findings.includes(sentinel === opts.draft ? "draft content leaked" : "credential leaked outside authentication header"), `${encoding} depth=${depth} split=${at}`);
        }
      }
    }
  }
});
test("oversized header normalization fails closed", () => {
  assert.deepEqual(inspectRequest(req({ headers: { a: "x".repeat(1024 * 1024 + 1) } }), opts), ["request normalization failed closed"]);
});
