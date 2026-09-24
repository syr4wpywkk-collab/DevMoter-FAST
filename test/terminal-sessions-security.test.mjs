import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { createTerminalManager } from "../server/terminal.mjs";

const PASSWORD = "terminal-session-security-password";
const authorization = `Basic ${Buffer.from(`devmoter:${PASSWORD}`).toString("base64")}`;

function request({ headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.headers = { authorization, ...headers };
  return req;
}

function response() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])));
    },
    end(body = "") { this.body = String(body); }
  };
}

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = signal => child.emit("exit", null, signal);
  return child;
}

function createManager(options = {}) {
  const children = [];
  const manager = createTerminalManager({
    authPassword: PASSWORD,
    resolveProject: async id => ({ id, name: id, path: `/tmp/${id}` }),
    maxSessions: 1,
    spawnImpl: () => {
      const child = fakeSpawn();
      children.push(child);
      return child;
    },
    ...options
  });
  return { manager, children };
}

async function createSession(manager, projectId = "project") {
  const res = response();
  await manager.create(request({
    headers: { "x-devmoter-terminal-entry": "explicit" },
    body: JSON.stringify({ projectId })
  }), res);
  return { res, payload: JSON.parse(res.body) };
}

test("terminal session capability protects metadata, input, stream, and termination", async () => {
  const { manager } = createManager();
  const { res: created, payload } = await createSession(manager);
  assert.equal(created.statusCode, 201);
  const { id } = payload.session;

  const infoRes = response();
  await manager.info(request(), infoRes, id);
  assert.equal(infoRes.statusCode, 403);

  const inputRes = response();
  await manager.input(request({ body: JSON.stringify({ data: "id\n" }) }), inputRes, id);
  assert.equal(inputRes.statusCode, 403);

  const streamRes = response();
  await manager.stream(request(), streamRes, id);
  assert.equal(streamRes.statusCode, 403);

  const closeRes = response();
  await manager.close(request(), closeRes, id);
  assert.equal(closeRes.statusCode, 403);

  const ownerRes = response();
  await manager.info(request({ headers: { "x-devmoter-terminal-token": payload.token } }), ownerRes, id);
  assert.equal(ownerRes.statusCode, 200);
  manager.shutdown();
});

test("terminal process cap holds under concurrent creates and frees on process exit", async () => {
  const { manager, children } = createManager();
  const creates = await Promise.all([
    createSession(manager, "first"),
    createSession(manager, "second")
  ]);
  assert.deepEqual(creates.map(item => item.res.statusCode).sort(), [201, 429]);
  assert.equal(children.length, 1);

  children[0].emit("exit", 0, null);
  const retry = await createSession(manager, "third");
  assert.equal(retry.res.statusCode, 201);
  assert.equal(children.length, 2);
  manager.shutdown();
});

test("spawn failures close the session instead of consuming the process allowance", async () => {
  const failing = new EventEmitter();
  failing.stdout = new PassThrough();
  failing.stderr = new PassThrough();
  failing.stdin = new PassThrough();
  let spawnCount = 0;
  const { manager } = createManager({
    spawnImpl: () => spawnCount++ === 0 ? failing : fakeSpawn()
  });
  const { res, payload } = await createSession(manager);
  assert.equal(res.statusCode, 201);

  failing.emit("error", new Error("spawn failed"));
  const retry = await createSession(manager, "retry");
  assert.equal(retry.res.statusCode, 201);
  assert.equal(retry.payload.session.closed, false);
  manager.shutdown();
});
