#!/usr/bin/env node
// Reports built bundle sizes and enforces gzip budgets (#375). Run after `npm run build`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export const BUNDLE_BUDGETS = Object.freeze({
  initialJsGzip: 480_000,
  initialCssGzip: 56_000,
  totalJsGzip: 640_000
});

export function measureBundle(distDir) {
  const html = readFileSync(join(distDir, "index.html"), "utf8");
  const initial = new Set([...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map(match => match[1]));
  const files = readdirSync(join(distDir, "assets"))
    .filter(file => /\.(js|css)$/.test(file))
    .map(file => {
      const bytes = readFileSync(join(distDir, "assets", file));
      return { file, bytes: bytes.length, gzip: gzipSync(bytes).length, initial: initial.has(file) };
    })
    .sort((a, b) => b.gzip - a.gzip);
  const sum = predicate => files.filter(predicate).reduce((total, item) => total + item.gzip, 0);
  return {
    files,
    totals: {
      initialJsGzip: sum(item => item.initial && item.file.endsWith(".js")),
      initialCssGzip: sum(item => item.initial && item.file.endsWith(".css")),
      totalJsGzip: sum(item => item.file.endsWith(".js"))
    }
  };
}

export function overBudget(totals, budgets = BUNDLE_BUDGETS) {
  return Object.entries(budgets)
    .filter(([key, limit]) => totals[key] > limit)
    .map(([key, limit]) => `${key}: ${totals[key]} B gzip exceeds ${limit} B`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files, totals } = measureBundle(fileURLToPath(new URL("../dist", import.meta.url)));
  for (const item of files) {
    console.log(`${item.initial ? "*" : " "} ${item.file.padEnd(36)} ${String(item.bytes).padStart(9)} B  ${String(item.gzip).padStart(8)} B gzip`);
  }
  for (const [key, limit] of Object.entries(BUNDLE_BUDGETS)) console.log(`${key}: ${totals[key]} / ${limit} B gzip`);
  const failures = overBudget(totals);
  for (const failure of failures) console.error(failure);
  process.exitCode = failures.length ? 1 : 0;
}
