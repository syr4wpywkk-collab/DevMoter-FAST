#!/usr/bin/env node
// Runs inside the remote browser's bubblewrap sandbox, which has its own
// empty network namespace (--unshare-net). It listens on the preview's
// loopback address there and forwards each connection over a Unix socket to
// the host, which only ever connects it to the approved preview listener.
// Nothing else is reachable from Chromium at the OS level: no DNS, no other
// hosts or ports, no WebRTC/UDP.
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseRelayArgs(argv) {
  const split = argv.indexOf("--");
  if (split < 0) throw new Error("Missing -- before the browser command");
  const options = {};
  const head = argv.slice(0, split);
  for (let index = 0; index < head.length; index += 2) options[head[index].replace(/^--/, "")] = head[index + 1];
  const port = Number(options.port);
  if (!options.host || !options.socket || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid relay arguments");
  const [command, ...args] = argv.slice(split + 1);
  if (!command) throw new Error("Missing browser command");
  return { host: options.host, port, socket: options.socket, command, args };
}

async function main() {
  const { host, port, socket, command, args } = parseRelayArgs(process.argv.slice(2));
  const server = createServer(client => {
    const upstream = connect({ path: socket });
    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: host.replace(/^\[|\]$/g, ""), port, exclusive: true }, resolve);
  });
  // fds 3 and 4 are the CDP pipe; Chromium inherits them unchanged.
  const child = spawn(command, args, { stdio: ["ignore", "ignore", "ignore", 3, 4] });
  const stop = signal => { try { child.kill(signal); } catch {} };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGTERM"));
  child.on("error", () => process.exit(1));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write("browser relay: " + String(error?.message || error) + "\n");
    process.exit(1);
  });
}
