import test from "node:test";
import assert from "node:assert/strict";
import { createUploadRegistry } from "../server/upload-registry.mjs";

test("upload registry returns opaque ids and evicts old entries", () => {
  const registry = createUploadRegistry({ maxEntries: 2, ttlMs: 60_000 });
  const first = registry.add({ path: "/private/one", name: "one.txt" });
  const second = registry.add({ path: "/private/two", name: "two.txt" });
  const third = registry.add({ path: "/private/three", name: "three.txt" });

  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.throws(() => registry.get(first), /unavailable|expired/i);
  assert.equal(registry.get(second).name, "two.txt");
  assert.equal(registry.get(third).name, "three.txt");
});

test("upload registry rejects unknown ids", () => {
  const registry = createUploadRegistry();
  assert.throws(() => registry.get("missing"), /unavailable|expired/i);
});
