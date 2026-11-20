import { spawn } from "node:child_process";
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

/**
 * Handle a client-side request from the Devin agent.
 *
 * v1 policy: auto-approve `session/request_permission` by selecting
 * the `allow_once` option (falling back to `allow_always` when no
 * `allow_once` option is offered). This is intentional for v1: even
 * in the default `accept-edits` mode Devin issues permission
 * requests for terminal / exec tools, and rejecting them (-32601)
 * ends the turn with tool_rejected. The Devin session mode is the
 * substantive control here; a UI approval flow is future work.
 * All other client requests return undefined so AcpAdapter falls
 * back to its default -32601 rejection (no implicit capabilities).
 */
export function devinClientRequestHandler({ method, params } = {}) {
  if (method !== "session/request_permission") return undefined;
  const options = Array.isArray(params?.options) ? params.options : [];
  const chosen =
    options.find(option => option && option.kind === "allow_once") ||
    options.find(option => option && option.kind === "allow_always");
  if (!chosen || chosen.optionId === undefined || chosen.optionId === null) return undefined;
  return { outcome: { outcome: "selected", optionId: chosen.optionId } };
}

/**
 * Devin backend bridge.
 *
 * Wraps a long-lived `devin acp` child process through the generic
 * AcpAdapter (ACP v1, stdio NDJSON JSON-RPC). Mirrors CodexBridge's
 * shape: injectable bin / prepareCli / spawnImpl, health() returning
 * { online, ready, ... , error, code } on failure.
 *
 * Permission requests: AcpAdapter is created with
 * `devinClientRequestHandler` (see above). v1 auto-approves
 * `session/request_permission` with `allow_once`; the Devin session
 * mode is the substantive control and a UI approval flow is a
 * future task. Other client requests keep the adapter's -32601
 * fallback.
 */
export class DevinBridge extends EventEmitter {
  constructor({
    bin = process.env.DEVIN_BIN || "devin",
    cwd = process.env.DEVIN_CWD || process.cwd(),
    spawnImpl = spawn,
    prepareCli = assertCliReady,
    runAuthStatus = defaultRunAuthStatus,
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

    if (adapter && typeof adapter === "object" && !adapter.clientRequestHandler) {
      // Injected adapter (tests / embedding): install the same v1
      // permission handler so behaviour does not depend on who
      // constructed the adapter.
      try { adapter.clientRequestHandler = devinClientRequestHandler; } catch { /* ignore */ }
    }
    this.adapter = adapter || new AcpAdapter({
      command: bin,
      args: ["acp"],
      cwd,
      env,
      inheritEnvKeys,
      spawnImpl,
      // v1: auto-approve session/request_permission via allow_once
      // (see devinClientRequestHandler); other methods fall back
      // to AcpAdapter's -32601 rejection.
      clientRequestHandler: devinClientRequestHandler
    });

    // Re-emit adapter events so SSE handlers can subscribe to the bridge
    // exactly like they subscribe to CodexBridge.
    this.adapter.on("notification", event => this.emit("notification", event));
    this.adapter.on("client-request", event => this.emit("client-request", event));
    this.adapter.on("offline", event => {
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
