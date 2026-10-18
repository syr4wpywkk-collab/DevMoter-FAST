import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApiAttachment } from "../src/api-attachment.mjs";

const file = { type: "image/png", size: 42 };
const valid = { attachment: {
  id: "123e4567-e89b-42d3-a456-426614174000", name: "photo.png", mime: "image/png", size: 42
} };

test("API attachment response accepts the server's canonical shape", () => {
  assert.deepEqual(normalizeApiAttachment(valid, file), valid.attachment);
});

test("API attachment response rejects missing identity and mismatched metadata", () => {
  for (const payload of [
    {},
    { attachment: { ...valid.attachment, id: "not-an-id" } },
    { attachment: { ...valid.attachment, mime: "image/jpeg" } },
    { attachment: { ...valid.attachment, size: 0 } },
    { attachment: { ...valid.attachment, size: 41 } }
  ]) {
    assert.throws(() => normalizeApiAttachment(payload, file), /invalid attachment response/);
  }
});
