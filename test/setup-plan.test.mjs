import test from "node:test";
import assert from "node:assert/strict";
import { setupAdapters } from "../server/setup/engine.mjs";
import { buildInstallPlan, executeInstallPlan, installSourceDecision, previewInstallPlan, SetupPlanError } from "../server/setup/plan.mjs";

function statusFor(overrides = {}) {
  return {
    platform: { os: "linux", supported: true },
    tools: setupAdapters.map(adapter => {
      const state = overrides[adapter.id] || "missing";
      return {
        id: adapter.id,
        state,
        installed: ["installed", "ready", "auth_required", "broken"].includes(state),
        version: state === "missing" ? null : "1.2.3"
      };
    })
  };
}

function plan(status, selections) {
  return buildInstallPlan({ selections }, status);
}

function expectPlanError(callback, code, status) {
  assert.throws(callback, error => error instanceof SetupPlanError && error.code === code && (status === undefined || error.status === status));
}

test("missing supported tool creates only a preview candidate from adapter metadata", () => {
  const result = plan(statusFor(), [{ toolId: "codex", action: "install" }]);
  assert.equal(result.phase, "experimental-phase-2");
  assert.equal(result.mode, "preview-only");
  assert.equal(result.executable, false);
  assert.equal(result.items[0].currentState, "missing");
  assert.equal(result.items[0].action, "install");
  assert.equal(result.items[0].status, "reviewable");
  assert.equal(result.items[0].installSourceClass, "A");
  assert.equal(result.items[0].source.publisher, "OpenAI");
  assert.equal(JSON.stringify(result).includes("argv"), false);
  assert.equal(JSON.stringify(result).includes("packageName"), false);
  assert.equal(JSON.stringify(result).includes("installerUrl"), false);
});

test("already installed and ready tools are always kept, even when install was selected", () => {
  const result = plan(statusFor({ github: "installed", codex: "ready" }), [
    { toolId: "codex", action: "install" },
    { toolId: "github", action: "install" }
  ]);
  assert.deepEqual(result.items.map(item => item.action), ["keep", "keep"]);
  assert.ok(result.items.every(item => item.changes.length === 0));
  assert.ok(result.items.every(item => item.notes.some(note => note.includes("preserved"))));
});

test("auth-required existing tool is preserved and is not reinstalled", () => {
  const result = plan(statusFor({ codex: "auth_required" }), [{ toolId: "codex", action: "install" }]);
  assert.equal(result.items[0].action, "keep");
  assert.equal(result.items[0].currentState, "auth_required");
});

test("broken tools become manual review and never get an automatic repair plan", () => {
  const result = plan(statusFor({ claude: "broken" }), [{ toolId: "claude", action: "install" }]);
  assert.equal(result.items[0].action, "manual_review");
  assert.equal(result.items[0].status, "manual-review");
  assert.deepEqual(result.items[0].changes, []);
  assert.ok(result.items[0].notes.some(note => note.includes("automatic repair is not planned")));
});

test("unsupported platform cannot accept an install selection", () => {
  expectPlanError(() => plan(statusFor({ codex: "unsupported" }), [{ toolId: "codex", action: "install" }]), "unsupported_tool", 422);
  const kept = plan(statusFor({ codex: "unsupported" }), [{ toolId: "codex", action: "keep" }]);
  assert.equal(kept.items[0].action, "unavailable");
  assert.equal(kept.items[0].status, "unsupported");
});

test("unsupported platform metadata takes precedence over a stale missing-tool result", () => {
  const status = statusFor();
  status.platform.supported = false;
  const result = plan(status, [{ toolId: "codex", action: "keep" }]);
  assert.equal(result.items[0].currentState, "unsupported");
  assert.equal(result.items[0].action, "unavailable");
});

test("unknown tool IDs and action values are rejected", () => {
  expectPlanError(() => plan(statusFor(), [{ toolId: "../../codex", action: "install" }]), "unknown_tool");
  expectPlanError(() => plan(statusFor(), [{ toolId: "codex", action: "run" }]), "unknown_action");
});

test("command-shaped and metadata-shaped extra JSON is rejected without prototype pollution", () => {
  const commandSelection = { toolId: "codex", action: "install", argv: ["--danger"], executable: "/tmp/evil", cwd: "/tmp", env: { TOKEN: "secret" }, packageName: "evil", installerUrl: "https://evil.invalid" };
  expectPlanError(() => buildInstallPlan({ selections: [commandSelection] }, statusFor()), "invalid_selection");
  expectPlanError(() => buildInstallPlan({ selections: [{ toolId: "codex", action: "install" }], shellCommand: "sudo apt install" }, statusFor()), "invalid_request");
  const polluted = JSON.parse('{"selections":[{"toolId":"codex","action":"install"}],"__proto__":{"polluted":true}}');
  expectPlanError(() => buildInstallPlan(polluted, statusFor()), "invalid_request");
  assert.equal({}.polluted, undefined);
});

test("same detection state and selections produce the same canonical plan independent of request order", () => {
  const state = statusFor({ github: "installed", tailscale: "ready" });
  const first = plan(state, [
    { toolId: "tailscale", action: "install" },
    { toolId: "codex", action: "install" },
    { toolId: "github", action: "keep" }
  ]);
  const second = plan(state, [
    { toolId: "github", action: "keep" },
    { toolId: "codex", action: "install" },
    { toolId: "tailscale", action: "install" }
  ]);
  assert.deepEqual(second, first);
});

