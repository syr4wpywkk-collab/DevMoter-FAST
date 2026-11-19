#!/usr/bin/env node
// Prints the relative-import graph of src/, server/ and server.mjs as a fan-in/fan-out
// table plus a Mermaid diagram of the most depended-on modules (#356).
// Usage: node scripts/module-graph.mjs [--top N]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

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

export function moduleGraph() {
  const files = ["server.mjs", ...sourceFiles("src"), ...sourceFiles("server")];
  return new Map(files.map(file => {
    const source = readFileSync(join(root, file), "utf8");
    const targets = [...source.matchAll(IMPORT)]
      .map(match => resolve(file, match[1] || match[2] || match[3]))
      .filter(target => target && files.includes(target));
    return [file, [...new Set(targets)]];
  }));
}

export function fanStats(graph) {
  const fanIn = new Map([...graph.keys()].map(file => [file, 0]));
  for (const targets of graph.values()) for (const target of targets) fanIn.set(target, fanIn.get(target) + 1);
  return [...graph.keys()].map(file => ({ file, fanIn: fanIn.get(file), fanOut: graph.get(file).length }));
}

export function mermaid(graph, top = 15) {
  const keep = new Set(fanStats(graph).sort((a, b) => b.fanIn - a.fanIn).slice(0, top).map(item => item.file));
  const id = file => file.replace(/[^A-Za-z0-9]/g, "_");
  const lines = ["graph LR"];
  for (const file of keep) lines.push(`  ${id(file)}["${file}"]`);
  for (const [file, targets] of graph) {
    if (!keep.has(file)) continue;
    for (const target of targets) if (keep.has(target)) lines.push(`  ${id(file)} --> ${id(target)}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const topIndex = process.argv.indexOf("--top");
  const top = topIndex > 0 ? Number(process.argv[topIndex + 1]) || 15 : 15;
  const graph = moduleGraph();
  const stats = fanStats(graph);
  const edges = stats.reduce((sum, item) => sum + item.fanOut, 0);
  console.log(`${graph.size} modules, ${edges} relative imports\n`);
  console.log("| Module | Imported by | Imports |\n|---|---|---|");
  for (const item of [...stats].sort((a, b) => b.fanIn - a.fanIn).slice(0, top)) console.log(`| \`${item.file}\` | ${item.fanIn} | ${item.fanOut} |`);
  console.log("\n```mermaid\n" + mermaid(graph, top) + "\n```");
}
