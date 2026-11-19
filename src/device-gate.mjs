// One shared "this browser is not a Trusted device" state for every
// device-bound surface (Task checkpoints, Extensions, Terminal sessions).
// The server answers these with 401/403 and messages such as
// "Trusted device token required", "Invalid or revoked device token" or
// "Trusted device required"; none of them is something the user can act on
// as text, so callers swap the raw error for this short gate.

import { DICTIONARIES, t } from "./i18n-core.mjs";

const DEVICE_AUTH_MESSAGE = /trusted device|device token/i;
const REVOKED_MESSAGE = /revoked/i;
const REQUIRED_KEY = "errors.server.trustedDeviceRequired";
const REVOKED_KEY = "errors.server.trustedDeviceRevoked";

// Callers translate the server message before it reaches the gate, so the
// localized texts must be recognised as well as the raw English ones.
function localizedMessages(key) {
  return Object.values(DICTIONARIES).map(dictionary => dictionary[key]).filter(Boolean);
}

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
  if (DEVICE_AUTH_MESSAGE.test(message)) return true;
  const text = message.trim();
  return localizedMessages(REQUIRED_KEY).includes(text) || localizedMessages(REVOKED_KEY).includes(text);
}

/**
 * Why the server refused: "revoked" when this browser's registration was
 * invalidated, otherwise "unregistered". Derived from the message only.
 */
export function deviceAuthReason(error) {
  const message = (error instanceof Error ? error.message : String(error ?? "")).trim();
  if (localizedMessages(REVOKED_KEY).includes(message)) return "revoked";
  return DEVICE_AUTH_MESSAGE.test(message) && REVOKED_MESSAGE.test(message) ? "revoked" : "unregistered";
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
export function createDeviceGate(
  doc,
  {
    onRegister,
    className = "",
    compact = false,
    title: titleText,
    copy: copyText,
    buttonLabel,
    error
  } = {}
) {
  const revoked = error !== undefined && deviceAuthReason(error) === "revoked";
  const win = doc.defaultView;
  const gate = doc.createElement("div");
  gate.className = ["dm-device-gate", compact ? "dm-device-gate-compact" : "", className].filter(Boolean).join(" ");
  gate.dataset.deviceGate = "true";
  gate.setAttribute("role", "status");

  // Compact: the whole sheet section is replaced by one button into
  // Settings → 信頼済み端末 (DevMoter Tools: Terminal / Safety / Index).
  if (compact) {
    const open = doc.createElement("button");
    open.type = "button";
    open.dataset.deviceGateRegister = "true";
    open.textContent = buttonLabel || t("deviceGate.openTrustedDevices");
    open.addEventListener("click", () => {
      onRegister?.();
      if (win) openDeviceRegistration(win);
    });
    if (error !== undefined) {
      const cause = doc.createElement("small");
      cause.dataset.deviceGateCause = revoked ? "revoked" : "unregistered";
      cause.textContent = revoked ? t("deviceGate.revokedTitle") : t("deviceGate.unregisteredTitle");
      gate.append(cause);
    }
    gate.append(open);
    return gate;
  }

  const title = doc.createElement("strong");
  title.textContent = titleText || (revoked ? t("deviceGate.revokedTitle") : t("deviceGate.unregisteredTitle"));
  if (error !== undefined) gate.dataset.deviceGateCause = revoked ? "revoked" : "unregistered";
  const copy = doc.createElement("small");
  copy.textContent = copyText || (revoked ? t("deviceGate.revokedCopy") : t("deviceGate.unregisteredCopy"));
  const register = doc.createElement("button");
  register.type = "button";
  register.dataset.deviceGateRegister = "true";
  register.textContent = buttonLabel || t("deviceGate.registerButton");
  register.addEventListener("click", () => {
    onRegister?.();
    if (win) openDeviceRegistration(win);
  });

  gate.append(title, copy, register);
  return gate;
}