test("source class C remains preview-only and requires later explicit confirmation", () => {
  const result = plan(statusFor(), [{ toolId: "claude", action: "install" }]);
  assert.equal(result.executable, false);
  assert.equal(result.items[0].installSourceClass, "C");
  assert.equal(result.items[0].status, "confirmation-required");
  assert.ok(result.items[0].notes.some(note => note.includes("explicit confirmation")));
});

test("manual-review metadata stays visible in the non-executable plan", () => {
  const result = plan(statusFor(), [{ toolId: "github", action: "manual_review" }]);
  assert.equal(result.items[0].action, "manual_review");
  assert.equal(result.items[0].status, "manual-review");
  assert.equal(result.items[0].installSourceClass, "A");
  assert.ok(result.items[0].changes.length > 0);
  assert.ok(result.items[0].verification.length > 0);
});

test("install source classes A/B may be preview candidates, C requires confirmation, and D is blocked", () => {
  assert.equal(installSourceDecision({ installSupport: "supported", installSourceClass: "A", installStatus: "candidate" }), "reviewable");
  assert.equal(installSourceDecision({ installSupport: "supported", installSourceClass: "B", installStatus: "candidate" }), "reviewable");
  assert.equal(installSourceDecision({ installSupport: "supported", installSourceClass: "C", installStatus: "candidate" }), "confirmation-required");
  assert.equal(installSourceDecision({ installSupport: "supported", installSourceClass: "D", installStatus: "candidate" }), "blocked");
  assert.equal(installSourceDecision({ installSupport: "blocked", installSourceClass: "A", installStatus: "candidate" }), "blocked");
});

test("all six adapters define server-owned install metadata and browser fields cannot replace it", () => {
  assert.equal(setupAdapters.length, 6);
  for (const adapter of setupAdapters) {
    assert.ok(["supported", "blocked"].includes(adapter.installSupport));
    assert.ok(["A", "B", "C", "D"].includes(adapter.installSourceClass));
    assert.ok(["user", "administrator", "unknown"].includes(adapter.requiresPrivilege));
    assert.ok(["candidate", "confirmation-required", "manual-review", "blocked"].includes(adapter.installStatus));
    assert.ok(Array.isArray(adapter.notes));
  }
  expectPlanError(() => plan(statusFor(), [{
    toolId: "codex", action: "install", source: { type: "community", publisher: "attacker" }
  }]), "invalid_selection");
  const preview = plan(statusFor(), [{ toolId: "codex", action: "install" }]);
  assert.deepEqual(preview.items[0].source, setupAdapters.find(adapter => adapter.id === "codex").installSource);
});

test("partial or duplicate selections fail closed", () => {
  expectPlanError(() => buildInstallPlan({}, statusFor()), "invalid_request");
  expectPlanError(() => buildInstallPlan({ selections: [] }, statusFor()), "invalid_selections");
  expectPlanError(() => buildInstallPlan({ selections: [
    { toolId: "codex", action: "keep" }, { toolId: "codex", action: "install" }
  ] }, statusFor()), "duplicate_tool");
});

test("execution accepts only a server snapshot and rejects forged or injected requests", async () => {
  await assert.rejects(executeInstallPlan({ planId: "0".repeat(36), confirmedActions: [], command: "id" }), error => error.code === "invalid_execute_request");
  await assert.rejects(executeInstallPlan({ planId: "0".repeat(36), confirmedActions: [] }), error => error.code === "stale_plan");
});

test("executor requires exact explicit confirmations and never invents an installer", async () => {
  const preview = await previewInstallPlan({ selections: [{ toolId: "codex", action: "install" }] }, { env: { PATH: "", HOME: "/tmp" } });
  await assert.rejects(executeInstallPlan({ planId: preview.planId, confirmedActions: [] }), error => error.code === "confirmation_required");
  await assert.rejects(executeInstallPlan({ planId: preview.planId, confirmedActions: [{ toolId: "codex", actionId: "install", confirmed: true, cwd: "/tmp/unsafe" }] }), error => error.code === "invalid_confirmation");
  const result = await executeInstallPlan({ planId: preview.planId, confirmedActions: [{ toolId: "codex", actionId: "install", confirmed: true }] });
  assert.equal(result.status, "needs_user_action");
  assert.equal(result.items[0].status, "needs_user_action");
  assert.equal(JSON.stringify(result).includes("/home/"), false);
  assert.deepEqual(await executeInstallPlan({ planId: preview.planId, confirmedActions: [{ toolId: "codex", actionId: "install", confirmed: true }] }), result);
});

test("manual review and unsupported selections can never reach an executor", async () => {
  const preview = await previewInstallPlan({ selections: [{ toolId: "github", action: "manual_review" }] }, { env: { PATH: "", HOME: "/tmp" } });
  assert.equal(preview.items[0].status, "manual-review");
  const result = await executeInstallPlan({ planId: preview.planId, confirmedActions: [] });
  assert.equal(result.items[0].status, "needs_user_action");
});
