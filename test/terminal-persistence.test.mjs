import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { createTerminalManager } from "../server/terminal.mjs";
import { TerminalSessionStore } from "../server/terminal-session-store.mjs";
import { spawn as spawnPty } from "node-pty";

const PASSWORD = "terminal-persistence-test-password";
const authorization = `Basic ${Buffer.from(`devmoter:${PASSWORD}`).toString("base64")}`;
const execFileAsync = promisify(execFile);

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
    getHeader(name) { return this.headers[name.toLowerCase()]; },
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
  child.onData = listener => child.on("data", listener);
  child.onExit = listener => child.on("exit", listener);
  child.write = data => child.writes.push(data);
  child.resize = () => {};
  child.kill = signal => child.emit("exit", { exitCode: null, signal });
  return child;
}

function tmuxHarness() {
  const active = new Set();
  const calls = [];
  return {
    active,
    calls,
    async run(args) {
      calls.push(args);
      if (args[0] === "new-session") active.add(args[3]);
      else if (args[0] === "has-session" && !active.has(args[2])) throw new Error("missing session");
      else if (args[0] === "kill-session") active.delete(args[2]);
      return { stdout: "", stderr: "" };
    }
  };
}

function makeManager({ storeFile, tmux, children }) {
  return createTerminalManager({
    authPassword: PASSWORD,
    resolveProject: async id => ({ id, name: id, path: `/tmp/${id}` }),
    sessionStoreFile: storeFile,
    tmuxArgs: [],
    runTmux: tmux.run,
    spawnPty: (...args) => {
      const child = fakePty();
      children.push({ child, args });
      return child;
    }
  });
}

