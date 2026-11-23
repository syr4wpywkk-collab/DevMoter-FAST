import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { listenerConnectHost, parseListeningSockets, readListenerIdentity } from "../server/listener-identity.mjs";

const linux = process.platform === "linux";

test("#708 /proc/net listening sockets are parsed by address, port and inode", () => {
  const table = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4242 1 0000000000000000 100 0 0 10 0",
    "   1: 0100007F:0BB9 0100007F:9C40 01 00000000:00000000 00:00000000 00000000  1000        0 4343 1 0000000000000000 100 0 0 10 0"
  ].join("\n");
  assert.deepEqual(parseListeningSockets(table), [{ address: "0100007F", port: 3000, inode: "4242" }]);
  const readFile = path => (path.endsWith("/tcp") ? table : "header\n");
  assert.equal(readListenerIdentity("127.0.0.1", 3000, { readFile }), "socket:4242");
  assert.equal(readListenerIdentity("127.0.0.1", 3001, { readFile }), null, "an established socket is not a listener");
  assert.equal(readListenerIdentity("10.0.0.1", 3000, { readFile }), null, "non-loopback hosts are never resolved");
});

test("#708 localhost dials the address family whose listener was identified", () => {
  const header = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";
  const v4 = "   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4242 1 0 100 0 0 10 0";
  const v6 = "   0: 00000000000000000000000001000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5151 1 0 100 0 0 10 0";
  const tables = (tcp, tcp6) => ({ readFile: path => header + (path.endsWith("/tcp6") ? tcp6 : tcp) });
  const both = tables(v4, v6);
  assert.equal(readListenerIdentity("localhost", 3000, both), "socket:4242");
  assert.equal(listenerConnectHost("localhost", 3000, both), "127.0.0.1");
  const onlyV6 = tables("", v6);
  assert.equal(readListenerIdentity("localhost", 3000, onlyV6), "socket:5151");
  assert.equal(listenerConnectHost("localhost", 3000, onlyV6), "::1");
  assert.equal(listenerConnectHost("localhost", 3000, tables("", "")), null);
  assert.equal(listenerConnectHost("[::1]", 3000, tables("", "")), "::1");
  assert.equal(listenerConnectHost("127.0.0.1", 3000, tables("", "")), "127.0.0.1");
});

test("#708 a new process on the same port has a different listener identity", { skip: linux ? false : "needs /proc/net" }, async () => {
  const first = createServer().listen(0, "127.0.0.1");
  await once(first, "listening");
  const port = first.address().port;
  const before = readListenerIdentity("127.0.0.1", port);
  assert.match(before, /^socket:\d+$/);
  await new Promise(resolve => first.close(resolve));
  assert.equal(readListenerIdentity("127.0.0.1", port), null);
  const second = createServer().listen(port, "127.0.0.1");
  await once(second, "listening");
  const after = readListenerIdentity("127.0.0.1", port);
  second.close();
  assert.match(after, /^socket:\d+$/);
  assert.notEqual(after, before);
});
