import test from "node:test";
import assert from "node:assert/strict";
import { filterOpenCodePickerModels, flattenOpenCodePickerRows, openCodePickerWindow } from "../src/opencode-provider-catalog.mjs";

// 3 free models on a connected provider + 914 free models spread over 40
// unconnected providers that need a key: 917 cost-zero rows in total.
function freeHeavyCatalog() {
  const providers = [{
    id: "opencode",
    name: "OpenCode Zen",
    models: Object.fromEntries(["a", "b", "c"].map(id => [id, { name: id, cost: { input: 0, output: 0 }, available: true }]))
  }];
  let remaining = 914;
  for (let p = 0; remaining > 0; p++) {
    const count = Math.min(remaining, 23);
    remaining -= count;
    providers.push({
      id: `gateway-${p}`,
      name: `Gateway ${String(p).padStart(2, "0")}`,
      models: Object.fromEntries(Array.from({ length: count }, (_, i) => [`m${i}`, {
        name: `m${i}`,
        cost: { input: 0, output: 0 },
        available: false,
        requiresKey: [`GATEWAY_${p}_KEY`]
      }]))
    });
  }
  providers.push({ id: "paid", name: "Paid", models: { x: { name: "x", cost: { input: 1, output: 2 }, available: true } } });
  return providers;
}

test("Free view folds the 914 needs-key rows to one row per provider", () => {
  const result = filterOpenCodePickerModels(freeHeavyCatalog(), { free: true, connected: ["opencode", "paid"] });
  assert.equal(result.counts.free, 917, "the filter count still reports every cost-zero model");
  assert.equal(result.active.length, 917);

  const rows = flattenOpenCodePickerRows(result, { free: true });
  const models = rows.filter(row => row.kind === "model");
  assert.equal(models.length, 3, "only usable free models are listed by default");
  assert.ok(models.every(row => row.row.selectable));
  const folded = rows.filter(row => row.kind === "keyProvider");
  assert.equal(folded.length, 40);
  assert.equal(folded.reduce((sum, row) => sum + row.count, 0), 914);
  assert.ok(folded.every(row => row.expanded === false));
  assert.deepEqual(rows.filter(row => row.kind === "group").map(row => [row.name, row.count]), [["使える", 3], ["キーが必要", 914]]);
  assert.ok(rows.length < 50, `Free view renders ${rows.length} rows instead of 900+`);
});

test("expanding one needs-key provider lists only that provider's models", () => {
  const result = filterOpenCodePickerModels(freeHeavyCatalog(), { free: true, connected: ["opencode", "paid"] });
  const rows = flattenOpenCodePickerRows(result, { free: true, expandedKeyProviders: new Set(["gateway-1"]) });
  const keyed = rows.filter(row => row.kind === "model" && row.row.needsKey);
  assert.equal(keyed.length, 23);
  assert.ok(keyed.every(row => row.row.providerID === "gateway-1"));
  const index = rows.findIndex(row => row.kind === "keyProvider" && row.id === "gateway-1");
  assert.equal(rows[index].expanded, true);
  assert.equal(rows[index + 1].kind, "model");
});

test("outside the Free view the list is unchanged and still virtualized", () => {
  const result = filterOpenCodePickerModels(freeHeavyCatalog(), { connected: ["opencode", "paid"] });
  const rows = flattenOpenCodePickerRows(result, { free: false });
  assert.equal(rows.filter(row => row.kind === "keyProvider").length, 0);
  assert.equal(rows.filter(row => row.kind === "model").length, 918);
  const window = openCodePickerWindow(0, 560, rows.length, 56);
  assert.ok(window.end - window.start <= 16);
});

test("deprecated rows stay hidden until opened", () => {
  const providers = [{ id: "p", name: "P", models: {
    old: { name: "old", status: "deprecated", cost: { input: 0, output: 0 }, available: true },
    cur: { name: "cur", cost: { input: 0, output: 0 }, available: true }
  } }];
  const result = filterOpenCodePickerModels(providers, { free: true, connected: ["p"] });
  assert.equal(flattenOpenCodePickerRows(result, { free: true }).filter(row => row.kind === "model").length, 1);
  assert.equal(flattenOpenCodePickerRows(result, { free: true, deprecatedOpen: true }).filter(row => row.kind === "model").length, 2);
});
