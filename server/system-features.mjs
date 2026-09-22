import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomInt,
  randomUUID,
  sign
} from "node:crypto";

const PAIRING_TTL_MS = 5 * 60 * 1000;
const VISIBLE_TTL_MS = 45 * 1000;
const NOTIFY_DEDUPE_MS = 30 * 1000;

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeLabel(value, fallback = "Browser") {
  const text = String(value || fallback).replace(/[\r\n\t]/g, " ").trim();
  return (text || fallback).slice(0, 80);
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path, value) {
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}

function deviceToken(req) {
  const value = req?.headers?.["x-devmoter-device-token"];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function requestHostname(req) {
  const raw = String(req?.headers?.host || "").trim();
  if (!raw) return "";
  if (raw === "::1") return "::1";
  try {
    return new URL("http://" + raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return raw.replace(/^\[|\]$/g, "").toLowerCase();
  }
}

function isLocalBootstrapRequest(req) {
  const address = String(req.socket?.remoteAddress || "");
  const host = requestHostname(req);
  const forwarded = String(req.headers["x-forwarded-for"] || "").trim();
  const localAddress = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  const localHost = host === "127.0.0.1" || host === "localhost" || host === "::1";
  return localAddress && localHost && !forwarded;
}

async function commandStatus(name, args = ["--version"]) {
  const pathParts = String(process.env.PATH || "").split(":").filter(Boolean);
  let found = false;
  for (const dir of pathParts) {
    try {
      await access(join(dir, name), fsConstants.X_OK);
      found = true;
      break;
    } catch {
      // keep looking
    }
  }
  if (!found) return { available: false, version: null };

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const result = await run(name, args, { timeout: 1500, maxBuffer: 16 * 1024 });
    const line = String(result.stdout || result.stderr || "").split(/\r?\n/).find(Boolean) || "";
    return { available: true, version: line.slice(0, 120) || null };
  } catch {
    return { available: true, version: null };
  }
}

function publicKeyFromJwk(jwk) {
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  return base64url(Buffer.concat([Buffer.from([4]), x, y]));
}

function jwtForPush(endpoint, vapid) {
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64url(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: "mailto:devmoter@localhost"
  }));
  const unsigned = `${header}.${payload}`;
  const key = createPrivateKey({ key: vapid.privateJwk, format: "jwk" });
  const signature = sign("sha256", Buffer.from(unsigned), {
    key,
    dsaEncoding: "ieee-p1363"
  });
  return `${unsigned}.${base64url(signature)}`;
}

async function sendEmptyPush(subscription, vapid) {
  const token = jwtForPush(subscription.endpoint, vapid);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      Urgency: "normal",
      Authorization: `vapid t=${token}, k=${vapid.publicKey}`
    },
    body: null,
    signal: AbortSignal.timeout(5000)
  });
}

