import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { AcpAdapter } from "./acp-adapter.mjs";
import { assertCliReady, launchCode } from "./cli-launch.mjs";
import { errorMessage } from "./error-message.mjs";

const AUTH_TIMEOUT_MS = 5_000;
const AUTH_OUTPUT_LIMIT = 64 * 1024;

/**
 * Parse `devin auth status` output.
 *
 * The CLI exits 0 whether or not the user is logged in, so the only
 * reliable signal is the leading text:
 *   "Logged in (via Devin)."  -> true
 *   "Not logged in."           -> false
 * Anything else is unknown (null).
 * The full output contains account details (email, team id, ...) and
 * must never be forwarded to clients; callers only receive the boolean.
 */
export function parseDevinAuthStatus(output) {
  const text = String(output || "").trimStart();
  if (text.startsWith("Logged in")) return true;
  if (text.startsWith("Not logged in")) return false;
  return null;
}

function defaultRunAuthStatus(binOrPath) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    let child;
    try {
      child = spawn(String(binOrPath || "devin"), ["auth", "status"], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }
    const collect = chunk => {
      if (output.length < AUTH_OUTPUT_LIMIT) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finish(resolve, output);
    }, AUTH_TIMEOUT_MS);
    child.once("error", error => finish(reject, error));
    child.once("close", () => finish(resolve, output));
  });
}

function normalizeAuthResult(result) {
  if (typeof result === "string") return parseDevinAuthStatus(result);
  if (result && typeof result === "object") {
    if (typeof result.loggedIn === "boolean") return result.loggedIn;
    const text = result.stdout ?? result.output ?? result.text ?? "";
    const parsed = parseDevinAuthStatus(text);
    if (parsed !== null) return parsed;
    if (typeof result.code === "number") return null;
  }
  if (typeof result === "boolean") return result;
  return null;
}

const CANCELLED_PERMISSION = Object.freeze({ outcome: { outcome: "cancelled" } });
const MAX_PENDING_PERMISSIONS = 8;

/**
 * Fails closed when a Devin client request is not explicitly handled.
 * Never select allow_once or allow_always without an owner's response.
 */
export function devinClientRequestHandler({ method } = {}) {
  return method === "session/request_permission" ? CANCELLED_PERMISSION : undefined;
}

/**
 * Devin backend bridge.
 *
 * Wraps a long-lived `devin acp` child process through the generic
 * AcpAdapter (ACP v1, stdio NDJSON JSON-RPC). Mirrors CodexBridge's
 * shape: injectable bin / prepareCli / spawnImpl, health() returning
 * { online, ready, ... , error, code } on failure.
 *
 * Permission requests wait for an explicit owner decision, with timeout,
 * a bounded queue, session matching and fail-closed disconnect behavior.
 * Other client-side capabilities remain denied by AcpAdapter.
 */
export class DevinBridge extends EventEmitter {
  constructor({
    bin = process.env.DEVIN_BIN || "devin",
    cwd = process.env.DEVIN_CWD || process.cwd(),
    spawnImpl = spawn,
    prepareCli = assertCliReady,
    runAuthStatus = defaultRunAuthStatus,
    permissionTimeoutMs = 60_000,
    adapter = null,
    env = null,
    inheritEnvKeys = []
  } = {}) {
    super();
    this.bin = bin;
    this.cwd = cwd;
    this.spawnImpl = spawnImpl;
    this.prepareCli = prepareCli;
    this.runAuthStatus = runAuthStatus;
    this.lastError = null;
    this.launchCode = null;
    this.serverInfo = null;
    this.loggedIn = null;

    this.permissionTimeoutMs = Math.max(50, Math.min(120_000, permissionTimeoutMs));
    this.pendingPermissions = new Map();
    const permissionHandler = request => this.handleClientRequest(request);
    if (adapter && typeof adapter === "object") {
      // Even injected adapters must not retain an unsafe auto-allow handler.
      adapter.clientRequestHandler = permissionHandler;
    }
    this.adapter = adapter || new AcpAdapter({
      command: bin,
      args: ["acp"],
      cwd,
      env,
      inheritEnvKeys,
      spawnImpl,
      clientRequestHandler: permissionHandler
    });

    // Re-emit adapter events so SSE handlers can subscribe to the bridge
    // exactly like they subscribe to CodexBridge.
    this.adapter.on("notification", event => this.emit("notification", event));
    this.adapter.on("client-request", event => this.emit("client-request", event));
    this.adapter.on("offline", event => {
      this.cancelPendingPermissions();
      this.serverInfo = null;
      this.emit("offline", event);
    });
    // AcpAdapter emits "ready" with the initialize result.
    if (typeof this.adapter.on === "function") {
      this.adapter.on("ready", info => {
        this.serverInfo = info;
        this.emit("online", info);
        this.emit("ready", info);
      });
    }
  }

  /** Only non-sensitive request metadata is sent to the owner UI. */
  pendingPermissionRequests() {
    return [...this.pendingPermissions.values()].map(({ requestId, sessionId, title, kind }) =>
      ({ requestId, sessionId, title, kind })
    );
  }

