import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { EffectivePolicy } from "../types.js";
import { isCoveredByDeny } from "./policy.js";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function union(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out;
}

/**
 * Generate a per-worker Devin config: start from the user's existing config
 * (other keys preserved verbatim), merge permissions monotonically —
 * deny is the union, allow is the union filtered by the final deny set,
 * ask comes from the effective policy. Written with mode 0600.
 * Config contents are never logged.
 */
export async function generateDevinConfig(input: {
  policy: EffectivePolicy;
  destPath: string;
  userConfigPath?: string;
}): Promise<string> {
  const userConfigPath =
    input.userConfigPath ??
    path.join(os.homedir(), ".config", "devin", "config.json");

  let existing: Record<string, unknown> = {};
  try {
    const text = await readFile(userConfigPath, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = structuredClone(parsed) as Record<string, unknown>;
    }
  } catch {
    // Missing or non-JSON user config: start fresh.
    existing = {};
  }

  const existingPerms =
    existing.permissions &&
    typeof existing.permissions === "object" &&
    !Array.isArray(existing.permissions)
      ? (existing.permissions as Record<string, unknown>)
      : {};

  const deny = union(
    asStringArray(existingPerms.deny),
    input.policy.rules.deny,
  );
  const allowUnion = union(
    asStringArray(existingPerms.allow),
    input.policy.rules.allow,
  );
  const allow = allowUnion.filter(
    (rule) => !deny.some((d) => isCoveredByDeny(d, rule)),
  );

  existing.permissions = {
    ...existingPerms,
    allow,
    deny,
    ask: [...input.policy.rules.ask],
  };

  await mkdir(path.dirname(input.destPath), { recursive: true });
  await writeFile(input.destPath, JSON.stringify(existing, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  return input.destPath;
}
