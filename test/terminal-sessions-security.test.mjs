import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
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

function fakePty() {
  const child = new EventEmitter();
  child.writes = [];
  child.sizes = [];
  child.onData = listener => child.on("data", listener);
  child.onExit = listener => child.on("exit", listener);
  child.write = data => child.writes.push(data);
  child.resize = (cols, rows) => child.sizes.push({ cols, rows });
  child.kill = signal => child.emit("exit", { exitCode: null, signal });
  return child;
}

function createManager(options = {}) {
  const children = [];
  const manager = createTerminalManager({
    authPassword: PASSWORD,
    resolveProject: async id => ({ id, name: id, path: `/tmp/${id}` }),
    maxSessions: 1,
    spawnPty: () => {
      const child = fakePty();
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

  children[0].emit("exit", { exitCode: 0 });
  const retry = await createSession(manager, "third");
  assert.equal(retry.res.statusCode, 201);
  assert.equal(children.length, 2);
  manager.shutdown();
});

test("spawn failures close the session instead of consuming the process allowance", async () => {
  let spawnCount = 0;
  const { manager } = createManager({
    spawnPty: () => {
      if (spawnCount++ === 0) throw new Error("spawn failed");
      return fakePty();
    }
  });
  const { res, payload } = await createSession(manager);
  assert.equal(res.statusCode, 400);
  assert.equal(payload.error, "spawn failed");
  const retry = await createSession(manager, "retry");
  assert.equal(retry.res.statusCode, 201);
  assert.equal(retry.payload.session.closed, false);
  manager.shutdown();
});

test("one-time websocket tickets bind the terminal session and Origin", async () => {
  const { manager } = createManager();
  const { payload } = await createSession(manager);
  const id = payload.session.id;
  const ticketResponse = response();
  await manager.issueSocketTicket(request({
    headers: { origin: "https://devmoter.example", "x-devmoter-terminal-token": payload.token }
  }), ticketResponse, id);
  assert.equal(ticketResponse.statusCode, 201);
  const ticket = JSON.parse(ticketResponse.body).ticket;
  assert.match(ticket, /^[a-f0-9]{64}$/);

  assert.equal(await manager.authorizeSocket({ headers: {} }, id, ticket, "https://evil.example"), null);
  assert.equal(await manager.authorizeSocket({ headers: {} }, id, ticket, "https://devmoter.example"), null);

  const nextTicketResponse = response();
  await manager.issueSocketTicket(request({
    headers: { origin: "https://devmoter.example", "x-devmoter-terminal-token": payload.token }
  }), nextTicketResponse, id);
  const nextTicket = JSON.parse(nextTicketResponse.body).ticket;
  const authorized = await manager.authorizeSocket({ headers: {} }, id, nextTicket, "https://devmoter.example");
  assert.ok(authorized);
  assert.equal(await manager.authorizeSocket({ headers: {} }, id, nextTicket, "https://devmoter.example"), null);
  manager.shutdown();
});

test("websocket terminal input, resize, and message bounds are enforced server-side", async () => {
  const { manager, children } = createManager();
  const { payload } = await createSession(manager);
  const id = payload.session.id;
  const ticketResponse = response();
  await manager.issueSocketTicket(request({
    headers: { origin: "https://devmoter.example", "x-devmoter-terminal-token": payload.token }
  }), ticketResponse, id);
  const ticket = JSON.parse(ticketResponse.body).ticket;
  const session = await manager.authorizeSocket({ headers: {} }, id, ticket, "https://devmoter.example");
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.bufferedAmount = 0;
  socket.sent = [];
  socket.send = data => socket.sent.push(JSON.parse(data));
  socket.close = (code, reason) => { socket.closed = { code, reason }; };
  manager.attachSocket(session, socket, 0);

  socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "git status\r" })));
  socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 110, rows: 42 })));
  assert.deepEqual(children[0].writes, ["git status\r"]);
  assert.deepEqual(children[0].sizes, [{ cols: 110, rows: 42 }]);

  socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 10000, rows: 42 })));
  assert.equal(socket.closed.code, 1008);
  manager.shutdown();
});

test("closed PTY sessions replay bounded scrollback without accepting input", async () => {
  const { manager, children } = createManager();
  const { payload } = await createSession(manager);
  const id = payload.session.id;
  children[0].emit("data", "last output\r\n");
  children[0].emit("exit", { exitCode: 0 });
  const ticketResponse = response();
  await manager.issueSocketTicket(request({
    headers: { origin: "https://devmoter.example", "x-devmoter-terminal-token": payload.token }
  }), ticketResponse, id);
  const ticket = JSON.parse(ticketResponse.body).ticket;
  const session = await manager.authorizeSocket({ headers: {} }, id, ticket, "https://devmoter.example");
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.bufferedAmount = 0;
  socket.sent = [];
  socket.send = data => socket.sent.push(JSON.parse(data));
  socket.close = (code, reason) => { socket.closed = { code, reason }; };
  manager.attachSocket(session, socket, 0);
  assert.ok(socket.sent.some(item => item.data === "last output\r\n"));
  assert.equal(socket.closed.code, 1000);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "should not run\r" })));
  assert.deepEqual(children[0].writes, []);
  manager.shutdown();
});
