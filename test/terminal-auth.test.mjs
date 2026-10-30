import test from "node:test";
import assert from "node:assert/strict";
import { authenticateTerminalRequest, createTerminalManager } from "../server/terminal.mjs";

function requestWithPassword(password) {
  const token = Buffer.from(`devmoter:${password}`, "utf8").toString("base64");
  return {
    headers: {
      authorization: `Basic ${token}`
    }
  };
}

test("terminal authentication fails closed when password is not configured", () => {
  const result = authenticateTerminalRequest({ headers: {} }, "");
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /DEVMOTER_AUTH_PASSWORD/);
});

test("terminal authentication rejects bad password and accepts exact password", () => {
  const configured = "correct-horse-battery-staple";
  const bad = authenticateTerminalRequest(requestWithPassword("wrong-password"), configured);
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);

  const good = authenticateTerminalRequest(requestWithPassword(configured), configured);
  assert.deepEqual(good, { ok: true });
});


function captureResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headers)) this.headers[name.toLowerCase()] = value;
    },
    end(body = "") { this.body = String(body); }
  };
}

test("an owner session authorizes terminal APIs without Basic auth or a browser challenge", async () => {
  const manager = createTerminalManager({
    authPassword: "correct-horse-battery-staple",
    resolveProject: async () => null,
    ownerAuthenticated: async () => ({ id: "owner-session" })
  });
  const res = captureResponse();
  await manager.listSessions({ headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["www-authenticate"], undefined);
  assert.deepEqual(JSON.parse(res.body), { sessions: [] });
});

test("terminal auth without a session still challenges Basic credentials", async () => {
  const manager = createTerminalManager({
    authPassword: "correct-horse-battery-staple",
    resolveProject: async () => null
  });
  const res = captureResponse();
  await manager.listSessions({ headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers["www-authenticate"], /Basic realm="DevMoter Terminal"/);
});

test("terminal auth uses the same 16-character minimum as DevMoter auth", () => {
  const tooShort = authenticateTerminalRequest(requestWithPassword("123456789012345"), "123456789012345");
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.status, 503);
});
