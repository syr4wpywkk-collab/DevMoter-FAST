import { readFileSync } from "node:fs";

// The socket inode of the process listening on a loopback preview port.
// A preview stopped and replaced by another process on the same port gets a
// new listening socket, so a browser session bound to the old inode can tell.
function hexIpv4(address) {
  return address.split(".").reverse().map(part => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Each candidate carries the concrete address a client must dial to reach
// the listener it matches, so "localhost" never resolves to another family.
function candidates(host) {
  const value = String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (value === "localhost") return [...candidates("127.0.0.1"), ...candidates("::1")];
  if (value === "::1") {
    return [
      { file: "tcp6", address: "00000000000000000000000001000000", connect: "::1" },
      { file: "tcp6", address: "0".repeat(32), connect: "::1" }
    ];
  }
  if (/^127\.\d+\.\d+\.\d+$/.test(value)) {
    return [
      { file: "tcp", address: hexIpv4(value), connect: value },
      { file: "tcp", address: "00000000", connect: value },
      { file: "tcp6", address: "0000000000000000FFFF0000" + hexIpv4(value), connect: value },
      { file: "tcp6", address: "0".repeat(32), connect: value }
    ];
  }
  return [];
}

export function parseListeningSockets(text) {
  const result = [];
  for (const line of String(text || "").split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[3] !== "0A") continue;
    const [address, port] = fields[1].split(":");
    result.push({ address: address.toUpperCase(), port: parseInt(port, 16), inode: fields[9] });
  }
  return result;
}

function findListener(host, port, { readFile = path => readFileSync(path, "utf8"), procRoot = "/proc" } = {}) {
  const wanted = Number(port);
  const tables = {};
  for (const candidate of candidates(host)) {
    if (!(candidate.file in tables)) {
      try { tables[candidate.file] = parseListeningSockets(readFile(procRoot + "/net/" + candidate.file)); } catch { tables[candidate.file] = []; }
    }
    const match = tables[candidate.file].find(entry => entry.port === wanted && entry.address === candidate.address && entry.inode !== "0");
    if (match) return { identity: "socket:" + match.inode, connect: candidate.connect };
  }
  return null;
}

export function readListenerIdentity(host, port, options) {
  return findListener(host, port, options)?.identity ?? null;
}

// The address that reaches the listener readListenerIdentity reports.
export function listenerConnectHost(host, port, options) {
  const value = String(host || "").replace(/^\[|\]$/g, "");
  if (value.toLowerCase() !== "localhost") return value;
  return findListener(host, port, options)?.connect ?? null;
}