test("persistent terminal survives manager restart and re-claim rotates its HttpOnly capability", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devmoter-terminal-persist-"));
  const storeFile = join(directory, "terminal-sessions.json");
  const tmux = tmuxHarness();
  const firstChildren = [];
  const first = makeManager({ storeFile, tmux, children: firstChildren });
  try {
    const createdResponse = response();
    await first.create(request({
      headers: { origin: "https://devmoter.example", "x-devmoter-terminal-entry": "explicit" },
      body: JSON.stringify({ projectId: "project-a", persistent: true, name: "api-dev" })
    }), createdResponse);
    assert.equal(createdResponse.statusCode, 201);
    const created = JSON.parse(createdResponse.body);
    assert.equal(created.session.name, "api-dev");
    assert.equal(created.session.persistent, true);
    assert.equal(Object.hasOwn(created, "token"), false);
    const firstCookie = createdResponse.headers["set-cookie"][0];
    assert.match(firstCookie, /HttpOnly/);
    assert.match(firstCookie, /SameSite=Strict/);
    assert.match(firstCookie, /; Secure/);
    assert.match(firstCookie, /Max-Age=43200/);
    assert.equal(firstChildren[0].args[0], "tmux");
    const persisted = JSON.parse(await readFile(storeFile, "utf8"));
    assert.equal(persisted.sessions[0].name, "api-dev");
    assert.equal(persisted.sessions[0].cwd, "/tmp/project-a");
    assert.equal(Object.hasOwn(persisted.sessions[0], "token"), false);
    assert.equal((await stat(storeFile)).mode & 0o077, 0);

    first.shutdown();
    assert.equal(tmux.active.size, 1, "manager shutdown detaches without killing the tmux session");

    const secondChildren = [];
    const second = makeManager({ storeFile, tmux, children: secondChildren });
    try {
      const listResponse = response();
      await second.listSessions(request(), listResponse);
      assert.equal(listResponse.statusCode, 200);
      const listed = JSON.parse(listResponse.body).sessions;
      assert.equal(listed.length, 1);
      assert.equal(listed[0].status, "detached");
      assert.equal(listed[0].name, "api-dev");

      const id = listed[0].id;
      const claimResponse = response();
      await second.claimSession(request({
        headers: { origin: "https://devmoter.example", "x-devmoter-terminal-entry": "explicit" }
      }), claimResponse, id);
      assert.equal(claimResponse.statusCode, 200);
      assert.equal(Object.hasOwn(JSON.parse(claimResponse.body), "token"), false);
      const cookie = claimResponse.headers["set-cookie"][0];
      const tokenCookie = cookie.match(/^[^=]+=([^;]+)/)?.[1];
      assert.ok(tokenCookie);

      const oldCookie = firstCookie.split(";")[0];
      const oldAccess = response();
      await second.info(request({ headers: { cookie: oldCookie } }), oldAccess, id);
      assert.equal(oldAccess.statusCode, 403, "claim revokes the previous browser capability");

      const info = response();
      await second.info(request({ headers: { cookie: cookie.split(";")[0] } }), info, id);
      assert.equal(info.statusCode, 200);
      assert.equal(secondChildren[0].args[0], "tmux");
      assert.deepEqual(secondChildren[0].args[1].slice(0, 2), ["attach-session", "-t"]);

      const terminate = response();
      await second.close(request({ headers: { cookie: cookie.split(";")[0] } }), terminate, id);
      assert.equal(terminate.statusCode, 200);
      assert.equal(tmux.active.size, 0, "explicit termination stops the named tmux process");
      assert.match(terminate.headers["set-cookie"][0], /Max-Age=0/);
    } finally {
      second.shutdown();
    }
  } finally {
    first.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("persistent sessions fail closed when the metadata file is broadly readable or malformed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devmoter-terminal-store-"));
  const file = join(directory, "sessions.json");
  try {
    const store = new TerminalSessionStore(file);
    await store.save([]);
    await chmod(file, 0o644);
    await assert.rejects(() => store.load(), /private regular file/);
    await chmod(file, 0o600);
    await writeFile(file, "not json", { mode: 0o600 });
    await assert.rejects(() => store.load(), /malformed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("expired persistent sessions are terminated and removed from metadata on load", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devmoter-terminal-expired-"));
  const storeFile = join(directory, "sessions.json");
  const tmux = tmuxHarness();
  const id = "a".repeat(36);
  const tmuxName = "devmoter-" + "b".repeat(24);
  tmux.active.add(tmuxName);
  try {
    const store = new TerminalSessionStore(storeFile);
    await store.save([{
      id,
      name: "expired-job",
      projectId: "project",
      projectName: "project",
      cwd: "/tmp/project",
      tmuxName,
      tokenHash: "c".repeat(64),
      createdAt: Date.now() - 60_000,
      lastActivityAt: Date.now() - 60_000,
      expiresAt: Date.now() - 1
    }]);
    const manager = makeManager({ storeFile, tmux, children: [] });
    const responseValue = response();
    await manager.listSessions(request(), responseValue);
    assert.equal(responseValue.statusCode, 200);
    assert.deepEqual(JSON.parse(responseValue.body).sessions, []);
    assert.equal(tmux.active.has(tmuxName), false);
    assert.deepEqual((await store.load()), []);
    manager.shutdown();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persistent mode is unavailable unless private metadata storage is configured", async () => {
  const children = [];
  const manager = createTerminalManager({
    authPassword: PASSWORD,
    resolveProject: async id => ({ id, name: id, path: `/tmp/${id}` }),
    spawnPty: () => { const child = fakePty(); children.push(child); return child; }
  });
  const res = response();
  await manager.create(request({
    headers: { "x-devmoter-terminal-entry": "explicit" },
    body: JSON.stringify({ projectId: "project", persistent: true, name: "api" })
  }), res);
  assert.equal(res.statusCode, 501);
  assert.equal(children.length, 0);
  manager.shutdown();
});

test("metadata writes recover after a transient storage failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devmoter-terminal-store-retry-"));
  const blockedParent = join(directory, "not-a-directory");
  await writeFile(blockedParent, "block");
  const store = new TerminalSessionStore(join(blockedParent, "sessions.json"));
  try {
    await assert.rejects(store.save([]));
    await rm(blockedParent);
    await mkdir(blockedParent);
    await store.save([]);
    assert.deepEqual(await store.load(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real tmux session remains usable after the DevMoter manager detaches", {
  skip: spawnSync("tmux", ["-V"], { stdio: "ignore" }).status !== 0
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "devmoter-tmux-smoke-"));
  const storeFile = join(directory, "sessions.json");
  const socketName = `devmoter-m15-${process.pid}-${Date.now().toString(36)}`;
  const tmuxArgs = ["-L", socketName];
  const runTmux = args => execFileAsync("tmux", args, { timeout: 5000, maxBuffer: 64 * 1024 });
  const options = {
    authPassword: PASSWORD,
    resolveProject: async id => ({ id, name: id, path: directory }),
    sessionStoreFile: storeFile,
    shell: "/bin/sh",
    tmuxArgs,
    runTmux,
    spawnPty
  };
  const first = createTerminalManager(options);
  let second;
  let socket;
  const origin = "https://devmoter.example";
  try {
    const createdResponse = response();
    await first.create(request({
      headers: { origin, "x-devmoter-terminal-entry": "explicit" },
      body: JSON.stringify({ projectId: "smoke", name: "smoke", persistent: true })
    }), createdResponse);
    assert.equal(createdResponse.statusCode, 201, createdResponse.body);
    const created = JSON.parse(createdResponse.body);
    const initialCookie = createdResponse.headers["set-cookie"][0].split(";")[0];
    const sessionId = created.session.id;
    const tmuxName = JSON.parse(await readFile(storeFile, "utf8")).sessions[0].tmuxName;
    await runTmux([...tmuxArgs, "has-session", "-t", tmuxName]);
    first.shutdown();

    second = createTerminalManager(options);
    const claim = response();
    await second.claimSession(request({
      headers: { origin, "x-devmoter-terminal-entry": "explicit" }
    }), claim, sessionId);
    assert.equal(claim.statusCode, 200);
    const cookie = claim.headers["set-cookie"][0].split(";")[0];
    assert.notEqual(cookie, initialCookie);

    const ticketResponse = response();
    await second.issueSocketTicket(request({ headers: { origin, cookie } }), ticketResponse, sessionId);
    assert.equal(ticketResponse.statusCode, 201);
    const { ticket } = JSON.parse(ticketResponse.body);
    const session = await second.authorizeSocket(request(), sessionId, ticket, origin);
    assert.ok(session?.process, "reattachment must create a tmux PTY client");

    socket = new EventEmitter();
    socket.readyState = 1;
    socket.bufferedAmount = 0;
    socket.sent = [];
    socket.send = (data, callback) => { socket.sent.push(JSON.parse(data)); callback?.(); };
    socket.close = (code, reason) => { socket.closed = { code, reason }; socket.emit("close"); };
    socket.terminate = () => socket.emit("close");
    second.attachSocket(session, socket, 0);

    const input = response();
    await second.input(request({
      headers: { cookie },
      body: JSON.stringify({ data: "printf 'M15_PERSIST_OK\\n'\r" })
    }), input, sessionId);
    assert.equal(input.statusCode, 200);
    const deadline = Date.now() + 5000;
    while (!socket.sent.some(item => String(item.data || "").includes("M15_PERSIST_OK")) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(socket.sent.some(item => String(item.data || "").includes("M15_PERSIST_OK")));

    const terminate = response();
    await second.close(request({ headers: { cookie } }), terminate, sessionId);
    assert.equal(terminate.statusCode, 200);
    await assert.rejects(() => runTmux([...tmuxArgs, "has-session", "-t", tmuxName]));
  } finally {
    if (socket && !socket.closed) socket.close(1000, "test cleanup");
    second?.shutdown();
    first.shutdown();
    await runTmux([...tmuxArgs, "kill-server"]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
