import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import {
  BROWSER_PROTOCOL,
  createBrowserSocketTickets,
  encodeFrame,
  installBrowserWebSocketEndpoint
} from "../server/browser-websocket.mjs";

const SESSION = "11111111-2222-4333-8444-555555555555";

test("browser socket tickets are single use, short lived and bound", () => {
  let clock = 0;
  const tickets = createBrowserSocketTickets({ now: () => clock, maxPending: 2 });
  const grant = { sessionId: SESSION, deviceId: "d", origin: "http://localhost:8787", generation: 1 };
  const { ticket, expiresInMs } = tickets.issue(grant);
  assert.match(ticket, /^[0-9a-f]{64}$/);
  assert.equal(expiresInMs, 20000);
  assert.equal(tickets.consume(ticket, { sessionId: SESSION, origin: "http://evil.test" }), null);
  assert.equal(tickets.consume(ticket, { sessionId: SESSION, origin: grant.origin }), null, "a failed check burns the ticket");

  const second = tickets.issue(grant).ticket;
  assert.equal(tickets.consume(second, { sessionId: SESSION, origin: grant.origin }).generation, 1);
  assert.equal(tickets.consume(second, { sessionId: SESSION, origin: grant.origin }), null);

  const late = tickets.issue(grant).ticket;
  clock += 20000;
  assert.equal(tickets.consume(late, { sessionId: SESSION, origin: grant.origin }), null);

  const replaced = tickets.issue(grant).ticket;
  tickets.issue(grant);
  assert.equal(tickets.consume(replaced, { sessionId: SESSION, origin: grant.origin }), null, "a new ticket replaces the device's older one");
  tickets.issue({ ...grant, deviceId: "e" });
  assert.throws(() => tickets.issue({ ...grant, deviceId: "f" }), error => error.code === "ticket_limit");
  tickets.revokeDevice("e");
  tickets.revokeSession(SESSION);
  assert.equal(tickets.size, 0);
});

test("frames are framed as DMBF + seq + size + JPEG", () => {
  const encoded = encodeFrame({ seq: 7, width: 390, height: 700, data: Buffer.from([0xff, 0xd8]) });
  assert.equal(encoded.subarray(0, 4).toString("ascii"), "DMBF");
  assert.equal(encoded.readUInt32BE(4), 7);
  assert.equal(encoded.readUInt16BE(8), 390);
  assert.equal(encoded.readUInt16BE(10), 700);
  assert.deepEqual([...encoded.subarray(12)], [0xff, 0xd8]);
});

function fakeManager() {
  const state = { generation: 1, acts: [], acks: [], detached: 0, sink: null };
  return {
    state,
    get(sessionId, { deviceId }) {
      if (sessionId !== SESSION || deviceId !== "d") throw Object.assign(new Error("nope"), { statusCode: 404 });
      return { id: SESSION, driver: { holder: "user", generation: state.generation } };
    },
    attachViewer(sessionId, sink) {
      state.sink = sink;
      sink.event({ t: "hello" });
      return { ack: seq => { state.acks.push(seq); return true; }, detach: () => { state.detached += 1; } };
    },
    async act(sessionId, action, options) {
      state.acts.push({ action, options });
      if (options.generation !== state.generation) throw Object.assign(new Error("stale"), { code: "stale_generation" });
      return { ok: true, data: Buffer.from("x") };
    }
  };
}

