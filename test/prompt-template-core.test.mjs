import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  draftNeedsConfirmation, expandTemplate, extractVariables, mergeIntoDraft, searchTemplates, templatesForScope
} from "../src/prompt-template-core.mjs";

test("variables are found once each, in order", () => {
  assert.deepEqual(extractVariables("Fix {{ file }} in {{branch}} then test {{file}} ({{対象}})"), ["file", "branch", "対象"]);
  assert.deepEqual(extractVariables("no variables, {single} braces, {{}} and {{ }}"), []);
});

test("expansion fills given values and reports the rest as missing", () => {
  const body = "Review {{file}} for {{goal}}";
  assert.deepEqual(expandTemplate(body, { file: "a.ts", goal: "bugs" }), { text: "Review a.ts for bugs", missing: [] });
  assert.deepEqual(expandTemplate(body, { file: "a.ts", goal: "   " }), { text: "Review a.ts for {{goal}}", missing: ["goal"] });
  assert.deepEqual(expandTemplate(body), { text: body, missing: ["file", "goal"] });
  assert.equal(body, "Review {{file}} for {{goal}}");
});

test("values are inserted literally and never expanded again", () => {
  assert.equal(expandTemplate("{{a}} {{b}}", { a: "{{b}}", b: "$& $1 x" }).text, "{{b}} $& $1 x");
  assert.deepEqual(expandTemplate("{{constructor}}", {}).missing, ["constructor"]);
  const values = Object.create(null);
  values.__proto__ = "x";
  assert.deepEqual(expandTemplate("{{__proto__}}", values), { text: "x", missing: [] });
});

test("search matches part of the name or description and can come back empty", () => {
  const templates = [
    { name: "Code Review", description: "Checks a pull request" },
    { name: "Summarize", description: "Short summary of a file" },
    { name: "バグ調査", description: "原因を調べる" }
  ];
  assert.deepEqual(searchTemplates(templates, "rev").map(item => item.name), ["Code Review"]);
  assert.deepEqual(searchTemplates(templates, "FILE").map(item => item.name), ["Summarize"]);
  assert.deepEqual(searchTemplates(templates, "pull code").map(item => item.name), ["Code Review"]);
  assert.deepEqual(searchTemplates(templates, "調査").map(item => item.name), ["バグ調査"]);
  assert.deepEqual(searchTemplates(templates, "nothing"), []);
  assert.equal(searchTemplates(templates, "  ").length, 3);
});

test("scope filter never shows another project's templates", () => {
  const templates = [{ name: "g", projectId: null }, { name: "a", projectId: "alpha" }, { name: "b", projectId: "beta" }];
  assert.deepEqual(templatesForScope(templates, null).map(item => item.name), ["g"]);
  assert.deepEqual(templatesForScope(templates, "alpha").map(item => item.name), ["g", "a"]);
});

test("an existing draft is kept unless the user chooses to replace it", () => {
  assert.equal(draftNeedsConfirmation(""), false);
  assert.equal(draftNeedsConfirmation(" \n"), false);
  assert.equal(draftNeedsConfirmation("half-written"), true);
  assert.equal(mergeIntoDraft("half-written\n", "template", "append"), "half-written\n\ntemplate");
  assert.equal(mergeIntoDraft("half-written", "template", "replace"), "template");
  assert.equal(mergeIntoDraft("", "template", "append"), "template");
});

test("the template sheet only writes to the composer and never submits", async () => {
  const source = await readFile(new URL("../src/prompt-templates.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.submit\(|requestSubmit|\.click\(\)(?<!link\.click\(\)|fileInput\.click\(\))|KeyboardEvent\(/);
  assert.match(source, /window\.confirm\(t\("promptTemplates\.deleteConfirm"/);
  assert.match(source, /draftNeedsConfirmation\(composer\.value\)/);
});
