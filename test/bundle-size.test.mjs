import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { BUNDLE_BUDGETS, measureBundle, overBudget } from "../scripts/bundle-size.mjs";

// #375: the built app stays inside its gzip budgets. Requires `npm run build` first.
test("#375: built bundle stays within its gzip budgets", () => {
  const { files, totals } = measureBundle(fileURLToPath(new URL("../dist", import.meta.url)));
  assert.ok(files.some(item => item.initial && item.file.endsWith(".js")), "index.html loads an entry script");
  assert.ok(files.some(item => item.initial && item.file.endsWith(".css")), "index.html loads a stylesheet");
  assert.deepEqual(overBudget(totals), []);
});

test("budget check reports each exceeded limit", () => {
  const over = { initialJsGzip: BUNDLE_BUDGETS.initialJsGzip + 1, initialCssGzip: 0, totalJsGzip: 0 };
  assert.deepEqual(overBudget(over), [`initialJsGzip: ${over.initialJsGzip} B gzip exceeds ${BUNDLE_BUDGETS.initialJsGzip} B`]);
});
