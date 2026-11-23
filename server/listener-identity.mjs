import { readFileSync } from "node:fs";

// The socket inode of the process listening on a loopback preview port.
// A preview stopped and replaced by another process on the same port gets a
// new listening socket, so a browser session bound to the old inode can tell.
function hexIpv4(address) {
  return address.split(".").reverse().map(part => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function candidates(host) {
  const value = String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (value === "localhost") return [...candidates("127.0.0.1"), ...candidates("::1")];
  if (value === "::1") return [{ file: "tcp6", address: "00000000000000000000000001000000" }, { file: "tcp6", address: "0".repeat(32) }];
  if (/^127\.\d+\.\d+\.\d+$/.test(value)) {
    return [
      { file: "tcp", address: hexIpv4(value) },
      { file: "tcp", address: "00000000" },
      { file: "tcp6", address: "0000000000000000FFFF0000" + hexIpv4(value) },
      { file: "tcp6", address: "0".repeat(32) }
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

export function readListenerIdentity(host, port, { readFile = path => readFileSync(path, "utf8"), procRoot = "/proc" } = {}) {
  const wanted = Number(port);
  const tables = {};
  for (const candidate of candidates(host)) {
    if (!(candidate.file in tables)) {
      try { tables[candidate.file] = parseListeningSockets(readFile(procRoot + "/net/" + candidate.file)); } catch { tables[candidate.file] = []; }
    }
    const match = tables[candidate.file].find(entry => entry.port === wanted && entry.address === candidate.address && entry.inode !== "0");
    if (match) return "socket:" + match.inode;
  }
  return null;
}