  handleClientRequest({ method, params } = {}) {
    if (method !== "session/request_permission") return undefined;
    const sessionId = typeof params?.sessionId === "string" ? params.sessionId : "";
    const allowOnce = Array.isArray(params?.options)
      ? params.options.find(option => option?.kind === "allow_once" && typeof option.optionId === "string" && option.optionId.length > 0)
      : null;
    // Reject requests that cannot be approved once, or cannot be linked to a session.
    if (!sessionId || !allowOnce || this.pendingPermissions.size >= MAX_PENDING_PERMISSIONS) {
      return CANCELLED_PERMISSION;
    }
    const requestId = randomUUID();
    const title = typeof params?.toolCall?.title === "string"
      ? params.toolCall.title.slice(0, 240) : "Devin tool operation";
    const kind = typeof params?.toolCall?.kind === "string"
      ? params.toolCall.kind.slice(0, 64) : "other";
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.resolvePermission({ requestId, sessionId, decision: "deny" });
      }, this.permissionTimeoutMs);
      timeout.unref?.();
      this.pendingPermissions.set(requestId, { requestId, sessionId, title, kind, optionId: allowOnce.optionId, resolve, timeout });
      this.emit("permission-request", { requestId, sessionId, title, kind });
    });
  }

  resolvePermission({ requestId, sessionId, decision } = {}) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending || !sessionId || pending.sessionId !== sessionId || !["allow_once", "deny"].includes(decision)) {
      return false;
    }
    clearTimeout(pending.timeout);
    this.pendingPermissions.delete(requestId);
    const outcome = decision === "allow_once"
      ? { outcome: { outcome: "selected", optionId: pending.optionId } }
      : CANCELLED_PERMISSION;
    pending.resolve(outcome);
    this.emit("permission-resolved", { requestId, sessionId });
    return true;
  }

  cancelPendingPermissions(sessionId = null) {
    for (const pending of [...this.pendingPermissions.values()]) {
      if (!sessionId || pending.sessionId === sessionId) {
        this.resolvePermission({ requestId: pending.requestId, sessionId: pending.sessionId, decision: "deny" });
      }
    }
  }

  async connect(options) {
    return this.adapter.connect(options);
  }

  async request(method, params = {}, options = {}) {
    return this.adapter.request(method, params, options);
  }

  notify(method, params = {}) {
    // Fast path: already connected — write synchronously like AcpAdapter.
    if (this.adapter.child?.stdin?.writable) {
      this.adapter.notify(method, params);
      return Promise.resolve();
    }
    // Otherwise lazily connect first, then send the notification.
    return this.adapter.connect()
      .then(() => { this.adapter.notify(method, params); });
  }

  cancel(sessionId) {
    if (!sessionId) return Promise.resolve();
    this.cancelPendingPermissions(String(sessionId));
    if (this.adapter.child?.stdin?.writable) {
      this.adapter.cancel(sessionId);
      return Promise.resolve();
    }
    return this.adapter.connect()
      .then(() => { this.adapter.cancel(sessionId); });
  }

  async newSession(options) {
    return this.adapter.newSession(options);
  }

  async prompt(sessionId, text, options) {
    return this.adapter.prompt(sessionId, text, options);
  }

  close() {
    this.cancelPendingPermissions();
    try { this.adapter.close(); } catch { /* ignore */ }
    this.serverInfo = null;
  }

  async health() {
    // 1) Installation check (prepareCli / assertCliReady).
    let resolvedPath = this.bin;
    try {
      const ready = await this.prepareCli(this.bin);
      if (ready && typeof ready.resolvedPath === "string" && ready.resolvedPath) {
        resolvedPath = ready.resolvedPath;
      }
    } catch (error) {
      this.launchCode = launchCode(error) || error?.code || "failed";
      // launchCode() only recognises not_installed / not_executable / failed;
      // preserve a CliLaunchError code when present, otherwise fall back.
      if (!["not_installed", "not_executable", "failed"].includes(this.launchCode)) {
        this.launchCode = "failed";
        if (error?.code === "not_installed" || error?.code === "not_executable") {
          this.launchCode = error.code;
        }
      }
      this.lastError = errorMessage(error);
      return {
        online: false,
        ready: false,
        loggedIn: false,
        bin: this.bin,
        cwd: this.cwd,
        error: this.lastError,
        code: this.launchCode
      };
    }

    // 2) Login check via `devin auth status` leading text.
    //    The raw output (email etc.) is never included in the result.
    let loggedIn = null;
    try {
      const authResult = await this.runAuthStatus(resolvedPath);
      loggedIn = normalizeAuthResult(authResult);
    } catch {
      loggedIn = null;
    }
    this.loggedIn = loggedIn;

    if (loggedIn === false) {
      const error = "Devin is not logged in. Run `devin auth login` first.";
      this.lastError = error;
      this.launchCode = "not_logged_in";
      return {
        online: false,
        ready: false,
        loggedIn: false,
        bin: this.bin,
        cwd: this.cwd,
        error,
        code: "not_logged_in"
      };
    }

    // 3) ACP handshake — reuses the persistent child when already up.
    try {
      const info = await this.adapter.connect();
      this.serverInfo = info;
      this.lastError = null;
      this.launchCode = null;
      return {
        online: true,
        ready: true,
        loggedIn: loggedIn === true ? true : loggedIn,
        bin: this.bin,
        cwd: this.cwd,
        serverInfo: info ?? null
      };
    } catch (error) {
      const code = launchCode(error) || "failed";
      this.launchCode = code;
      this.lastError = errorMessage(error);
      return {
        online: false,
        ready: false,
        loggedIn: loggedIn === true ? true : loggedIn,
        bin: this.bin,
        cwd: this.cwd,
        error: this.lastError,
        code
      };
    }
  }
}

export { defaultRunAuthStatus };
