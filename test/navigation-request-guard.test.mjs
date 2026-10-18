import test from "node:test";
import assert from "node:assert/strict";
import { inspectRequest, isExpectedUpload, isStaticRequest } from "../scripts/lib/navigation-request-guard.mjs";

const opts = {
  origin: "http://localhost:4173",
  draft: "SYNTHETIC_DRAFT_X7",
  attachmentName: "SYNTHETIC_FILE_X7.txt",
  attachmentContent: "SYNTHETIC_CONTENT_X7",
  uploadId: "SYNTHETIC_UPLOAD_X7",
  credential: "SYNTHETIC_CREDENTIAL_X7",
};
const base = { url: `${opts.origin}/api/codex/rpc`, method: "GET", headers: {} };
const req = (overrides = {}) => ({ ...base, ...overrides });
const has = (r, text) => inspectRequest(r, opts).includes(text);
const upload = (overrides = {}) => req({
  url: `${opts.origin}/api/codex/upload`, method: "POST", preparingAttachment: true,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: opts.attachmentName, type: "text/plain", data: `data:text/plain;base64,${Buffer.from(opts.attachmentContent).toString("base64")}` }),
  ...overrides,
});

test("static GET allowlist covers root, Vite, source and dependency imports only", async t => {
  for (const item of [
    ["root document", req({ url: `${opts.origin}/?surface=opencode&unifiedUI=1`, resourceType: "document" }), true],
    ["root extra query", req({ url: `${opts.origin}/?token=x`, resourceType: "document" }), false],
    ["Vite client", req({ url: `${opts.origin}/@vite/client`, resourceType: "script" }), true],
    ["Vite env", req({ url: `${opts.origin}/node_modules/vite/dist/client/env.mjs`, resourceType: "script" }), true],
    ["extensionless control center", req({ url: `${opts.origin}/src/control-center`, resourceType: "script" }), true],
    ["known xterm CSS", req({ url: `${opts.origin}/node_modules/@xterm/xterm/css/xterm.css`, resourceType: "script" }), true],
    ["TypeScript source", req({ url: `${opts.origin}/src/main.tsx`, resourceType: "script" }), true],
    ["Vite dependency", req({ url: `${opts.origin}/node_modules/.vite/deps/react.js`, resourceType: "script" }), true],
    ["missing resource type", req({ url: `${opts.origin}/src/main.ts` }), false],
    ["fetch disguised as asset", req({ url: `${opts.origin}/assets/app.js`, resourceType: "fetch" }), false],
    ["API disguised as asset", req({ url: `${opts.origin}/api/anything.js` }), false],
    ["non-GET source", req({ url: `${opts.origin}/src/main.tsx`, method: "POST" }), false],
    ["wrong resource type", req({ url: `${opts.origin}/src/main.tsx`, resourceType: "document" }), false],
  ]) await t.test(item[0], () => assert.equal(isStaticRequest(item[1]), item[2]));
});

test("upload exception requires preparation and the exact same-origin synthetic request", async t => {
  assert.equal(isExpectedUpload(upload(), opts), true);
  assert.deepEqual(inspectRequest(upload(), opts), []);
  const cases = [
    ["preparation flag absent", upload({ preparingAttachment: false })],
    ["wrong origin", upload({ url: "https://elsewhere.invalid/api/codex/upload" })],
    ["query present", upload({ url: `${opts.origin}/api/codex/upload?x=1` })],
    ["wrong path", upload({ url: `${opts.origin}/api/codex/other` })],
    ["wrong method", upload({ method: "PUT" })],
    ["wrong content type", upload({ headers: { "content-type": "text/plain" } })],
    ["raw rather than data URL", upload({ body: JSON.stringify({ name: opts.attachmentName, type: "text/plain", data: opts.attachmentContent }) })],
    ["unexpected field", upload({ body: JSON.stringify({ name: opts.attachmentName, type: "text/plain", data: `data:text/plain;base64,${Buffer.from(opts.attachmentContent).toString("base64")}`, extra: "x" }) })],
    ["duplicate JSON key", upload({ body: `{"name":"${opts.attachmentName}","name":"${opts.attachmentName}","type":"text/plain","data":"data:text/plain;base64,${Buffer.from(opts.attachmentContent).toString("base64")}"}` })],
  ];
  for (const [label, record] of cases) await t.test(label, () => assert.equal(isExpectedUpload(record, opts), false));
});

test("attachment payload, name and upload ID remain forbidden outside exact upload body", async t => {
  const cases = [
    ["upload id in body", req({ method: "POST", body: opts.uploadId })],
    ["name in URL", req({ url: `${opts.origin}/api/codex/rpc?x=${opts.attachmentName}` })],
    ["content in header", req({ headers: { "x-note": opts.attachmentContent } })],
    ["unsafe upload", upload({ preparingAttachment: false })],
  ];
  for (const [label, record] of cases) await t.test(label, () => {
    const findings = inspectRequest(record, opts);
    assert.ok(findings.includes("attachment data leaked"), findings.join(", "));
    if (record.url.includes("/api/codex/upload")) assert.ok(findings.includes("unexpected attachment upload request"));
  });
});

