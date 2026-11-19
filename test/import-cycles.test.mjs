import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

// #370: relative imports in src/, server/ and server.mjs must not form cycles.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT = /(?:import|export)\s[^"']*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|^\s*import\s*["'](\.{1,2}\/[^"']+)["']/gm;

function sourceFiles(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "locales" ? [] : sourceFiles(path);
    return /\.(ts|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function resolve(from, specifier) {
  const base = normalize(join(dirname(from), specifier));
  return [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.mjs`].find(path => existsSync(join(root, path)));
}

export function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = [];
  const visit = node => {
    state.set(node, "open");
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (state.get(next) === "open") cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, "done");
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

test("cycle detection reports a synthetic cycle", () => {
  const graph = new Map([["a", ["b"]], ["b", ["c"]], ["c", ["a"]], ["d", ["a"]]]);
  assert.deepEqual(findCycles(graph), [["a", "b", "c", "a"]]);
  assert.deepEqual(findCycles(new Map([["a", ["b"]], ["b", []]])), []);
});

test("#370: src/ and server/ have no circular relative imports", () => {
  const files = ["server.mjs", ...sourceFiles("src"), ...sourceFiles("server")];
  const graph = new Map(files.map(file => {
    const source = readFileSync(join(root, file), "utf8");
    const targets = [...source.matchAll(IMPORT)]
      .map(match => resolve(file, match[1] || match[2] || match[3]))
      .filter(target => target && files.includes(target));
    return [file, [...new Set(targets)]];
  }));
  const edges = [...graph.values()].reduce((sum, targets) => sum + targets.length, 0);
  assert.ok(edges > 200, `import graph looks too small (${edges} edges); resolver may be broken`);
  const cycles = findCycles(graph).map(cycle => cycle.map(file => relative(".", file)).join(" -> "));
  assert.deepEqual(cycles, [], `circular imports:\n${cycles.join("\n")}`);
});
