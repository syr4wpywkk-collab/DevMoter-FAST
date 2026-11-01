import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import {
  DeviceAuthError,
  createDeviceGate,
  isDeviceAuthError,
  responseError
} from "../src/device-gate.mjs";

test("device-token refusals from the server are recognised, other failures are not", () => {
  for (const [status, message] of [
    [401, "Invalid or revoked device token"],
    [401, "Trusted device token required"],
    [403, "Trusted device required"]
  ]) {
    const error = responseError(status, message);
    assert.ok(error instanceof DeviceAuthError, message);
    assert.equal(error.status, status);
    assert.ok(isDeviceAuthError(error));
  }
  // Message-only errors (e.g. terminal fetch helpers) still match.
  assert.ok(isDeviceAuthError(new Error("Invalid or revoked device token")));
  assert.equal(isDeviceAuthError(responseError(500, "Could not load task plan")), false);
  assert.equal(isDeviceAuthError(responseError(401, "Owner session required")), false);
  assert.equal(isDeviceAuthError(new Error("device token"), 500), false);
  assert.equal(responseError(502).message, "HTTP 502");
});

test("gate shows one short line and a button into Settings → Trusted devices", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const { window } = dom;
  const events = [];
  let closed = 0;
  window.addEventListener("devmoter:open-settings", event => events.push(event.detail));
  const gate = createDeviceGate(window.document, { onRegister: () => { closed += 1; }, className: "dm-tools-card" });
  window.document.body.append(gate);
  assert.ok(gate.classList.contains("dm-device-gate") && gate.classList.contains("dm-tools-card"));
  assert.equal(gate.getAttribute("role"), "status");
  assert.equal(gate.querySelector("strong").textContent, "この端末は未登録です");
  assert.doesNotMatch(gate.textContent, /token|401|revoked|!/i);
  const button = gate.querySelector("[data-device-gate-register]");
  assert.equal(button.type, "button");
  assert.equal(button.textContent, "端末を登録");
  button.click();
  assert.equal(closed, 1);
  assert.deepEqual(events, [{ page: "devices" }]);
  dom.window.close();
});

test("checkpoints and extensions panels route device-auth failures to the gate", async () => {
  const ui = await readFile(new URL("../src/workspace-control.ts", import.meta.url), "utf8");
  assert.ok(ui.includes('from "./device-gate.mjs"'));
  assert.ok(ui.includes('throw responseError(res.status, payload?.error || "Could not load task plan")'));
  assert.ok(ui.includes('throw responseError(res.status, data?.error || "Could not load extensions")'));
  assert.ok(ui.includes('showFailure("Task checkpoints", error)'));
  assert.ok(ui.includes('showFailure("Extensions", error)'));
  assert.ok(ui.includes("createDeviceGate(document, { onRegister: closePanel })"));
  // Errors no longer get appended under the stale "Loading…" line.
  assert.ok(!ui.includes("panel.append(error instanceof Error ? error.message : String(error))"));
});
