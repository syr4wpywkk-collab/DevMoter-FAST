import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval"
]);

const APPROVAL_DECISIONS = new Set([
  "accept",
  "acceptForSession",
  "decline",
  "cancel"
]);

export class CodexBridge extends EventEmitter {
  constructor({
    bin = process.env.CODEX_BIN || "codex",
    cwd = process.env.CODEX_CWD || process.cwd(),
    spawnImpl = spawn
  } = {}) {
    super();
    this.bin = bin;
    this.cwd = cwd;
    this.child = null;
    this.readline = null;
    this.ready = false;
    this.starting = null;
    this.nextId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.lastError = null;
    this.serverInfo = null;
    this.spawnImpl = spawnImpl;
  }

  async start() {
    if (this.ready && this.child && !this.child.killed) return this.serverInfo;
    if (this.starting) return this.starting;

    this.starting = this.#spawnAndInitialize();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async #spawnAndInitialize() {
    this.ready = false;
    this.lastError = null;

    const child = this.spawnImpl(this.bin, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child = child;
    child.stderr.resume();

    const lines = readline.createInterface({ input: child.stdout });
    this.readline = lines;
    lines.on("line", line => this.#handleLine(line));

    child.once("error", error => {
      this.lastError = String(error);
      this.#rejectAll(error);
      this.emit("offline", { error: this.lastError });
    });

    child.once("exit", (code, signal) => {
      const error = new Error(
        `codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
      );
      this.ready = false;
      this.lastError = error.message;
      this.#rejectAll(error);
      this.serverRequests.clear();
      this.emit("offline", { error: this.lastError });
    });

    const init = await this.request(
      "initialize",
      {
        clientInfo: {
          name: "devmoter_fast",
          title: "DevMoter FAST",
          version: "0.2.0"
        },
        capabilities: {
          experimentalApi: true
        }
      },
      { skipStart: true, timeoutMs: 10000 }
    );

    this.notify("initialized");
    this.ready = true;
    this.serverInfo = init;
    this.emit("online", init);
    return init;
  }

  async request(method, params = {}, { skipStart = false, timeoutMs = 30000 } = {}) {
    if (!skipStart) await this.start();
    if (!this.child?.stdin?.writable) throw new Error("Codex app-server is not writable");

    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Codex RPC timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(String(id), {
        method,
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        }
      });

      this.#write({ id, method, params });
    });
  }

  notify(method, params) {
    const message = params === undefined ? { method } : { method, params };
    this.#write(message);
  }

  async health() {
    try {
      const info = await this.start();
      return {
        online: true,
        ready: this.ready,
        bin: this.bin,
        cwd: this.cwd,
        serverInfo: info ?? null
      };
    } catch (error) {
      this.lastError = String(error);
      return {
        online: false,
        ready: false,
        bin: this.bin,
        cwd: this.cwd,
        error: this.lastError
      };
    }
  }

  respondApproval(id, decision) {
    const key = String(id);
    const pending = this.serverRequests.get(key);
    if (!pending) throw new Error("Approval request is no longer pending");
    if (!APPROVAL_METHODS.has(pending.method)) {
      throw new Error(`Unsupported server request: ${pending.method}`);
    }
    if (!APPROVAL_DECISIONS.has(decision)) {
      throw new Error("Unsupported approval decision");
    }

    this.#write({ id: pending.id, result: { decision } });
    this.serverRequests.delete(key);
  }

  #handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (message && "id" in message && !("method" in message)) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));

      if ("error" in message) {
        const error = new Error(message.error?.message || `Codex RPC failed: ${pending.method}`);
        error.data = message.error?.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message && "id" in message && typeof message.method === "string") {
      const record = {
        id: message.id,
        method: message.method,
        params: message.params ?? {}
      };
      this.serverRequests.set(String(message.id), record);
      this.emit("server-request", record);
      return;
    }

    if (message && typeof message.method === "string") {
      this.emit("notification", {
        method: message.method,
        params: message.params ?? {}
      });
    }
  }

  #write(message) {
    if (!this.child?.stdin?.writable) throw new Error("Codex app-server is offline");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
