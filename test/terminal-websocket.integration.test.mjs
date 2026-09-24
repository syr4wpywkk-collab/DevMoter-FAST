import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import { Readable } from "node:stream";
import WebSocket from "ws";
import { createTerminalManager } from "../server/terminal.mjs";
import { installTerminalWebSocketEndpoint } from "../server/terminal-websocket.mjs";

const PASSWORD = "websocket-terminal-integration-password";
const ORIGIN = "http://127.0.0.1";
const authorization = `Basic ${Buffer.from(`devmoter:${PASSWORD}`).toString("base64")}`;

function fakePty() {
  const child = new EventEmitter();
  child.onData = listener => child.on("data", listener);
  child.onExit = listener => child.on("exit", listener);
  child.write = data => { child.lastInput = data; };
  child.resize = (cols, rows) => { child.size = { cols, rows }; };
  child.kill = signal => child.emit("exit", { exitCode: null, signal });
  return child;
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

function request(headers = {}, body = "") {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.headers = { authorization, ...headers };
  return req;
}

function openSocket(url, ticket, origin = `${ORIGIN}:${new URL(url).port}`) {
  return new WebSocket(url, ["devmoter-terminal.v1", ...(ticket ? [`devmoter-ticket.${ticket}`] : [])], {
    headers: { origin }
  });
}

function waitForRejectedSocket(socket) {
  return new Promise(resolve => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("error", () => resolve(null));
  });
}

test("WebSocket PTY requires same Origin and a single-use authenticated ticket", async () => {
  const child = fakePty();
  const terminal = createTerminalManager({
    authPassword: PASSWORD,
    resolveProject: async id => ({ id, name: id, path: `/tmp/${id}` }),
    spawnPty: () => child
  });
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const endpoint = installTerminalWebSocketEndpoint(server, terminal, { publicOrigin: origin });

  try {
    const createResponse = response();
    await terminal.create(request({ "x-devmoter-terminal-entry": "explicit" }, JSON.stringify({ projectId: "project" })), createResponse);
    assert.equal(createResponse.statusCode, 201);
    const created = JSON.parse(createResponse.body);
    const id = created.session.id;
    const path = `/api/terminal/sessions/${id}/socket?after=0`;
    const ticketResponse = response();
    await terminal.issueSocketTicket(request({ origin, "x-devmoter-terminal-token": created.token }), ticketResponse, id);
    assert.equal(ticketResponse.statusCode, 201);
    const ticket = JSON.parse(ticketResponse.body).ticket;
    const url = `ws://127.0.0.1:${address.port}${path}`;

    const unauthenticated = await openSocket(url, "", origin);
    assert.equal(await waitForRejectedSocket(unauthenticated), 401);

    const wrongOrigin = await openSocket(url, ticket, "https://attacker.example");
    assert.equal(await waitForRejectedSocket(wrongOrigin), 403);

    const freshTicketResponse = response();
    await terminal.issueSocketTicket(request({ origin, "x-devmoter-terminal-token": created.token }), freshTicketResponse, id);
    const freshTicket = JSON.parse(freshTicketResponse.body).ticket;
    const socket = await openSocket(url, freshTicket, origin);
    await once(socket, "open");
    assert.equal(socket.protocol, "devmoter-terminal.v1");

    const outputPromise = once(socket, "message");
    child.emit("data", "\u001b[32mready\u001b[0m\r\n");
    const [output] = await outputPromise;
    const outputItem = JSON.parse(output.toString("utf8"));
    assert.equal(outputItem.seq, 2);
    assert.equal(typeof outputItem.at, "number");
    assert.equal(outputItem.stream, "stdout");
    assert.equal(outputItem.data, "\u001b[32mready\u001b[0m\r\n");

    socket.send(JSON.stringify({ type: "input", data: "git status\r" }));
    socket.send(JSON.stringify({ type: "resize", cols: 100, rows: 40 }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(child.lastInput, "git status\r");
    assert.deepEqual(child.size, { cols: 100, rows: 40 });
    const closed = once(socket, "close");
    socket.close();
    await closed;

    const replay = await openSocket(url, freshTicket, origin);
    assert.equal(await waitForRejectedSocket(replay), 403);
  } finally {
    terminal.shutdown();
    endpoint.close();
    await new Promise(resolve => server.close(resolve));
  }
});
