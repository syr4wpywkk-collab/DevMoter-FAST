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
  for (const value of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1"]) {
    assert.equal(isPrivateAddress(value), true, value);
  }
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  await assert.rejects(
    () => fetchUrlAttachment("http://127.0.0.1:3000/private"),
    /private|special-use/i
  );
});
