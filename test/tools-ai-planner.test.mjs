import test from "node:test";
import assert from "node:assert/strict";
import { parseProposal, planOperation, explainResult } from "../server/tools-ai/planner.mjs";
import { runMultiApiChat } from "../server/multi-api.mjs";
const context = { project: { id: "p1" }, permissions: ["project-read", "host-observation"], planner: { providerId: "p", model: "m" } };
test("planner accepts only strict JSON, known available operation and validated inputs", () => {
  assert.equal(parseProposal('{"operationId":"git.inspect","input":{}}', context).operationId, "git.inspect");
  for (const raw of ['```json\n{}\n```', '{broken', '{"operationId":"shell","input":{}}', '{"operationId":"doc.read","input":{"path":"../a.md"}}']) assert.throws(() => parseProposal(raw, context));
  assert.throws(() => parseProposal('{"operationId":"git.inspect","input":{}}', { ...context, project: null }), /unavailable/);
});
test("provider missing and planner Stop never dispatch a late proposal", async () => {
  await assert.rejects(planOperation({ chat: () => { throw new Error("not called"); }, goal: "x", context: { ...context, planner: null } }), /Configure/);
  const controller = new AbortController();
  await assert.rejects(planOperation({ chat: async () => { controller.abort(); return '{"operationId":"git.inspect","input":{}}'; }, goal: "x", context, signal: controller.signal }), /abort/i);
});
test("explanation cannot cite invented facts or supply generated HTML/text", async () => {
  const result = { facts: [{ id: "f0", text: "changed files: 1" }] };
  const value = await explainResult({ chat: async () => '{"factIds":["f0"]}', result, goal: "changes" });
  assert.match(value.rawText, /changed files: 1/);
  for (const raw of ['{"factIds":["unknown"]}', '{"factIds":["f0"],"html":"bad"}']) await assert.rejects(explainResult({ chat: async () => raw, result, goal: "x" }));
});
test("external AbortSignal reaches both existing provider protocols without changing normal requests", async () => {
  for (const protocol of ["openai-compatible", "anthropic"]) {
    const provider = { id: "p", apiKey: "fixture-only", name: "Fixture", protocol, baseUrl: "https://fixture.invalid", models: ["m"], presetId: "custom" };
    const controller = new AbortController(); let entered;
    const started = new Promise(r => { entered = r; });
    const fetchImpl = async (_url, options) => { entered(); await new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })); };
    const pending = runMultiApiChat([provider], { providerId: "p", model: "m", messages: [{ role: "user", content: "test" }] }, fetchImpl, { signal: controller.signal });
    await started; controller.abort(); await assert.rejects(pending, /abort/i);
  }
});
