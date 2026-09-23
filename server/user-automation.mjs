import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
export const HOOK_SCHEMA_VERSION = 1;
export const HOOK_EVENTS = Object.freeze(["before-run", "after-tool", "after-run", "verification-complete"]);
const RESERVED_SLASH = new Set(["help", "clear", "new", "mode"]);
const SAFE_ACTIONS = new Set(["open-tools", "open-workflows", "show-help"]);
const PARAM_TYPES = new Set(["string", "number", "boolean", "enum"]);
const STEP_TYPES = new Set(["prompt", "verify", "hook"]);
const MAX_RUNS = 100;

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strings(value, max = 64) {
  return Array.isArray(value) ? value.slice(0, max).map(item => String(item ?? "").trim()).filter(Boolean) : [];
}

function validateName(value, label = "name") {
  const name = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw new Error(label + " must match /^[a-z][a-z0-9-]{0,31}$/");
  return name;
}

export function normalizeHook(input, index = 0) {
  if (!plain(input)) throw new Error("Hook " + (index + 1) + " must be an object");
  const event = String(input.event || "");
  if (!HOOK_EVENTS.includes(event)) throw new Error("Unsupported hook event: " + event);
  const kind = String(input.kind || "notify");
  if (!["notify", "command"].includes(kind)) throw new Error("Unsupported hook kind: " + kind);
  const hook = {
    id: String(input.id || randomUUID()).slice(0, 120),
    name: String(input.name || ("Hook " + (index + 1))).slice(0, 120),
    event,
    kind,
    enabled: input.enabled !== false,
    timeoutMs: Math.min(10000, Math.max(250, Number(input.timeoutMs) || 3000)),
    permission: kind === "command" ? "mutate" : "observe",
    approved: kind === "command" ? input.approved === true : true,
    command: "",
    args: []
  };
  if (kind === "command") {
    hook.command = String(input.command || "").trim().slice(0, 240);
    hook.args = strings(input.args, 32).map(arg => arg.slice(0, 1000));
    if (!hook.command || hook.command.includes("\0")) throw new Error(hook.name + ": command is required");
  }
  return hook;
}

export function normalizeSlashCommand(input, index = 0) {
  if (!plain(input)) throw new Error("Slash command " + (index + 1) + " must be an object");
  const name = validateName(input.name, "Slash command name");
  if (RESERVED_SLASH.has(name)) throw new Error("/" + name + " is reserved by DevMoter");
  const kind = String(input.kind || "prompt");
  if (!["prompt", "action"].includes(kind)) throw new Error("Unsupported slash command kind");
  const command = {
    id: String(input.id || randomUUID()).slice(0, 120),
    name,
    description: String(input.description || "").slice(0, 300),
    kind,
    template: kind === "prompt" ? String(input.template || "").slice(0, 32000) : "",
    action: kind === "action" ? String(input.action || "") : "",
    source: "user",
    precedence: 20,
    enabled: input.enabled !== false
  };
  if (kind === "prompt" && !command.template.trim()) throw new Error("/" + name + ": prompt template is required");
  if (kind === "action" && !SAFE_ACTIONS.has(command.action)) throw new Error("/" + name + ": action is not allowlisted");
  return command;
}

function normalizeParam(input, name) {
  if (!plain(input)) throw new Error("Recipe parameter " + name + " must be an object");
  const type = String(input.type || "string");
  if (!PARAM_TYPES.has(type)) throw new Error("Unsupported parameter type for " + name);
  const param = {
    type,
    required: input.required !== false,
    default: input.default,
    values: type === "enum" ? strings(input.values, 64) : []
  };
  if (type === "enum" && !param.values.length) throw new Error("Enum parameter " + name + " requires values");
  return param;
}

export function normalizeRecipe(input, index = 0) {
  if (!plain(input)) throw new Error("Recipe " + (index + 1) + " must be an object");
  const id = validateName(input.id || input.name, "Recipe id");
  const parameters = {};
  if (plain(input.parameters)) {
    for (const [name, spec] of Object.entries(input.parameters).slice(0, 32)) {
      const key = validateName(name, "Recipe parameter name");
      parameters[key] = normalizeParam(spec, key);
    }
  }
  if (!Array.isArray(input.steps) || !input.steps.length) throw new Error("Recipe " + id + " requires steps");
  const steps = input.steps.slice(0, 40).map((raw, stepIndex) => {
    if (!plain(raw)) throw new Error("Recipe step " + (stepIndex + 1) + " must be an object");
    const type = String(raw.type || "prompt");
    if (!STEP_TYPES.has(type)) throw new Error("Unsupported recipe step type: " + type);
    const step = {
      id: String(raw.id || ("step-" + (stepIndex + 1))).slice(0, 120),
      type,
      label: String(raw.label || type).slice(0, 160)
    };
    if (type === "prompt") {
      step.prompt = String(raw.prompt || "").slice(0, 64000);
      step.backend = ["codex", "opencode"].includes(String(raw.backend)) ? String(raw.backend) : "codex";
      step.model = String(raw.model || "").slice(0, 240);
      step.agent = String(raw.agent || "").slice(0, 120);
      if (!step.prompt.trim()) throw new Error("Prompt step requires prompt text");
    }
    if (type === "hook") {
      step.event = String(raw.event || "");
      if (!HOOK_EVENTS.includes(step.event)) throw new Error("Recipe hook step has invalid event");
    }
    return step;
  });
  return {
    id,
    name: String(input.name || id).slice(0, 120),
    description: String(input.description || "").slice(0, 500),
    parameters,
    steps,
    enabled: input.enabled !== false
  };
}