export function createSystemFeatures({
  stateDir,
  appRoot,
  getProjects,
  getBackendHealth,
  host = "127.0.0.1",
  version = "0.0.0"
}) {
  const devicesFile = join(stateDir, "devices.json");
  const subscriptionsFile = join(stateDir, "push-subscriptions.json");
  const vapidFile = join(stateDir, "vapid.json");
  const pairings = new Map();
  const pendingNotifications = new Map();
  const recentNotifications = new Map();

  async function readDevices() {
    const data = await readJsonFile(devicesFile, { version: 1, devices: [] });
    return Array.isArray(data.devices) ? data.devices : [];
  }

  async function writeDevices(devices) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeJsonFile(devicesFile, { version: 1, devices });
  }

  async function authenticate(req, { optional = false } = {}) {
    const token = deviceToken(req);
    if (!token) {
      if (optional) return null;
      throw Object.assign(new Error("Trusted device token required"), { status: 401 });
    }

    const tokenHash = sha256(token);
    const devices = await readDevices();
    const index = devices.findIndex(device => device.tokenHash === tokenHash && !device.revokedAt);
    if (index < 0) {
      if (optional) return null;
      throw Object.assign(new Error("Invalid or revoked device token"), { status: 401 });
    }

    const now = Date.now();
    if (!devices[index].lastUsedAt || now - devices[index].lastUsedAt > 15_000) {
      devices[index].lastUsedAt = now;
      await writeDevices(devices);
    }
    return { ...devices[index], token };
  }

  async function issueDevice(label) {
    const token = base64url(randomBytes(32));
    const device = {
      id: randomUUID(),
      label: safeLabel(label),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      tokenHash: sha256(token)
    };
    const devices = await readDevices();
    devices.push(device);
    await writeDevices(devices);
    return { device, token };
  }

  async function bootstrapDevice(req, label) {
    const devices = await readDevices();
    if (devices.some(device => !device.revokedAt)) {
      throw Object.assign(new Error("A trusted device already exists; use pairing instead"), { status: 409 });
    }
    if (!isLocalBootstrapRequest(req)) {
      throw Object.assign(new Error("First trusted device must be created from http://127.0.0.1 or http://localhost"), { status: 403 });
    }
    return issueDevice(label);
  }

  async function listDevices(req) {
    const current = await authenticate(req);
    const devices = await readDevices();
    return {
      currentDeviceId: current.id,
      devices: devices
        .filter(device => !device.revokedAt)
        .map(({ tokenHash, ...device }) => ({ ...device, current: device.id === current.id }))
    };
  }

  async function createPairing(req) {
    const current = await authenticate(req);
    const code = String(randomInt(100000, 1000000));
    const id = randomUUID();
    pairings.set(id, {
      id,
      codeHash: sha256(code),
      approvedByDeviceId: current.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + PAIRING_TTL_MS
    });
    return { pairingId: id, code, expiresAt: Date.now() + PAIRING_TTL_MS };
  }

  async function claimPairing(code, label) {
    const codeHash = sha256(String(code || "").trim());
    const now = Date.now();
    for (const [id, pairing] of pairings) {
      if (pairing.expiresAt <= now) {
        pairings.delete(id);
        continue;
      }
      if (pairing.codeHash !== codeHash) continue;
      pairings.delete(id);
      const issued = await issueDevice(label);
      return {
        ...issued,
        approvedByDeviceId: pairing.approvedByDeviceId
      };
    }
    throw Object.assign(new Error("Pairing code is invalid or expired"), { status: 400 });
  }

  async function revokeDevice(req, deviceId) {
    const current = await authenticate(req);
    const devices = await readDevices();
    const index = devices.findIndex(device => device.id === deviceId && !device.revokedAt);
    if (index < 0) throw Object.assign(new Error("Device not found"), { status: 404 });
    devices[index].revokedAt = Date.now();
    await writeDevices(devices);

    const subscriptions = await readSubscriptions();
    await writeSubscriptions(subscriptions.filter(item => item.deviceId !== deviceId));
    return { ok: true, revokedCurrentDevice: current.id === deviceId };
  }

  async function readSubscriptions() {
    const data = await readJsonFile(subscriptionsFile, { version: 1, subscriptions: [] });
    return Array.isArray(data.subscriptions) ? data.subscriptions : [];
  }

  async function writeSubscriptions(subscriptions) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeJsonFile(subscriptionsFile, { version: 1, subscriptions });
  }

  async function getVapid() {
    const existing = await readJsonFile(vapidFile, null);
    if (existing?.privateJwk?.d && existing?.publicKey) return existing;

    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const privateJwk = privateKey.export({ format: "jwk" });
    const publicJwk = publicKey.export({ format: "jwk" });
    const value = {
      createdAt: Date.now(),
      privateJwk,
      publicKey: publicKeyFromJwk(publicJwk)
    };
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeJsonFile(vapidFile, value);
    return value;
  }

  async function pushPublicKey() {
    const vapid = await getVapid();
    return { publicKey: vapid.publicKey };
  }

  async function subscribePush(req, payload) {
    const current = await authenticate(req);
    const endpoint = String(payload?.endpoint || "").trim();
    if (!endpoint.startsWith("https://")) {
      throw Object.assign(new Error("A valid HTTPS push endpoint is required"), { status: 400 });
    }

    const subscriptions = await readSubscriptions();
    const existing = subscriptions.find(item => item.endpoint === endpoint);
    const now = Date.now();
    if (existing) {
      existing.deviceId = current.id;
      existing.updatedAt = now;
    } else {
      subscriptions.push({
        id: randomUUID(),
        endpoint,
        deviceId: current.id,
        createdAt: now,
        updatedAt: now,
        visibleSessionId: null,
        visibleAt: 0
      });
    }
    await writeSubscriptions(subscriptions);
    return { ok: true };
  }

  async function unsubscribePush(req, payload) {
    await authenticate(req);
    const endpoint = String(payload?.endpoint || "").trim();
    const subscriptions = await readSubscriptions();
    const next = subscriptions.filter(item => item.endpoint !== endpoint);
    await writeSubscriptions(next);
    pendingNotifications.delete(endpoint);
    return { ok: true };
  }

  async function updateVisibility(req, payload) {
    const current = await authenticate(req);
    const endpoint = String(payload?.endpoint || "").trim();
    if (!endpoint) return { ok: true };
    const subscriptions = await readSubscriptions();
    const item = subscriptions.find(sub => sub.endpoint === endpoint && sub.deviceId === current.id);
    if (!item) return { ok: true };
    item.visibleSessionId = payload?.visible ? String(payload?.sessionId || "") : null;
    item.visibleAt = payload?.visible ? Date.now() : 0;
    item.updatedAt = Date.now();
    await writeSubscriptions(subscriptions);
    return { ok: true };
  }

  async function notifyAgentState(payload) {
    const sessionId = String(payload?.sessionId || "").slice(0, 200);
    const backend = payload?.backend === "codex" ? "codex" : "opencode";
    const state = String(payload?.state || "");
    if (!["completed", "waiting_for_approval", "waiting_for_input"].includes(state)) {
      return { sent: 0, skipped: true };
    }

    const dedupeKey = `${backend}:${sessionId}:${state}`;
    const last = recentNotifications.get(dedupeKey) || 0;
    if (Date.now() - last < NOTIFY_DEDUPE_MS) return { sent: 0, deduped: true };
    recentNotifications.set(dedupeKey, Date.now());
    if (recentNotifications.size > 1000) {
      const cutoff = Date.now() - Math.max(NOTIFY_DEDUPE_MS * 4, 120000);
      for (const [key, at] of recentNotifications) {
        if (at < cutoff) recentNotifications.delete(key);
      }
    }

    const body =
      state === "completed" ? "Agent completed" :
      state === "waiting_for_approval" ? "Approval needed" :
      "Input needed";
    const params = new URLSearchParams({ backend });
    if (sessionId) params.set("session", sessionId);
    const notification = {
      title: "DevMoter",
      body,
      url: `/?${params.toString()}`,
      createdAt: Date.now()
    };

    const subscriptions = await readSubscriptions();
    const vapid = await getVapid();
    const keep = [];
    let sent = 0;

    for (const subscription of subscriptions) {
      const sameVisibleSession =
        sessionId &&
        subscription.visibleSessionId === sessionId &&
        Date.now() - Number(subscription.visibleAt || 0) < VISIBLE_TTL_MS;
      if (sameVisibleSession) {
        keep.push(subscription);
        continue;
      }

      pendingNotifications.set(subscription.endpoint, notification);
      try {
        const response = await sendEmptyPush(subscription, vapid);
        if (response.status === 404 || response.status === 410) {
          pendingNotifications.delete(subscription.endpoint);
          continue;
        }
        if (response.ok || response.status === 201 || response.status === 202) sent += 1;
        keep.push(subscription);
      } catch {
        keep.push(subscription);
      }
    }

    if (keep.length !== subscriptions.length) await writeSubscriptions(keep);
    return { sent };
  }

  async function notifyPush(req, payload) {
    await authenticate(req);
    return notifyAgentState(payload);
  }

  async function takePendingPush(payload) {
    const endpoint = String(payload?.endpoint || "").trim();
    const pending = pendingNotifications.get(endpoint);
    if (!pending) return { notification: null };
    pendingNotifications.delete(endpoint);
    return { notification: pending };
  }

  async function diagnostics() {
    const [node, git, npm, python, curl, opencode, codex, gh, tailscale, backends, projects, devices] = await Promise.all([
      commandStatus("node"),
      commandStatus("git"),
      commandStatus("npm"),
      commandStatus("python3"),
      commandStatus("curl"),
      commandStatus("opencode"),
      commandStatus("codex"),
      commandStatus("gh"),
      commandStatus("tailscale", ["version"]),
      getBackendHealth(),
      getProjects(),
      readDevices()
    ]);

    const required = { node, git, npm, python, curl, opencode, codex };
    const missing = Object.entries(required).filter(([, value]) => !value.available).map(([name]) => name);
    const activeDevices = devices.filter(device => !device.revokedAt).length;

    return {
      app: {
        name: "DevMoter FAST",
        version,
        node: process.version,
        host,
        build: process.env.DEVMOTER_BUILD || process.env.GITHUB_SHA || null
      },
      prerequisites: {
        required,
        optional: { gh, tailscale },
        ok: missing.length === 0,
        missing,
        message: missing.length ? `Install missing prerequisites: ${missing.join(", ")}` : "Required host prerequisites are available."
      },
      backends,
      projects: {
        count: Array.isArray(projects) ? projects.length : 0,
        message: Array.isArray(projects) ? "Project registry readable." : "Project registry unavailable."
      },
      deviceSecurity: {
        trustedDevices: activeDevices,
        message: activeDevices ? "Trusted device sessions are configured." : "No trusted device session exists yet."
      },
      network: {
        localhostFirst: host === "127.0.0.1" || host === "localhost" || host === "::1",
        message: host === "127.0.0.1" || host === "localhost" || host === "::1"
          ? "Server is using a localhost-first bind."
          : "Server bind is not localhost; verify your private-network and authentication policy."
      },
      notes: [
        "Diagnostics intentionally omit tokens, passwords, prompt contents, and repository file contents.",
        "No repository bootstrap scripts are run by this endpoint."
      ]
    };
  }

  return {
    authenticate,
    bootstrapDevice,
    listDevices,
    createPairing,
    claimPairing,
    revokeDevice,
    pushPublicKey,
    subscribePush,
    unsubscribePush,
    updateVisibility,
    notifyPush,
    notifyAgentState,
    takePendingPush,
    diagnostics
  };
}


export const systemFeatureInternals = { isLocalBootstrapRequest, requestHostname };
