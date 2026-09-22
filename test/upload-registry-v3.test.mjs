import test from "node:test";
import assert from "node:assert/strict";
import { createUploadRegistry } from "../server/upload-registry.mjs";

test("upload registry exposes opaque UUIDs and never derives IDs from host paths", () => {
  const registry = createUploadRegistry({ maxEntries: 2, ttlMs: 60_000 });
  const id = registry.add({
    path: "/home/private/project/upload.png",
    name: "upload.png",
    type: "image/png",
    size: 10
  });

  assert.match(id, /^[0-9a-f-]{36}$/i);
  assert.equal(id.includes("home"), false);
  assert.equal(registry.get(id).path, "/home/private/project/upload.png");
});

test("upload registry evicts old entries and rejects unknown IDs", () => {
  const registry = createUploadRegistry({ maxEntries: 2, ttlMs: 60_000 });
  const first = registry.add({ path: "/private/one" });
  const second = registry.add({ path: "/private/two" });
  const third = registry.add({ path: "/private/three" });

  assert.throws(() => registry.get(first), /unavailable|expired/i);
  assert.equal(registry.get(second).path, "/private/two");
  assert.equal(registry.get(third).path, "/private/three");
  assert.throws(() => registry.get("missing"), /unavailable|expired/i);
});
