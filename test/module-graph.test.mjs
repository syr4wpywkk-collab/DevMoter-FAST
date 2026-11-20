import test from "node:test";
import assert from "node:assert/strict";
import { fanStats, mermaid, moduleGraph } from "../scripts/module-graph.mjs";

test("#356: module graph resolves real imports and renders Mermaid", () => {
  const graph = moduleGraph();
  assert.ok(graph.get("src/codex.ts").includes("src/i18n.ts"), "codex.ts imports i18n.ts");
  const i18n = fanStats(graph).find(item => item.file === "src/i18n.ts");
  assert.ok(i18n.fanIn > 10, "i18n.ts is widely imported");
  const diagram = mermaid(new Map([["a.ts", ["b.ts"]], ["b.ts", []], ["c.ts", ["b.ts"]]]), 2);
  assert.match(diagram, /^graph LR/);
  assert.match(diagram, /b_ts\["b.ts"\]/);
  assert.match(diagram, /a_ts --> b_ts|c_ts --> b_ts/);
});
