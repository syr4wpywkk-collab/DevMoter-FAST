import { readFile } from "node:fs/promises";
import type { Effort, ModelInfo, ResolvedModel, Role } from "../types.js";

export interface RoutingConfig {
  roles: Record<Role, { model: string; effort?: Effort }>;
  refusalFallback: string | null;
}

const ROLES: Role[] = ["implement", "plan", "audit", "default"];

export async function loadRouting(path: string): Promise<RoutingConfig> {
  const data = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  const rawRoles = (data.roles ?? {}) as Record<string, unknown>;
  const roles = {} as Record<Role, { model: string; effort?: Effort }>;
  for (const role of ROLES) {
    const raw = (rawRoles[role] ?? {}) as Record<string, unknown>;
    roles[role] = {
      model: typeof raw.model === "string" ? raw.model : "swe-2-medium",
      ...(typeof raw.effort === "string"
        ? { effort: raw.effort as Effort }
        : {}),
    };
  }
  return {
    roles,
    refusalFallback:
      typeof data.refusalFallback === "string" ? data.refusalFallback : null,
  };
}

const EFFORT_SUFFIXES = ["low", "medium", "high", "xhigh", "max"] as const;

/** Effort fallback chains (SPEC §3): first existing variant wins. */
const EFFORT_CANDIDATES: Record<string, string[]> = {
  low: ["low", "medium"],
  medium: ["medium"],
  high: ["high", "xhigh", "max"],
  xhigh: ["xhigh", "max", "high"],
  max: ["max", "xhigh", "high"],
};

interface SplitId {
  base: string;
  suffix: string | null;
  fast: boolean;
}

/** Split "swe-2-high-fast" -> { base: "swe-2", suffix: "high", fast: true }. */
function splitEffortSuffix(id: string): SplitId {
  let rest = id;
  let fast = false;
  if (rest.endsWith("-fast")) {
    fast = true;
    rest = rest.slice(0, -"-fast".length);
  }
  for (const suffix of EFFORT_SUFFIXES) {
    if (rest.endsWith(`-${suffix}`)) {
      return { base: rest.slice(0, -(suffix.length + 1)), suffix, fast };
    }
  }
  return { base: rest, suffix: null, fast };
}

function candidateIds(base: string, effort: string, fast: boolean): string[] {
  const out: string[] = [];
  for (const cand of EFFORT_CANDIDATES[effort] ?? [effort]) {
    if (fast) out.push(`${base}-${cand}-fast`);
    out.push(`${base}-${cand}`);
  }
  return out;
}

export function resolveModel(
  catalog: ModelInfo[],
  routing: RoutingConfig,
  input: { role?: Role; model?: string; effort?: Effort },
): ResolvedModel {
  const warnings: string[] = [];
  const role: Role = input.role ?? "default";
  const roleCfg = routing.roles[role] ?? routing.roles.default;
  const requested = input.model ?? roleCfg.model;
  const effort: Effort | null = input.effort ?? roleCfg.effort ?? null;

  const byId = new Map(catalog.map((m) => [m.id, m]));

  const finish = (modelId: string): ResolvedModel => ({
    modelId,
    requestedModel: requested,
    effort,
    warnings,
    free: byId.get(modelId)?.free ?? false,
  });

  // Try to resolve a model reference against the catalog, applying the
  // effort-variant mapping. Returns null when nothing matches.
  const tryResolve = (ref: string, eff: Effort | null): string | null => {
    if (byId.has(ref)) {
      if (!eff) return ref;
      const split = splitEffortSuffix(ref);
      if (split.suffix === eff) return ref; // already the desired variant
      for (const cand of candidateIds(split.base, eff, split.fast)) {
        if (byId.has(cand)) return cand;
      }
      return null; // exact id exists but no effort variant: caller decides
    }
    // Not an exact id: treat as a family base, look at "<ref>-*" variants.
    const prefixed = catalog.filter((m) => m.id.startsWith(ref + "-"));
    if (prefixed.length === 0) return null;
    if (!eff) return prefixed[0].id;
    for (const cand of candidateIds(ref, eff, false)) {
      if (byId.has(cand)) return cand;
    }
    return null;
  };

  if (byId.has(requested)) {
    if (!effort) return finish(requested);
    const split = splitEffortSuffix(requested);
    if (split.suffix === effort) return finish(requested);
    const resolved = tryResolve(requested, effort);
    if (resolved) return finish(resolved);
    warnings.push(
      `no ${effort} variant found for model "${requested}"; using it as-is`,
    );
    return finish(requested);
  }

  const resolved = tryResolve(requested, effort);
  if (resolved) return finish(resolved);

  // Unknown id: fall back to the default role's resolution.
  const defaultCfg = routing.roles.default;
  const defaultEffort = effort ?? defaultCfg.effort ?? null;
  if (defaultCfg.model !== requested) {
    const fallback = tryResolve(defaultCfg.model, defaultEffort);
    if (fallback) {
      warnings.push(
        `model "${requested}" not found in catalog; fell back to default "${fallback}"`,
      );
      return {
        modelId: fallback,
        requestedModel: requested,
        effort,
        warnings,
        free: byId.get(fallback)?.free ?? false,
      };
    }
    if (byId.has(defaultCfg.model)) {
      warnings.push(
        `model "${requested}" not found in catalog; fell back to default "${defaultCfg.model}"`,
      );
      return {
        modelId: defaultCfg.model,
        requestedModel: requested,
        effort,
        warnings,
        free: byId.get(defaultCfg.model)?.free ?? false,
      };
    }
  }
  warnings.push(
    `model "${requested}" not found in catalog and no fallback available; using it as-is`,
  );
  return finish(requested);
}

export function loadRefusalFallbackEnv(
  routing: RoutingConfig,
): Record<string, string> {
  if (routing.refusalFallback) {
    return { DEVIN_REFUSAL_FALLBACK: routing.refusalFallback };
  }
  return {};
}
