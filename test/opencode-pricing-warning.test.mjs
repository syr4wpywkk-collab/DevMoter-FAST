import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DICTIONARIES } from "../src/i18n-core.mjs";

const opencode = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
const KEYS = ["paidLabel", "zeroBaseLabel", "unknownLabel", "noUpstreamRates", "detail"].map(key => `opencode.pricing.${key}`);

// #346: OpenCode never presents a model as free just because the catalogue omits or zeroes prices.
test("#346: OpenCode model rows and the model button carry the pricing warning", () => {
  assert.match(opencode, /option\.title = `\$\{row\.providerID\}\/\$\{model\.id\} · \$\{localizedModelPricingDetail\(model\.cost\)\}`/);
  assert.match(opencode, /modelButton\.title = `\$\{modelTitle\} · \$\{localizedModelPricingDetail\(pricingModel\?\.cost\)\}`/);
  const fn = opencode.slice(opencode.indexOf("function localizedModelPricingDetail"), opencode.indexOf("return t(\"opencode.pricing.detail\""));
  assert.match(fn, /some\(rate => rate > 0\)/, "any positive rate is paid");
  assert.match(fn, /cost\?\.input === 0 && cost\?\.output === 0/, "only an explicit zero input and output is a zero base rate");
  assert.match(fn, /: t\("opencode\.pricing\.unknownLabel"\)/, "everything else is unknown, never free");
});

test("#346: every locale words zero and unknown pricing as not confirmed free", () => {
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) {
    for (const key of KEYS) assert.ok(dictionary[key], `${language} ${key}`);
    assert.match(dictionary["opencode.pricing.detail"], /\{label\}/, language);
    assert.match(dictionary["opencode.pricing.detail"], /\{rates\}/, language);
  }
  assert.match(DICTIONARIES.en["opencode.pricing.zeroBaseLabel"], /not guaranteed free/);
  assert.match(DICTIONARIES.en["opencode.pricing.unknownLabel"], /not confirmed free/);
});
