export const HOST_PROTOCOL_VERSION = "1.0";

export const HOST_CAPABILITY_IDS = Object.freeze([
  "terminal",
  "files",
  "processes",
  "services",
  "ports",
  "git",
  "browser",
  "secrets",
  "agents",
  "notifications"
]);

const CAPABILITY_STATES = new Set(["available", "degraded", "unavailable"]);
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const FEATURE_CODE = /^[a-z][a-z0-9._-]{0,63}$/;

function normalizeCode(value, pattern, label) {
  const code = String(value || "");
  if (!pattern.test(code)) throw new Error(`Invalid host ${label}`);
  return code;
}

function normalizeCapabilities(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Host capabilities must be an object");
  }

  for (const key of Object.keys(input)) {
    if (!HOST_CAPABILITY_IDS.includes(key)) throw new Error(`Unknown host capability: ${key}`);
  }

  return Object.fromEntries(HOST_CAPABILITY_IDS.map(id => {
    const descriptor = input[id] || { state: "unavailable", reason: "not_implemented" };
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
      throw new Error(`Invalid host capability descriptor: ${id}`);
    }
    const state = String(descriptor.state || "unavailable");
    if (!CAPABILITY_STATES.has(state)) throw new Error(`Invalid host capability state: ${id}`);

    const reason = descriptor.reason == null
      ? null
      : normalizeCode(descriptor.reason, REASON_CODE, `capability reason: ${id}`);
    if (state === "available" && reason) {
      throw new Error(`Available host capability cannot have an unavailable reason: ${id}`);
    }
    if (state !== "available" && !reason) {
      throw new Error(`Unavailable host capability requires a reason: ${id}`);
    }

    const features = descriptor.features == null ? [] : descriptor.features;
    if (!Array.isArray(features) || features.length > 24) {
      throw new Error(`Invalid host capability features: ${id}`);
    }
    const normalizedFeatures = [...new Set(features.map(feature =>
      normalizeCode(feature, FEATURE_CODE, `feature: ${id}`)
    ))];
    return [id, Object.freeze({ state, reason, features: Object.freeze(normalizedFeatures) })];
  }));
}

export class DevMoterHost {
  constructor({ id = "local", platform, runtime = "native", architecture = process.arch, capabilities = {} } = {}) {
    this._info = Object.freeze({
      id: normalizeCode(id, /^[a-zA-Z0-9._:-]{1,120}$/, "id"),
      platform: normalizeCode(platform, /^(linux|macos|windows|unknown)$/, "platform"),
      runtime: normalizeCode(runtime, /^(native|wsl|wsl_disconnected|unknown)$/, "runtime"),
      architecture: normalizeCode(architecture, /^[a-zA-Z0-9._-]{1,40}$/, "architecture"),
      protocolVersion: HOST_PROTOCOL_VERSION
    });
    this._capabilities = normalizeCapabilities(capabilities);
  }

  async info() {
    return { ...this._info };
  }

  async capabilities() {
    return Object.fromEntries(Object.entries(this._capabilities).map(([id, value]) => [id, {
      state: value.state,
      reason: value.reason,
      features: [...value.features]
    }]));
  }

  async snapshot() {
    return {
      protocolVersion: HOST_PROTOCOL_VERSION,
      host: await this.info(),
      capabilities: await this.capabilities()
    };
  }
}