function normalizeState(input) {
  const raw = plain(input) ? input : {};
  const hooks = Array.isArray(raw.hooks) ? raw.hooks.slice(0, 50).map(normalizeHook) : [];
  const slash = Array.isArray(raw.slashCommands) ? raw.slashCommands.slice(0, 100).map(normalizeSlashCommand) : [];
  const recipes = Array.isArray(raw.recipes) ? raw.recipes.slice(0, 50).map(normalizeRecipe) : [];
  const names = new Set();
  for (const command of slash) {
    if (names.has(command.name)) throw new Error("Duplicate slash command: /" + command.name);
    names.add(command.name);
  }
  const recipeIds = new Set();
  for (const recipe of recipes) {
    if (recipeIds.has(recipe.id)) throw new Error("Duplicate recipe id: " + recipe.id);
    recipeIds.add(recipe.id);
  }
  return { version: 1, hooks, slashCommands: slash, recipes };
}

function interpolate(template, params) {
  return String(template).replace(/\{\{([a-z][a-z0-9-]{0,31})\}\}/gi, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  );
}

export function validateRecipeParameters(recipe, input = {}) {
  const out = {};
  for (const [name, spec] of Object.entries(recipe.parameters || {})) {
    let value = Object.prototype.hasOwnProperty.call(input, name) ? input[name] : spec.default;
    if (value === undefined || value === null || value === "") {
      if (spec.required) throw new Error("Missing recipe parameter: " + name);
      continue;
    }
    if (spec.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value)) throw new Error("Recipe parameter " + name + " must be a number");
    } else if (spec.type === "boolean") {
      if (typeof value !== "boolean") {
        if (value === "true") value = true;
        else if (value === "false") value = false;
        else throw new Error("Recipe parameter " + name + " must be boolean");
      }
    } else {
      value = String(value);
      if (spec.type === "enum" && !spec.values.includes(value)) {
        throw new Error("Recipe parameter " + name + " must be one of: " + spec.values.join(", "));
      }
    }
    out[name] = value;
  }
  const unknown = Object.keys(input || {}).filter(name => !Object.prototype.hasOwnProperty.call(recipe.parameters || {}, name));
  if (unknown.length) throw new Error("Unknown recipe parameter(s): " + unknown.join(", "));
  return out;
}

export function resolveSlashCommand(commands, input) {
  const text = String(input || "").trim();
  const match = text.match(/^\/([a-z][a-z0-9-]{0,31})(?:\s+([\s\S]*))?$/i);
  if (!match) throw new Error("Slash command must start with /name");
  const name = match[1].toLowerCase();
  const args = String(match[2] || "");
  const command = (commands || []).find(item => item.enabled !== false && item.name === name);
  if (!command) throw new Error("Unknown slash command: /" + name);
  if (command.kind === "action") return { command, action: command.action, prompt: null };
  return {
    command,
    action: null,
    prompt: command.template.replaceAll("{{args}}", args)
  };
}

