import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createCdpPipeConnection } from "../server/browser-cdp.mjs";

function pipePair(options = {}) {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const sent = [];
  let buffer = "";
  toBrowser.on("data", chunk => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\0")) !== -1) {
      sent.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  const cdp = createCdpPipeConnection({ writable: toBrowser, readable: fromBrowser, ...options });
  const reply = message => fromBrowser.write(JSON.stringify(message) + "\0");
  return { cdp, sent, reply, fromBrowser };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test("CDP pipe client correlates responses, sessions and split frames", async () => {
  const { cdp, sent, fromBrowser } = pipePair();
  const first = cdp.send("Page.navigate", { url: "http://127.0.0.1:3000/" }, { sessionId: "S1" });
  const second = cdp.send("Browser.getVersion");
  await tick();
  assert.deepEqual(sent.map(m => [m.id, m.method, m.sessionId]), [[1, "Page.navigate", "S1"], [2, "Browser.getVersion", undefined]]);
  const frame = JSON.stringify({ id: 2, result: { product: "Chrome" } }) + "\0" + JSON.stringify({ id: 1, result: { frameId: "F" } }) + "\0";
  fromBrowser.write(frame.slice(0, 10));
  fromBrowser.write(frame.slice(10));
  assert.deepEqual(await second, { product: "Chrome" });
  assert.deepEqual(await first, { frameId: "F" });
  assert.equal(cdp.pendingCount, 0);
});

test("CDP pipe client delivers events and maps protocol errors", async () => {
  const { cdp, reply } = pipePair();
  const events = [];
  cdp.on("Page.frameNavigated", (params, sessionId) => events.push([params.frame.url, sessionId]));
  reply({ method: "Page.frameNavigated", params: { frame: { url: "http://127.0.0.1:3000/a" } }, sessionId: "S1" });
  const failing = cdp.send("DOM.querySelector", {});
  reply({ id: 1, error: { code: -32000, message: "No node" } });
  await assert.rejects(failing, error => error.code === "cdp_command_failed" && /No node/.test(error.message));
  assert.deepEqual(events, [["http://127.0.0.1:3000/a", "S1"]]);
});

test("CDP pipe client times out, rejects invalid methods and oversized commands", async () => {
  const { cdp } = pipePair({ timeoutMs: 20, maxOutgoingBytes: 128 });
  await assert.rejects(cdp.send("Page.reload"), error => error.code === "cdp_timeout");
  await assert.rejects(cdp.send("Runtime.evaluate; drop", {}), error => error.code === "cdp_invalid_method");
  await assert.rejects(cdp.send("Input.insertText", { text: "x".repeat(500) }), error => error.code === "cdp_message_too_large");
  assert.equal(cdp.pendingCount, 0);
});

test("CDP pipe client closes on disconnect, malformed and oversized messages", async () => {
  const ended = pipePair();
  const closeReasons = [];
  ended.cdp.onClose(reason => closeReasons.push(reason));
  const pending = ended.cdp.send("Page.enable");
  ended.fromBrowser.end();
  await assert.rejects(pending, error => error.code === "cdp_closed");
  assert.deepEqual(closeReasons, ["pipe_ended"]);
  await assert.rejects(ended.cdp.send("Page.enable"), error => error.code === "cdp_closed");

  const malformed = pipePair();
  malformed.fromBrowser.write("{not json\0");
  await tick();
  assert.equal(malformed.cdp.closed, true);

  const large = pipePair({ maxMessageBytes: 64 });
  const waiting = large.cdp.send("Page.captureScreenshot");
  large.fromBrowser.write("x".repeat(100));
  await assert.rejects(waiting, error => /message_too_large/.test(error.message));
});
