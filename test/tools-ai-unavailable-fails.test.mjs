import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDispatcher } from "../server/tools-ai/dispatcher.mjs";
import { createRunStore } from "../server/tools-ai/run-store.mjs";
import { createToolsAiService } from "../server/tools-ai/service.mjs";
import { createProjectIndex } from "../server/project-index.mjs";

const permissions = ["project-read", "host-observation"];
const identity = { ownerId: "owner", deviceId: null };
const waitFor = async predicate => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error("State did not settle");
};

async function runRepoMap({ buildIndex }) {
  const root = await mkdtemp(join(tmpdir(), "tools-ai-repo-map-"));
  const project = { id: "p1", path: join(root, "project") };
  await mkdir(project.path);
  await writeFile(join(project.path, "main.ts"), "export function main() { return 1; }\n");
  const index = createProjectIndex({ stateDir: join(root, "index"), resolveProject: async () => project });
  if (buildIndex) await index.rebuild(project.id);
  const dispatch = createDispatcher({
    resolveProject: async () => project,
    gitStatus: async () => ({}), changedFiles: async () => ({ files: [] }), fileDiff: async () => ({}),
    index, readMarkdown: async () => ({}), diagnostics: async () => ({})
  });
  const store = createRunStore({ filePath: join(root, "runs.json") });
  const context = { project, deviceId: null, permissions, planner: { providerId: "p", model: "m" } };
  let explainCalls = 0;
  const service = createToolsAiService({
    store,
    authorize: async () => {},
    dispatch,
    prepareChat: async () => ({
      context,
      secrets: [],
      chat: async messages => {
        if (messages[0].content.includes("ONE")) return '{"operationId":"project.map","input":{}}';
        explainCalls += 1;
        return '{"factIds":["f0"]}';
      }
    })
  });
  const run = await service.start({ goal: "repo map please", requestId: `request-${buildIndex ? "built" : "missing"}` }, identity);
  await waitFor(() => ["completed", "failed"].includes(store.get(run.runId).status));
  const finished = store.get(run.runId);
  await rm(root, { recursive: true, force: true });
  return { finished, explainCalls };
}

test("repo map with no saved index is recorded as failed, not completed", async () => {
  const { finished, explainCalls } = await runRepoMap({ buildIndex: false });
  assert.equal(finished.status, "failed");
  assert.match(finished.failure, /Project indexが未構築/);
  assert.equal(finished.steps.length, 1);
  assert.equal(finished.steps[0].status, "failed");
  assert.equal(finished.steps[0].result.unavailable, true);
  assert.equal(finished.explanation, null);
  assert.equal(explainCalls, 0, "a failed result is not explained as if it succeeded");
});

test("repo map with a built index still completes", async () => {
  const { finished, explainCalls } = await runRepoMap({ buildIndex: true });
  assert.equal(finished.status, "completed");
  assert.equal(finished.failure, null);
  assert.equal(finished.steps[0].status, "completed");
  assert.equal(finished.steps[0].result.unavailable, false);
  assert.equal(finished.steps[0].result.data.totalFiles, 1);
  assert.equal(explainCalls, 1);
});

test("Repo map button labels a failed load as failed, never as loaded", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8");
  const start = source.indexOf('showMap.addEventListener("click"');
  const end = source.indexOf("showMap.disabled = false;", start);
  const handler = source.slice(start, end);
  const loaded = handler.indexOf('"Repository map loaded."');
  const failed = handler.indexOf("Repository map failed:");
  const catchAt = handler.indexOf("} catch (error) {");
  assert.ok(loaded > 0 && catchAt > loaded, "success text only on the success path");
  assert.ok(failed > catchAt, "the catch path says the map failed");
  assert.match(handler.slice(catchAt), /status\.dataset\.state = "error"/);
});