export function createUserAutomationService({ configDir, resolveProject, executeTask, runVerification }) {
  const file = join(configDir, "user-automation.json");
  const runs = new Map();
  const cancelHandlers = new Map();

  async function readState() {
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    try {
      return normalizeState(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return normalizeState({});
      throw error;
    }
  }

  async function writeState(value) {
    const state = normalizeState(value);
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    const temp = file + "." + process.pid + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, file);
    return state;
  }

  async function emitHook(event, payload = {}) {
    if (!HOOK_EVENTS.includes(event)) throw new Error("Unsupported lifecycle hook event");
    const state = await readState();
    const schema = {
      schemaVersion: HOOK_SCHEMA_VERSION,
      event,
      emittedAt: Date.now(),
      payload: plain(payload) ? payload : {}
    };
    const hooks = state.hooks.filter(hook => hook.enabled && hook.event === event);
    const results = await Promise.all(hooks.map(async hook => {
      if (hook.kind === "notify") return { id: hook.id, status: "observed", schema };
      if (hook.permission !== "mutate" || !hook.approved) {
        return { id: hook.id, status: "blocked", error: "Mutating hook requires explicit approval" };
      }
      try {
        const project = payload.projectId ? await resolveProject(String(payload.projectId)) : null;
        const result = await execFileAsync(hook.command, hook.args, {
          cwd: project?.path,
          timeout: hook.timeoutMs,
          maxBuffer: 256 * 1024,
          windowsHide: true,
          env: {
            ...process.env,
            DEVMOTER_HOOK_SCHEMA: String(HOOK_SCHEMA_VERSION),
            DEVMOTER_HOOK_EVENT: event,
            DEVMOTER_HOOK_EVENT_JSON: JSON.stringify(schema).slice(0, 64000)
          }
        });
        return {
          id: hook.id,
          status: "completed",
          stdout: String(result.stdout || "").slice(0, 12000),
          stderr: String(result.stderr || "").slice(0, 4000)
        };
      } catch (error) {
        return { id: hook.id, status: "failed", error: String(error?.message || error).slice(0, 2000) };
      }
    }));
    return { schema, results };
  }

  async function startRecipe(recipeId, input = {}) {
    const state = await readState();
    const recipe = state.recipes.find(item => item.id === String(recipeId) && item.enabled);
    if (!recipe) throw new Error("Recipe not found or disabled");
    const project = await resolveProject(String(input.projectId || ""));
    const params = validateRecipeParameters(recipe, input.parameters || {});
    const id = randomUUID();
    const run = {
      id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      projectId: project.id,
      status: "queued",
      currentStep: -1,
      results: [],
      parameters: params,
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      cancelRequested: false
    };
    runs.set(id, run);
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
    void executeRecipe(run, recipe);
    return structuredClone(run);
  }

  async function executeRecipe(run, recipe) {
    run.status = "running";
    run.startedAt = Date.now();
    try {
      for (let index = 0; index < recipe.steps.length; index += 1) {
        if (run.cancelRequested) {
          run.status = "cancelled";
          break;
        }
        const step = recipe.steps[index];
        run.currentStep = index;
        const startedAt = Date.now();
        let result;
        if (step.type === "prompt") {
          const prompt = interpolate(step.prompt, run.parameters);
          let cancel = null;
          result = await executeTask({
            projectId: run.projectId,
            backend: step.backend,
            agent: step.agent,
            model: step.model,
            task: prompt
          }, {
            kind: "recipe",
            runId: run.id,
            setCancel(handler) {
              cancel = typeof handler === "function" ? handler : null;
              if (cancel) cancelHandlers.set(run.id, cancel);
            },
            isCancelled: () => run.cancelRequested
          });
          cancelHandlers.delete(run.id);
        } else if (step.type === "verify") {
          result = await runVerification(run.projectId, {});
        } else {
          result = await emitHook(step.event, { projectId: run.projectId, recipeRunId: run.id });
        }
        run.results.push({
          stepId: step.id,
          type: step.type,
          ok: result?.ok !== false,
          startedAt,
          endedAt: Date.now(),
          summary: String(result?.summary || result?.error || (result?.ok === false ? "failed" : "completed")).slice(0, 4000)
        });
        if (result?.ok === false) {
          run.status = "failed";
          break;
        }
      }
      if (run.status === "running") run.status = run.cancelRequested ? "cancelled" : "completed";
    } catch (error) {
      run.status = run.cancelRequested ? "cancelled" : "failed";
      run.results.push({
        stepId: recipe.steps[run.currentStep]?.id || "unknown",
        type: recipe.steps[run.currentStep]?.type || "unknown",
        ok: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
        summary: String(error?.message || error).slice(0, 4000)
      });
    } finally {
      cancelHandlers.delete(run.id);
      run.endedAt = Date.now();
    }
  }

  async function cancelRecipe(id) {
    const run = runs.get(String(id));
    if (!run) throw new Error("Recipe run not found");
    if (["completed", "failed", "cancelled"].includes(run.status)) return structuredClone(run);
    run.cancelRequested = true;
    const cancel = cancelHandlers.get(run.id);
    if (cancel) await Promise.resolve(cancel()).catch(() => {});
    if (run.status === "queued") {
      run.status = "cancelled";
      run.endedAt = Date.now();
    }
    return structuredClone(run);
  }

  return {
    readState,
    writeState,
    emitHook,
    async listSlashCommands() {
      const state = await readState();
      return state.slashCommands.filter(item => item.enabled).map(item => ({ ...item }));
    },
    async resolveSlash(input) {
      const state = await readState();
      return resolveSlashCommand(state.slashCommands, input);
    },
    async listRecipes() {
      return (await readState()).recipes.map(item => ({ ...item }));
    },
    startRecipe,
    cancelRecipe,
    listRuns() { return [...runs.values()].map(item => structuredClone(item)); },
    getRun(id) { const run = runs.get(String(id)); return run ? structuredClone(run) : null; }
  };
}

export const userAutomationPolicy = {
  slashPrecedence: "DevMoter built-ins are reserved and cannot be shadowed; user commands are unique by name.",
  hookTrust: "Only user-owned DevMoter settings are executable. Repository manifests cannot register executable hooks.",
  hookMutation: "Command hooks are mutating and require approved=true; observe hooks never execute a command."
};
