import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deviceSessionCookie,
  systemFeatureInternals
} from "../server/system-features.mjs";

function request({ cookie = "", token = "", proto = "http" } = {}) {
  return {
    headers: {
      host: "devmoter.example",
      ...(cookie ? { cookie } : {}),
      ...(token ? { "x-devmoter-device-token": token } : {}),
      ...(proto ? { "x-forwarded-proto": proto, "x-forwarded-host": "devmoter.example" } : {})
    },
    socket: { encrypted: proto === "https" }
  };
}

test("trusted-device cookie is HttpOnly, strict, path-scoped and Secure on HTTPS", () => {
  const cookie = deviceSessionCookie(request({ proto: "https" }), "opaque-device-secret");
  assert.match(cookie, /^devmoter_device=opaque-device-secret;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=2592000/);
});

test("trusted-device authentication accepts cookie while header remains compatibility override", () => {
  const fromCookie = request({ cookie: "other=x; devmoter_device=cookie-token" });
  assert.equal(systemFeatureInternals.deviceToken(fromCookie), "cookie-token");

  const withHeader = request({
    cookie: "devmoter_device=cookie-token",
    token: "explicit-header-token"
  });
  assert.equal(systemFeatureInternals.deviceToken(withHeader), "explicit-header-token");
});

test("browser sources do not persist or attach the trusted-device bearer", async () => {
  for (const path of [
    "../src/settings.ts",
    "../src/system-panel.ts",
    "../src/workspace-control.ts",
    "../src/control-center.ts"
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /devmoter-device-token/);
    assert.doesNotMatch(source, /x-devmoter-device-token/);
  }
});
