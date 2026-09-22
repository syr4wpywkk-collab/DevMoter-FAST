import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

export class AcpAdapter extends EventEmitter {
  constructor({ command, args = [], cwd = process.cwd(), spawnImpl = spawn } = {}) {
    super();
    this.command = String(command || "").trim();
    this.args = Array.isArray(args) ? args.map(value => String(value)) : [];
    this.cwd = cwd;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.lines = null;
    this.pending = new Map();
    this.nextId = 1;
    this.initialized = null;
  }

  async connect({ timeoutMs = 10000 } = {}) {
    if (this.initialized && this.child?.stdin?.writable) return this.initialized;
    if (!this.command) throw new Error("ACP adapter command is not configured");

    const child = this.spawnImpl(this.command, this.args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    child.stderr?.resume?.();

    child.once("error", error => this.#fail(error));
    child.once("exit", (code, signal) => {
      this.#fail(new Error("ACP agent exited (code=" + (code ?? "null") + ", signal=" + (signal ?? "null") + ")"));
    });

    this.lines = readline.createInterface({ input: child.stdout });
    this.lines.on("line", line => this.#handleLine(line));

    const result = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: {
        name: "devmoter-fast",
        title: "DevMoter FAST",
        version: "0.2.0"
      }
    }, { timeoutMs, skipConnect: true });
    this.initialized = result;
    this.emit("ready", result);
    return result;
  }

  async request(method, params = {}, { timeoutMs = 30000, skipConnect = false } = {}) {
    if (!skipConnect) await this.connect();
    if (!this.child?.stdin?.writable) throw new Error("ACP agent is not writable");
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error("ACP request timeout: " + method));
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
      this.#write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params = {}) {
    this.#write({ jsonrpc: "2.0", method, params });
  }

  async newSession({ cwd = this.cwd, mcpServers = [] } = {}) {
    if (!String(cwd).startsWith("/")) throw new Error("ACP session cwd must be an absolute path");
    return this.request("session/new", { cwd, mcpServers });
  }

  async prompt(sessionId, text, { timeoutMs = 180000 } = {}) {
    if (!sessionId) throw new Error("ACP session id is required");
    return this.request("session/prompt", {
      sessionId: String(sessionId),
      prompt: [{ type: "text", text: String(text || "") }]
    }, { timeoutMs });
  }

  cancel(sessionId) {
    if (!sessionId) return;
    this.notify("session/cancel", { sessionId: String(sessionId) });
  }

  close() {
    this.lines?.close?.();
    this.lines = null;
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.initialized = null;
    this.#fail(new Error("ACP adapter closed"));
  }

  #handleLine(line) {
    const text = String(line || "").trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      this.emit("protocol-error", { error: "Invalid JSON", line: text.slice(0, 400) });
      return;
    }

    if (message && "id" in message && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) {
        const error = new Error(message.error.message || ("ACP request failed: " + pending.method));
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message && typeof message.method === "string" && !("id" in message)) {
      this.emit("notification", { method: message.method, params: message.params || {} });
      return;
    }

    if (message && typeof message.method === "string" && "id" in message) {
      this.emit("client-request", {
        id: message.id,
        method: message.method,
        params: message.params || {}
      });
      this.#write({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: "DevMoter ACP compatibility adapter does not grant client-side capabilities implicitly"
        }
      });
    }
  }

  #write(message) {
    if (!this.child?.stdin?.writable) throw new Error("ACP agent is offline");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  #fail(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.initialized = null;
    this.emit("offline", { error: error instanceof Error ? error.message : String(error) });
  }
}

export function createAgentAdapterRegistry(settings) {
  const acp = settings?.adapters?.acp || {};
  const adapters = [
    {
      id: "codex",
      protocol: "native-codex-app-server",
      enabled: true,
      native: true,
      priority: 100,
      capabilities: ["chat", "streaming", "approvals", "files", "mcp", "skills"]
    },
    {
      id: "opencode",
      protocol: "native-opencode-http",
      enabled: true,
      native: true,
      priority: 90,
      capabilities: ["chat", "streaming", "approvals", "commands", "skills"]
    },
    {
      id: "acp",
      protocol: "agent-client-protocol-v1",
      enabled: Boolean(acp.enabled),
      native: false,
      priority: 50,
      command: Boolean(acp.enabled) ? String(acp.command || "") : "",
      args: Boolean(acp.enabled) && Array.isArray(acp.args) ? acp.args.map(String) : [],
      capabilities: Array.isArray(acp.capabilities) ? acp.capabilities.map(String) : []
    }
  ];
  return adapters;
}
