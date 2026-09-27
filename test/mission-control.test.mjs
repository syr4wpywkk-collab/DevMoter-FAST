import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../src/" + path, import.meta.url), "utf8");
}

test("Mission Control aggregates only existing read-only APIs", async () => {
  const mission = await source("mission-control.ts");
  for (const endpoint of [
    "/api/agent-runs",
    "/api/automation/sessions",
    "/api/host",
    "/api/projects"
  ]) assert.ok(mission.includes(endpoint), endpoint);
  assert.ok(mission.includes('method: "GET"'));
  assert.ok(!mission.includes('method: "POST"'));
  assert.ok(!mission.includes("x-pocket-operation-id"));
});

test("Mission Control tolerates partial source failure and never trusts API strings as markup", async () => {
  const mission = await source("mission-control.ts");
  assert.ok(mission.includes("Promise.all(["));
  assert.ok(mission.includes("loadSource("));
  assert.ok(mission.includes("Source unavailable"));
  assert.ok(mission.includes("replaceChildren()"));
  assert.ok(mission.includes("textContent"));
  assert.ok(mission.includes("document.createElement"));
});

test("Mission Control refreshes only while open and visible", async () => {
  const mission = await source("mission-control.ts");
  assert.ok(mission.includes('document.visibilityState !== "visible"'));
  assert.ok(mission.includes("window.setInterval(() => void refresh(), 10_000)"));
  assert.ok(mission.includes('document.addEventListener("visibilitychange"'));
  assert.ok(mission.includes('window.addEventListener("online"'));
  assert.ok(mission.includes("refreshInFlight"));
});

test("Mission Control is opened through the fixed App launcher", async () => {
  const [mission, shell, main, registry] = await Promise.all([
    source("mission-control.ts"),
    source("app-shell.ts"),
    source("main.ts"),
    source("app-registry.ts")
  ]);
  assert.ok(registry.includes('id: "mission-control"'));
  assert.ok(shell.includes('case "mission-control": window.dispatchEvent(new CustomEvent("devmoter:open-mission-control"))'));
  assert.ok(main.includes("mountMissionControl()"));
  assert.ok(mission.includes('window.addEventListener("devmoter:open-mission-control", open)'));
});
