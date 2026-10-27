import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACHMENT_TYPES,
  backendAttachmentCapabilities,
  fetchUrlAttachment,
  isPrivateAddress,
  negotiateAttachments,
  normalizeAttachment,
  previewUrlInput
} from "../server/attachments.mjs";

test("generic attachment model is opaque and capability-negotiated", () => {
  const input = normalizeAttachment({
    type: "url",
    name: "Docs",
    source: "https://example.com/docs",
    metadata: { finalUrl: "https://example.com/docs" }
  });
  assert.ok(ATTACHMENT_TYPES.includes("drive"));
  const codex = backendAttachmentCapabilities("codex");
  const negotiated = negotiateAttachments([input], codex);
  assert.equal(negotiated[0].type, "url");
  assert.equal(Object.prototype.hasOwnProperty.call(negotiated[0], "path"), false);
  assert.throws(
    () => negotiateAttachments([{ type: "drive", name: "private" }], codex),
    /does not support attachment type.*drive/i
  );
});

test("URL preview is network-free metadata and rejects credentials/non-http schemes", () => {
  const preview = previewUrlInput("https://example.com/a?q=1");
  assert.equal(preview.host, "example.com");
  assert.equal(preview.path, "/a?q=1");
  assert.equal(preview.requiresExplicitFetch, true);
  assert.throws(() => previewUrlInput("file:///etc/passwd"), /http\(s\)/i);
  assert.throws(() => previewUrlInput("https://user:pass@example.com/"), /credentials/i);
});

test("private and special-use addresses are blocked", async () => {
  for (const value of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1", "0:0:0:0:0:0:0:1", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a9fe:a9fe", "64:ff9b::a00:1"]) {
    assert.equal(isPrivateAddress(value), true, value);
  }
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  await assert.rejects(
    () => fetchUrlAttachment("http://127.0.0.1:3000/private"),
    /private|special-use/i
  );
});

test("URL attachment validates every resolved address on every redirect before requesting it", async () => {
  const requested = [];
  const lookupHost = async host => host === "start.example"
    ? [{ address: "8.8.8.8", family: 4 }]
    : [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:7f00:1", family: 6 }];
  const request = async url => {
    requested.push(url.hostname);
    return { status: 302, headers: { location: "http://redirect.example/" }, body: Buffer.alloc(0) };
  };
  await assert.rejects(() => fetchUrlAttachment("http://start.example/", {}, { lookupHost, request }), /private|special-use/i);
  assert.deepEqual(requested, ["start.example"]);
  await assert.rejects(() => fetchUrlAttachment("http://[::ffff:127.0.0.1]/", {}, { lookupHost, request }), /private|special-use/i);
  assert.deepEqual(requested, ["start.example"], "blocked literal must never be requested");
});

test("URL attachment honours zero redirects and still follows redirects by default", async () => {
  const requests = [];
  const lookupHost = async () => [{ address: "8.8.8.8", family: 4 }];
  const request = async url => {
    requests.push(url.hostname);
    return url.hostname === "start.example"
      ? { status: 302, headers: { location: "https://end.example/" }, body: Buffer.alloc(0) }
      : { status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("fixture text") };
  };
  await assert.rejects(() => fetchUrlAttachment("https://start.example/", { maxRedirects: 0 }, { lookupHost, request }), /redirect limit/i);
  assert.deepEqual(requests, ["start.example"]);
  requests.length = 0;
  const result = await fetchUrlAttachment("https://start.example/", {}, { lookupHost, request });
  assert.equal(result.text, "fixture text");
  assert.deepEqual(requests, ["start.example", "end.example"]);
});
