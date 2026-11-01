import test from "node:test";
import assert from "node:assert/strict";
import { projectOptionLabels } from "../src/project-labels.mjs";

test("unique project names show the name only", () => {
  assert.deepEqual(projectOptionLabels([
    { id: "a", name: "DevMoter-FAST", path: "/home/u/work/DevMoter-FAST" },
    { id: "b", name: "雑談", path: "/home/u/chat" }
  ]), ["DevMoter-FAST", "雑談"]);
});

test("duplicate names get the shortest parent-directory suffix that differs", () => {
  assert.deepEqual(projectOptionLabels([
    { id: "a", name: "app", path: "/home/u/work/app" },
    { id: "b", name: "app", path: "/home/u/play/app" },
    { id: "c", name: "other", path: "/x/other" }
  ]), ["app · work", "app · play", "other"]);
  assert.deepEqual(projectOptionLabels([
    { id: "a", name: "app", path: "/a/src/app" },
    { id: "b", name: "app", path: "/b/src/app" }
  ]), ["app · a/src", "app · b/src"]);
});

test("duplicates with indistinguishable paths fall back to a position number", () => {
  assert.deepEqual(projectOptionLabels([
    { id: "a", name: "same", path: "/p/same" },
    { id: "b", name: "same", path: "/p/same" }
  ]), ["same · 1", "same · 2"]);
});

test("empty or missing names fall back to the last path segment, then the id", () => {
  assert.deepEqual(projectOptionLabels([
    { id: "a", name: "  ", path: "/home/u/notes/" },
    { id: "b", path: "C:\\work\\win-proj" },
    { id: "c" }
  ]), ["notes", "win-proj", "c"]);
  assert.deepEqual(projectOptionLabels(undefined), []);
});

test("long names are truncated with an ellipsis", () => {
  const [label] = projectOptionLabels([{ id: "a", name: "x".repeat(100), path: "/p" }]);
  assert.equal(label.length, 60);
  assert.ok(label.endsWith("…"));
});