test("credential is inspected in every channel; only exact device header is exempt", async t => {
  const cases = [
    ["query", req({ url: `${opts.origin}/api/codex/rpc?x=${opts.credential}` })],
    ["JSON body", req({ method: "POST", body: JSON.stringify({ value: opts.credential }) })],
    ["form body", req({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `value=${opts.credential}` })],
    ["ordinary header", req({ headers: { authorization: opts.credential } })],
    ["credential duplicated in another header", req({ headers: { "x-devmoter-device-token": opts.credential, "x-note": opts.credential } })],
  ];
  for (const [label, record] of cases) await t.test(label, () => assert.ok(has(record, "credential leaked outside authentication header")));
  assert.ok(!has(req({ headers: { "x-devmoter-device-token": opts.credential } }), "credential leaked outside authentication header"));
  assert.ok(has(req({ headers: { "x-devmoter-device-token": "wrong" } }), "unexpected device credential header value"));
});

test("draft inspection decodes nested, escaped, base64 and split values in body/query/headers", async t => {
  const encoded = encodeURIComponent(opts.draft);
  const base64 = Buffer.from(opts.draft).toString("base64");
  const cases = [
    ["JSON", req({ method: "POST", body: JSON.stringify({ x: opts.draft }) })],
    ["percent-encoded twice", req({ method: "POST", body: `x=${encodeURIComponent(encoded)}`, headers: { "content-type": "application/x-www-form-urlencoded" } })],
    ["unicode escaped nested JSON", req({ method: "POST", body: JSON.stringify({ x: JSON.stringify({ y: "SYNTHETIC_DRAFT_\\u00587" }) }) })],
    ["base64", req({ method: "POST", body: JSON.stringify({ x: base64 }) })],
    ["split form values", req({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=SYNTHETIC_DRAFT_&b=X7" })],
    ["split query values", req({ url: `${opts.origin}/api/codex/rpc?a=SYNTHETIC_DRAFT_&b=X7` })],
    ["split headers", req({ headers: { a: "SYNTHETIC_DRAFT_", b: "X7" } })],
    ["multipart field", req({ method: "POST", headers: { "content-type": "multipart/form-data; boundary=xyz" }, body: `--xyz\r\nContent-Disposition: form-data; name="x"\r\n\r\n${opts.draft}\r\n--xyz--\r\n` })],
  ];
  for (const [label, record] of cases) await t.test(label, () => assert.ok(has(record, "draft content leaked")));
});

test("only approved read RPC methods and exact endpoint permit POST", async t => {
  for (const method of ["thread/list", "thread/read", "model/list"]) {
    await t.test(`read ${method}`, () => assert.deepEqual(inspectRequest(req({ method: "POST", body: JSON.stringify({ method }) }), opts), []));
  }
  for (const [label, record] of [
    ["mutating RPC", req({ method: "POST", body: JSON.stringify({ method: "thread/delete" }) })],
    ["send RPC", req({ method: "POST", body: JSON.stringify({ method: "thread/prompt" }) })],
    ["read method at other endpoint", req({ url: `${opts.origin}/api/other`, method: "POST", body: JSON.stringify({ method: "thread/list" }) })],
    ["non-API POST", req({ url: `${opts.origin}/outside`, method: "POST" })],
    ["malformed RPC", req({ method: "POST", body: "{" })],
    ["PUT", req({ method: "PUT" })],
  ]) await t.test(label, () => assert.ok(has(record, "unexpected non-static request")));
});

test("cross-origin requests and normalization failures fail closed", async t => {
  assert.ok(has(req({ url: "https://outside.invalid/safe" }), "external origin forbidden"));
  assert.ok(has(req({ method: "POST", body: "x".repeat(1024 * 1024 + 1) }), "request normalization failed closed"));
});

test("preparation never disables credential or unrelated request inspection", async t => {
  const credentialEscaped = [...opts.credential].map(char => `%${char.charCodeAt(0).toString(16)}`).join("");
  for (const [label, record] of [
    ["encoded upload URL", upload({ url: `${opts.origin}/api/codex/upload?x=${encodeURIComponent(credentialEscaped)}` })],
    ["upload body", upload({ body: JSON.stringify({ name: opts.attachmentName, type: opts.credential, data: opts.attachmentContent }) })],
    ["upload header", upload({ headers: { "content-type": "application/json", "x-note": opts.credential } })],
    ["split credential query", req({ preparingAttachment: true, url: `${opts.origin}/other?a=SYNTHETIC_CREDENTIAL_&b=X7` })],
    ["split credential form", req({ preparingAttachment: true, method: "POST", body: "a=SYNTHETIC_CREDENTIAL_&b=X7", headers: { "content-type": "application/x-www-form-urlencoded" } })],
    ["static encoded query", req({ url: `${opts.origin}/assets/app.js?token=${credentialEscaped}`, resourceType: "script" })],
  ]) await t.test(label, () => assert.ok(has(record, "credential leaked outside authentication header")));
  assert.ok(has(req({ preparingAttachment: true, url: `${opts.origin}/unexpected`, method: "POST" }), "unexpected non-static request"));
  assert.ok(has(req({ method: "HEAD" }), "unexpected non-static request"));
});

test("read RPC schemas reject extra instructions and unexpected parameters", async t => {
  for (const body of [
    { method: "thread/list", params: { limit: 100, prompt: "synthetic instruction" } },
    { method: "thread/read", params: { threadId: "synthetic-thread", delete: true } },
    { method: "model/list", mutate: true },
    { method: "model/list", params: { limit: 101 } },
  ]) await t.test(JSON.stringify(body), () => assert.ok(has(req({ method: "POST", body: JSON.stringify(body) }), "unexpected non-static request")));
  assert.deepEqual(inspectRequest(req({ method: "POST", body: JSON.stringify({ method: "thread/list", params: { limit: 100 } }) }), opts), []);
});