async function setup(t, options = {}) {
  const server = createServer((req, res) => res.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const manager = fakeManager();
  const tickets = createBrowserSocketTickets();
  const endpoint = installBrowserWebSocketEndpoint(server, manager, tickets, { trustedProxies: [], ...options });
  t.after(() => { endpoint.close(); server.close(); });
  const url = "ws://127.0.0.1:" + server.address().port + "/api/browser/sessions/" + SESSION + "/socket";
  const issue = () => tickets.issue({ sessionId: SESSION, deviceId: "d", origin, generation: manager.state.generation }).ticket;
  const connect = (ticket, { protocol = BROWSER_PROTOCOL, socketOrigin = origin } = {}) => new Promise(resolve => {
    const socket = new WebSocket(url, [protocol, "devmoter-ticket." + ticket], { origin: socketOrigin });
    const messages = [];
    socket.on("message", (data, isBinary) => messages.push(isBinary ? data : JSON.parse(String(data))));
    socket.on("open", () => resolve({ socket, messages, status: 101 }));
    socket.on("unexpected-response", (req, res) => resolve({ status: res.statusCode }));
    socket.on("error", () => resolve({ status: 0 }));
  });
  return { manager, tickets, issue, connect, origin, url };
}

const until = async check => {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(check());
};

test("browser socket upgrade checks Origin, subprotocol, ticket and generation", async t => {
  const { manager, issue, connect, url } = await setup(t);
  assert.equal((await connect(issue(), { socketOrigin: "http://evil.test" })).status, 403);
  assert.equal((await connect(issue(), { protocol: "other" })).status, 401);
  assert.equal((await connect("0".repeat(64))).status, 403);
  assert.equal(await new Promise(resolve => {
    const socket = new WebSocket(url.replace("/socket", "/other"), [BROWSER_PROTOCOL]);
    socket.on("unexpected-response", (req, res) => resolve(res.statusCode));
    socket.on("error", () => resolve(0));
  }), 404, "unknown /api/browser/ upgrades are closed");
  const used = issue();
  const first = await connect(used);
  assert.equal(first.status, 101);
  assert.equal(first.socket.protocol, BROWSER_PROTOCOL);
  first.socket.close();
  assert.equal((await connect(used)).status, 403, "tickets are single use");
  const stale = issue();
  manager.state.generation = 2;
  assert.equal((await connect(stale)).status, 409, "a takeover invalidates tickets issued before it");
});

test("browser socket rejects a revoked device", async t => {
  const { issue, connect } = await setup(t, { isDeviceActive: async () => false });
  assert.equal((await connect(issue())).status, 403);
});

test("browser socket relays frames, ACKs and generation-checked actions", async t => {
  const audited = [];
  const { manager, issue, connect } = await setup(t, { audit: { record: entry => { String(entry.action.type); audited.push(entry); } } });
  const { socket, messages } = await connect(issue());
  await until(() => messages.length >= 1);
  assert.equal(messages[0].t, "hello");
  manager.state.sink.frame({ seq: 3, width: 10, height: 20, data: Buffer.from([0xff, 0xd8]) });
  await until(() => messages.length >= 2);
  assert.equal(messages[1].subarray(0, 4).toString("ascii"), "DMBF");
  socket.send(JSON.stringify({ t: "ack", seq: 3 }));
  socket.send(JSON.stringify({ t: "act", id: 1, generation: 1, action: { type: "click", x: 1, y: 2 } }));
  socket.send(JSON.stringify({ t: "act", id: 2, generation: 0, action: { type: "click", x: 1, y: 2 } }));
  socket.send(JSON.stringify({ t: "ping" }));
  await until(() => messages.length >= 5);
  socket.send(JSON.stringify({ t: "act", id: 3, generation: 1, action: { type: { toString: 1 } } }));
  await until(() => messages.some(message => message.t === "result" && message.id === 3));
  assert.deepEqual(manager.state.acks, [3]);
  assert.equal(manager.state.acts[0].options.holder, "user");
  assert.equal(manager.state.acts[0].options.deviceId, "d");
  const results = messages.filter(message => message.t === "result");
  assert.deepEqual(results.find(r => r.id === 1), { t: "result", id: 1, ok: true, result: { ok: true } });
  assert.deepEqual(results.find(r => r.id === 2), { t: "result", id: 2, ok: false, error: "stale_generation" });
  assert.ok(messages.some(message => message.t === "pong"));
  assert.deepEqual(audited.map(({ actor, deviceId, event, sessionId, capability, transport, ok, code }) => ({ actor, deviceId, event, sessionId, capability, transport, ok, code })), [
    { actor: "user", deviceId: "d", event: "action", sessionId: SESSION, capability: "browser.act", transport: "websocket", ok: true, code: undefined },
    { actor: "user", deviceId: "d", event: "action", sessionId: SESSION, capability: "browser.act", transport: "websocket", ok: false, code: "stale_generation" }
  ]);
  const closed = once(socket, "close");
  socket.close();
  await closed;
  await until(() => manager.state.detached === 1);
});

test("browser socket closes on bad messages, oversized payloads and floods", async t => {
  const { issue, connect } = await setup(t);
  const bad = await connect(issue());
  bad.socket.send("not json");
  assert.equal((await once(bad.socket, "close"))[0], 4400);

  const big = await connect(issue());
  big.socket.send(JSON.stringify({ t: "ping", pad: "x".repeat(17 * 1024) }));
  assert.equal((await once(big.socket, "close"))[0], 1009);

  const flood = await connect(issue());
  for (let i = 0; i < 80; i += 1) flood.socket.send(JSON.stringify({ t: "ping" }));
  assert.equal((await once(flood.socket, "close"))[0], 4029);
});
