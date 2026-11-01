// One shared "this browser is not a Trusted device" state for every
// device-bound surface (Task checkpoints, Extensions, Terminal sessions).
// The server answers these with 401/403 and messages such as
// "Trusted device token required", "Invalid or revoked device token" or
// "Trusted device required"; none of them is something the user can act on
// as text, so callers swap the raw error for this short gate.

const DEVICE_AUTH_MESSAGE = /trusted device|device token/i;

/** Error thrown by device-bound fetches so callers can tell auth from other failures. */
export class DeviceAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "DeviceAuthError";
    this.status = status;
  }
}

/** True when an error (or status + message) means this browser has no active device token. */
export function isDeviceAuthError(error, status) {
  if (error instanceof DeviceAuthError) return true;
  const code = Number(status ?? error?.status ?? 0);
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (code && code !== 401 && code !== 403) return false;
  return DEVICE_AUTH_MESSAGE.test(message);
}

/** Error to throw for a non-ok response; DeviceAuthError when it is a device-token refusal. */
export function responseError(status, message) {
  const text = String(message || `HTTP ${status}`);
  return isDeviceAuthError(new Error(text), status) ? new DeviceAuthError(text, status) : new Error(text);
}

/** Opens Settings → Trusted devices, where this browser is registered or paired. */
export function openDeviceRegistration(win = window) {
  win.dispatchEvent(new win.CustomEvent("devmoter:open-settings", { detail: { page: "devices" } }));
}

/**
 * Builds the gate: one line saying why, one button to the existing
 * registration / pairing page. `onRegister` runs before navigation so the
 * host surface can close itself first.
 */
export function createDeviceGate(doc, { onRegister, className = "" } = {}) {
  const win = doc.defaultView;
  const gate = doc.createElement("div");
  gate.className = ["dm-device-gate", className].filter(Boolean).join(" ");
  gate.dataset.deviceGate = "true";
  gate.setAttribute("role", "status");

  const title = doc.createElement("strong");
  title.textContent = "この端末は未登録です";
  const copy = doc.createElement("small");
  copy.textContent = "端末を登録すると使えます";
  const register = doc.createElement("button");
  register.type = "button";
  register.dataset.deviceGateRegister = "true";
  register.textContent = "端末を登録";
  register.addEventListener("click", () => {
    onRegister?.();
    if (win) openDeviceRegistration(win);
  });

  gate.append(title, copy, register);
  return gate;
}
