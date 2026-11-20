import { readFile } from "node:fs/promises";
import type {
  EffectivePolicy,
  PolicyRules,
  ResolvedMode,
  SpecPermissionMode,
} from "../types.js";

export interface ProfileDef extends PolicyRules {
  mode: SpecPermissionMode;
  requiresHumanConfirm?: boolean;
}

export function resolveMode(mode: SpecPermissionMode): ResolvedMode {
  switch (mode) {
    case "normal":
      return { specMode: mode, cliMode: "auto", sandbox: false };
    case "accept-edits":
      return { specMode: mode, cliMode: "accept-edits", sandbox: false };
    case "smart":
      return { specMode: mode, cliMode: "smart", sandbox: false };
    case "autonomous":
      return { specMode: mode, cliMode: "smart", sandbox: true };
    case "dangerous":
      return { specMode: mode, cliMode: "dangerous", sandbox: false };
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function normalizeRules(raw: unknown): PolicyRules {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    allow: asStringArray(obj.allow),
    deny: asStringArray(obj.deny),
    ask: asStringArray(obj.ask),
  };
}

export async function loadBaseDeny(path: string): Promise<PolicyRules> {
  const text = await readFile(path, "utf8");
  return normalizeRules(JSON.parse(text));
}

export async function loadProfiles(
  path: string,
): Promise<{
  defaultMode: SpecPermissionMode;
  profiles: Record<string, ProfileDef>;
}> {
  const text = await readFile(path, "utf8");
  const data = JSON.parse(text) as Record<string, unknown>;
  const defaultMode = (data.defaultMode as SpecPermissionMode) ?? "smart";
  const rawProfiles = (data.profiles ?? {}) as Record<string, unknown>;
  const profiles: Record<string, ProfileDef> = {};
  for (const [name, raw] of Object.entries(rawProfiles)) {
    const obj = (raw ?? {}) as Record<string, unknown>;
    profiles[name] = {
      ...normalizeRules(obj),
      mode: (obj.mode as SpecPermissionMode) ?? defaultMode,
      ...(typeof obj.requiresHumanConfirm === "boolean"
        ? { requiresHumanConfirm: obj.requiresHumanConfirm }
        : {}),
    };
  }
  return { defaultMode, profiles };
}

/** Parse "Tool(pattern)" into its parts; bare names get an empty pattern. */
export function parseRule(rule: string): { tool: string; pattern: string } {
  const m = /^([A-Za-z][A-Za-z0-9_-]*)\((.*)\)$/s.exec(rule.trim());
  if (m) return { tool: m[1], pattern: m[2] };
  return { tool: rule.trim(), pattern: "" };
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
}

/** Convert a glob (with ** and *) into an anchored RegExp. */
export function globToRegex(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        // Collapse "**/" so it also matches zero directories.
        if (glob[i + 1] === "/") {
          out += "/?";
          i++;
        }
      } else {
        out += "[^/]*";
      }
    } else {
      out += escapeRegex(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

function hasGlob(pattern: string): boolean {
  return pattern.includes("*");
}

/** A representative literal matched by a glob pattern (for reverse checks). */
function globSample(pattern: string): string {
  return pattern.replace(/\*\*/g, "x").replace(/\*/g, "x");
}

/**
 * True when `denyRule` covers `candidateRule` (same tool), per SPEC §2:
 * (a) exact match, (b) the deny glob matches the candidate pattern string,
 * (c) the candidate is a literal path under a deny "/**" directory prefix.
 * Additionally, a glob candidate whose own glob matches a literal sample of
 * the deny pattern (e.g. allow Read(**) vs deny Read(.env*)) is covered,
 * since such an allow would re-permit the denied path.
 */
export function isCoveredByDeny(denyRule: string, candidateRule: string): boolean {
  const deny = parseRule(denyRule);
  const cand = parseRule(candidateRule);
  if (deny.tool !== cand.tool) return false;
  // (a) exact match
  if (deny.pattern === cand.pattern) return true;
  // (b) deny glob matches the candidate pattern string
  if (hasGlob(deny.pattern) && globToRegex(deny.pattern).test(cand.pattern)) {
    return true;
  }
  // (c) literal candidate under a deny directory prefix (".../**")
  if (!hasGlob(cand.pattern) && deny.pattern.endsWith("/**")) {
    const prefix = deny.pattern.slice(0, -3);
    if (cand.pattern === prefix || cand.pattern.startsWith(prefix + "/")) {
      return true;
    }
  }
  // Reverse: candidate glob matches a literal sample of the deny pattern.
  if (hasGlob(cand.pattern) && hasGlob(deny.pattern)) {
    if (globToRegex(cand.pattern).test(globSample(deny.pattern))) return true;
  }
  return false;
}

function union(...lists: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out;
}

function stripCovered(rules: string[], deny: string[]): string[] {
  return rules.filter(
    (rule) => !deny.some((d) => isCoveredByDeny(d, rule)),
  );
}

export function buildEffectivePolicy(input: {
  mode: SpecPermissionMode;
  base: PolicyRules;
  profile?: PolicyRules | null;
  task?: Partial<PolicyRules> | null;
  worktree?: string;
}): EffectivePolicy {
  const resolved = resolveMode(input.mode);
  const deny = union(input.base.deny, input.profile?.deny, input.task?.deny);

  let allow = union(input.base.allow, input.profile?.allow, input.task?.allow);
  let ask = union(input.base.ask, input.profile?.ask, input.task?.ask);

  if (resolved.sandbox && input.worktree) {
    const wt = input.worktree.replace(/\/+$/, "");
    allow = union(allow, [`Read(${wt}/**)`, `Write(${wt}/**)`]);
  }

  allow = stripCovered(allow, deny);
  ask = stripCovered(ask, deny);

  return { ...resolved, rules: { allow, deny, ask } };
}
