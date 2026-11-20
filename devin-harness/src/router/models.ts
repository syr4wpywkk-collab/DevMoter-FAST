import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { ModelInfo, ModelPrice } from "../types.js";
import { runCommand } from "../util/exec.js";

const CACHE_TTL_MS = 10 * 60 * 1000;

function parsePrice(text: string): ModelPrice | null {
  const input = /\$\s*([\d.]+)\s*\/\s*1M\s+Input/i.exec(text);
  if (!input) return null;
  const cached = /\$\s*([\d.]+)\s*\/\s*1M\s+Cached input/i.exec(text);
  const output = /\$\s*([\d.]+)\s*\/\s*1M\s+Output/i.exec(text);
  return {
    inputPerM: Number(input[1]),
    cachedPerM: cached ? Number(cached[1]) : 0,
    outputPerM: output ? Number(output[1]) : 0,
  };
}

/**
 * Parse `devin models` output. Real format (v3000.14.30821):
 *   SWE-2 (swe-2)
 *     aliases: swe
 *     swe-2-medium    SWE-2 Medium    [262K context, Free]
 *     swe-2-medium-lightning  ...     [$0.5 / 1M Input · $0.1 / 1M Cached input · $2 / 1M Output]
 */
export function parseModelsOutput(text: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  let family = "";
  let familyId = "";

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;

    if (!/^\s/.test(rawLine)) {
      // Family header: "SWE-2 (swe-2)"
      const m = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(rawLine.trim());
      if (m) {
        family = m[1].trim();
        familyId = m[2].trim();
      } else {
        family = rawLine.trim();
        familyId = "";
      }
      continue;
    }

    const line = rawLine.trim();
    if (/^aliases:/i.test(line)) continue;

    // Model line: "<id>  <display name>  [<annotations>]"
    const bracketMatch = /\[([^\]]*)\]\s*$/.exec(line);
    const annotations = bracketMatch ? bracketMatch[1] : "";
    const head = bracketMatch ? line.slice(0, bracketMatch.index).trim() : line;
    const idMatch = /^(\S+)\s*(.*)$/.exec(head);
    if (!idMatch) continue;
    const id = idMatch[1];
    const displayName = idMatch[2].trim() || id;

    const contextMatch = /(\d+(?:\.\d+)?\s*[KM]\s+context)/i.exec(annotations);
    const price = parsePrice(annotations);
    const free = /\bFree\b/.test(annotations);

    models.push({
      id,
      displayName,
      family,
      familyId,
      contextLabel: contextMatch ? contextMatch[1].replace(/\s+/g, " ") : null,
      free,
      price,
    });
  }
  return models;
}

interface ModelsCache {
  fetchedAt: string;
  models: ModelInfo[];
}

export async function fetchCatalog(opts: {
  devinBin: string;
  stateDir: string;
  refresh?: boolean;
}): Promise<ModelInfo[]> {
  const cachePath = path.join(opts.stateDir, "models-cache.json");

  let cached: ModelsCache | null = null;
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as ModelsCache;
    if (parsed && Array.isArray(parsed.models)) cached = parsed;
  } catch {
    cached = null;
  }

  if (!opts.refresh && cached) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
      return cached.models;
    }
  }

  const result = await runCommand(opts.devinBin, ["models"], {
    timeoutMs: 30_000,
  });
  if (result.code === 0 && result.stdout.trim()) {
    const models = parseModelsOutput(result.stdout);
    if (models.length > 0) {
      try {
        await mkdir(opts.stateDir, { recursive: true });
        const cache: ModelsCache = {
          fetchedAt: new Date().toISOString(),
          models,
        };
        await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
      } catch {
        /* cache write is best-effort */
      }
      return models;
    }
  }
  return cached?.models ?? [];
}
