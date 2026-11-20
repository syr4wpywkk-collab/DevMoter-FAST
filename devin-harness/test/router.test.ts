import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelsOutput } from "../src/router/models.js";
import {
  resolveModel,
  type RoutingConfig,
} from "../src/router/router.js";

const FIXTURE = `SWE-2 (swe-2)
  aliases: swe
  swe-2-medium    SWE-2 Medium    [262K context, Free]
  swe-2-high      SWE-2 High      [262K context, Free]
  swe-2-max       SWE-2 Max       [262K context, Free]
  swe-2-medium-lightning    SWE-2 Medium Lightning    [$1 / 1M Input · $0.1 / 1M Cached input · $5 / 1M Output]
Adaptive (adaptive)
  adaptive    Adaptive    [$0.5 / 1M Input · $0.1 / 1M Cached input · $2 / 1M Output]
Claude (claude)
  claude-sonnet    Claude Sonnet    [200K context, $3 / 1M Input · $0.3 / 1M Cached input · $15 / 1M Output]
`;

const routing: RoutingConfig = {
  roles: {
    implement: { model: "swe-2-medium", effort: "medium" },
    plan: { model: "swe-2-high", effort: "high" },
    audit: { model: "swe-2-high", effort: "high" },
    default: { model: "swe-2-medium", effort: "medium" },
  },
  refusalFallback: null,
};

test("parseModelsOutput parses families, prices, context, free", () => {
  const models = parseModelsOutput(FIXTURE);
  assert.equal(models.length, 6);

  const medium = models.find((m) => m.id === "swe-2-medium")!;
  assert.equal(medium.family, "SWE-2");
  assert.equal(medium.familyId, "swe-2");
  assert.equal(medium.displayName, "SWE-2 Medium");
  assert.equal(medium.contextLabel, "262K context");
  assert.equal(medium.free, true);
  assert.equal(medium.price, null);

  const lightning = models.find((m) => m.id === "swe-2-medium-lightning")!;
  assert.equal(lightning.free, false);
  assert.deepEqual(lightning.price, {
    inputPerM: 1,
    cachedPerM: 0.1,
    outputPerM: 5,
  });
  assert.equal(lightning.contextLabel, null);

  const adaptive = models.find((m) => m.id === "adaptive")!;
  assert.equal(adaptive.familyId, "adaptive");
  assert.equal(adaptive.free, false);
  assert.deepEqual(adaptive.price, {
    inputPerM: 0.5,
    cachedPerM: 0.1,
    outputPerM: 2,
  });

  const claude = models.find((m) => m.id === "claude-sonnet")!;
  assert.equal(claude.contextLabel, "200K context");
  assert.equal(claude.price?.outputPerM, 15);
});

test("resolveModel: swe-2 + xhigh maps to swe-2-max", () => {
  const catalog = parseModelsOutput(FIXTURE);
  const resolved = resolveModel(catalog, routing, {
    model: "swe-2",
    effort: "xhigh",
  });
  assert.equal(resolved.modelId, "swe-2-max");
  assert.equal(resolved.free, true);
  assert.deepEqual(resolved.warnings, []);
});

test("resolveModel: adaptive + high keeps adaptive with warning", () => {
  const catalog = parseModelsOutput(FIXTURE);
  const resolved = resolveModel(catalog, routing, {
    model: "adaptive",
    effort: "high",
  });
  assert.equal(resolved.modelId, "adaptive");
  assert.equal(resolved.warnings.length, 1);
  assert.equal(resolved.free, false);
});

test("resolveModel: unknown id falls back to default role", () => {
  const catalog = parseModelsOutput(FIXTURE);
  const resolved = resolveModel(catalog, routing, { model: "no-such-model" });
  assert.equal(resolved.modelId, "swe-2-medium");
  assert.equal(resolved.requestedModel, "no-such-model");
  assert.equal(resolved.warnings.length, 1);
});

test("resolveModel: role defaults and effort upgrade", () => {
  const catalog = parseModelsOutput(FIXTURE);
  const byRole = resolveModel(catalog, routing, { role: "plan" });
  assert.equal(byRole.modelId, "swe-2-high");
  const upgraded = resolveModel(catalog, routing, {
    model: "swe-2-medium",
    effort: "high",
  });
  assert.equal(upgraded.modelId, "swe-2-high");
});
