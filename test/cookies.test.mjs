import test from "node:test";
import assert from "node:assert/strict";
import { readCookie } from "../server/cookies.mjs";
import { systemFeatureInternals } from "../server/system-features.mjs";

const req = cookie => ({ headers: { cookie } });

test("readCookie returns only the named cookie, decoded", () => {
  assert.equal(readCookie(req("a=1; devmoter_session=tok%2Fen; b=2"), "devmoter_session"), "tok/en");
  assert.equal(readCookie(req("a=1"), "devmoter_session"), "");
  assert.equal(readCookie({ headers: {} }, "x"), "");
  assert.equal(readCookie(req("x=%E0%A4%A"), "x"), "", "malformed values never authenticate");
  assert.equal(readCookie(req("xx=1; x=2"), "x"), "2", "no prefix matching");
});

test("client cookie names like __proto__ cannot touch object properties", () => {
  const hostile = req("__proto__=polluted; constructor=evil; toString=x; devmoter_device=real");
  assert.equal(readCookie(hostile, "devmoter_device"), "real");
  assert.equal(readCookie(req("__proto__=polluted"), "devmoter_device"), "");
  assert.equal(readCookie(req("constructor=evil"), "constructor"), "evil", "only an explicit lookup returns it, as a string");
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(systemFeatureInternals.deviceToken({ headers: { cookie: "__proto__=x; toString=y" } }), "");
});
