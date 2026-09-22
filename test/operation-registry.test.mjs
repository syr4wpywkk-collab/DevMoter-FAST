import test from "node:test";
import assert from "node:assert/strict";
import { createOperationRegistry } from "../server/operation-registry.mjs";

test("operation registry suppresses duplicates only within the same scope", () => {
  const registry = createOperationRegistry({ ttlMs: 100, maxEntries: 10 });

  assert.equal(registry.claim("POST:/api/projects", "same", 0), true);
  assert.equal(registry.claim("POST:/api/projects", "same", 1), false);
  assert.equal(registry.claim("POST:/api/codex/rpc", "same", 1), true);
});

test("operation registry expires entries and keeps a bounded insertion order", () => {
  const registry = createOperationRegistry({ ttlMs: 100, maxEntries: 2 });

  assert.equal(registry.claim("scope", "first", 0), true);
  assert.equal(registry.claim("scope", "second", 1), true);
  assert.equal(registry.claim("scope", "third", 2), true);
  assert.equal(registry.size(), 2);
  assert.equal(registry.claim("scope", "first", 3), true);
  assert.equal(registry.claim("scope", "third", 3), false);
  assert.equal(registry.claim("scope", "second", 201), true);
});
