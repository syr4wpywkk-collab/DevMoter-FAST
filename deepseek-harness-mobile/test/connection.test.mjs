import test from "node:test";
import assert from "node:assert/strict";
import {
  clearSavedHost,
  readSavedHost,
  saveHostUrl,
  validateHostUrl,
  STORAGE_KEY,
} from "../src/connection.js";

test("accepts HTTPS origins and normalizes trailing slash", () => {
  assert.deepEqual(validateHostUrl("https://dsh.example.test/"), {
    ok: true,
    value: "https://dsh.example.test",
  });
});

test("allows HTTP only for loopback development hosts", () => {
  assert.equal(validateHostUrl("http://localhost:3080").ok, true);
  assert.equal(validateHostUrl("http://127.0.0.1:3080").ok, true);
  assert.equal(validateHostUrl("http://192.168.1.10:3080").ok, false);
});

test("rejects credentials, non-web protocols, paths, query and fragments", () => {
  for (const value of [
    "javascript:alert(1)",
    "ftp://dsh.example.test",
    "https://user:pass@dsh.example.test",
    "https://dsh.example.test/admin",
    "https://dsh.example.test/?token=secret",
    "https://dsh.example.test/#token",
  ]) {
    assert.equal(validateHostUrl(value).ok, false, value);
  }
});

test("rejects malformed and empty values", () => {
  assert.equal(validateHostUrl("").ok, false);
  assert.equal(validateHostUrl("not a URL").ok, false);
});

test("stores only a validated normalized origin", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  assert.deepEqual(saveHostUrl("https://dsh.example.test/", storage), {
    ok: true,
    value: "https://dsh.example.test",
  });
  assert.equal(values.get(STORAGE_KEY), "https://dsh.example.test");
  assert.equal(readSavedHost(storage), "https://dsh.example.test");
  assert.equal(clearSavedHost(storage), true);
  assert.equal(readSavedHost(storage), "");
});
