import { hostname as osHostname } from "node:os";
import { isIP } from "node:net";
import { isLoopbackBindHost } from "./auth.mjs";

const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Parse a Host header into a lower-case hostname, or null when malformed. */
export function parseHostHeader(value) {
  if (typeof value !== "string" || !value || value.length > 300) return null;
  const match = value.match(/^(\[[0-9a-fA-F:.]+\]|[^:\[\]]+)(?::(\d{1,5}))?$/);
  if (!match) return null;
  if (match[2] !== undefined && Number(match[2]) > 65535) return null;
  const raw = match[1].toLowerCase();
  if (raw.startsWith("[")) {
    return isIP(raw.slice(1, -1)) === 6 ? raw.slice(1, -1) : null;
  }
  const host = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  if (isIP(host) === 4 || HOSTNAME_PATTERN.test(host)) return host;
  return null;
}

/** Parse DEVMOTER_ALLOWED_HOSTS: comma-separated names; ".example.com" allows every subdomain. */
export function parseAllowedHosts(value) {
  return String(value || "")
    .split(",")
    .map(entry => entry.trim().toLowerCase().replace(/\.$/, ""))
    .filter(entry => HOSTNAME_PATTERN.test(entry.startsWith(".") ? entry.slice(1) : entry));
}

/**
 * Without a configured public origin the request Host decides the origin that
 * sessions and same-origin checks bind to, so a name that merely resolves to
 * this machine (DNS rebinding) must not be accepted. IP literals cannot be
 * rebound; names must be loopback, this machine's own name, a Tailscale name
 * (the documented remote path) or explicitly allowed by the operator.
 */
export function createHostValidator({ publicOrigin = "", allowedHosts = [], machineHostname = osHostname() } = {}) {
  const exact = new Set();
  const suffixes = [".ts.net"];
  for (const entry of allowedHosts) {
    if (entry.startsWith(".")) suffixes.push(entry);
    else exact.add(entry);
  }
  const machine = String(machineHostname || "").toLowerCase();
  if (HOSTNAME_PATTERN.test(machine)) {
    exact.add(machine);
    if (!machine.includes(".")) exact.add(`${machine}.local`);
  }
  const enforceNames = !publicOrigin;

  return function validateHost(req) {
    const host = parseHostHeader(req?.headers?.host);
    if (host === null) return { ok: false, status: 400, error: "Invalid Host header" };
    if (!enforceNames || isIP(host) || isLoopbackBindHost(host) || exact.has(host)) return { ok: true };
    if (suffixes.some(suffix => host.endsWith(suffix))) return { ok: true };
    return { ok: false, status: 421, error: "Host not allowed" };
  };
}
