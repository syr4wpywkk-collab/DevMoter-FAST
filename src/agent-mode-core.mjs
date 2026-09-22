export const MODE_TOOL_GROUPS = Object.freeze([
  "read",
  "diagnostics",
  "tests",
  "git",
  "files",
  "commands",
  "network"
]);

const TOOL_GROUP_SET = new Set(MODE_TOOL_GROUPS);

const BUILTIN_MODES = Object.freeze({
  debug: Object.freeze({
    id: "debug",
    name: "Debug",
    description: "Reproduce failures, inspect evidence, run approved diagnostics/tests, and propose the smallest targeted fix.",
    instructions: Object.freeze([
      "Reproduce or narrow the failure before proposing a fix.",
      "Inspect relevant logs, test output, configuration, and code paths.",
      "You may request diagnostics or test commands, but never bypass the backend's normal approval flow.",
      "Prefer the smallest targeted fix that addresses the demonstrated cause.",
      "Any file mutation or command that requires approval must remain in the normal DevMoter/Codex/OpenCode approval and diff flow.",
      "State what you verified after the fix and call out anything you could not verify."
    ]),
    provider: null,
    model: null,
    tools: Object.freeze({
      allow: Object.freeze(["read", "diagnostics", "tests", "git"]),
      deny: Object.freeze([])
    }),
    mutationPolicy: "approval-required",
    custom: false
  }),
  review: Object.freeze({
    id: "review",
    name: "Review",
    description: "Inspect a working tree or selected diff and report risks without silently modifying code.",
    instructions: Object.freeze([
      "Review the working tree, staged changes, commit range, or diff named by the user.",
      "Do not modify files while Review mode is active.",
      "Use read-only inspection and git diff/status commands as needed; normal command approval still applies.",
      "Return structured findings ordered by severity with file:line references whenever the evidence supports one.",
      "For each finding include severity, location, evidence, impact, and a concise remediation suggestion.",
      "If a fix is desired, ask for an explicit transition to a mutation-capable mode instead of changing code silently."
    ]),
    provider: null,
    model: null,
    tools: Object.freeze({
      allow: Object.freeze(["read", "diagnostics", "git"]),
      deny: Object.freeze(["files"])
    }),
    mutationPolicy: "read-only-until-explicit-transition",
    custom: false
  }),
  orchestrator: Object.freeze({
    id: "orchestrator",
    name: "Orchestrator",
    description: "Decompose a large task into bounded child tasks, show the plan, and require approval before delegation.",
    instructions: Object.freeze([
      "Decompose the parent task into bounded child tasks with explicit owners and states.",
      "Show the decomposition before execution.",
      "Do not spawn costly or parallel agents until the user explicitly approves the displayed plan.",
      "Keep child work scoped to the approved task and surface state changes.",
      "All commands and file mutations remain subject to the normal backend approval and diff flow."
    ]),
    provider: null,
    model: null,
    tools: Object.freeze({
      allow: Object.freeze(["read", "diagnostics", "tests", "git", "files", "commands"]),
      deny: Object.freeze([])
    }),
    mutationPolicy: "approval-required",
    custom: false
  })
});

function cloneMode(mode) {
  return {
    ...mode,
    instructions: [...mode.instructions],
    tools: { allow: [...mode.tools.allow], deny: [...mode.tools.deny] }
  };
}

function normalizeToolList(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const normalized = [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))];
  for (const group of normalized) {
    if (!TOOL_GROUP_SET.has(group)) throw new Error(`Unknown tool group: ${group}`);
  }
  return normalized;
}

export function listBuiltinModes() {
  return Object.values(BUILTIN_MODES).map(cloneMode);
}

export function getBuiltinMode(id) {
  const mode = BUILTIN_MODES[String(id || "")];
  if (!mode) throw new Error(`Unknown mode: ${String(id || "")}`);
  return cloneMode(mode);
}

export function validateCustomMode(input) {
  if (!input || typeof input !== "object") throw new Error("Custom mode must be an object");
  const id = String(input.id || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) {
    throw new Error("Custom mode id must be 2-40 lowercase letters, numbers, _ or -");
  }
  if (BUILTIN_MODES[id]) throw new Error(`Custom mode id conflicts with built-in mode: ${id}`);

  const name = String(input.name || "").trim();
  if (!name || name.length > 60) throw new Error("Custom mode name must be 1-60 characters");

  const description = String(input.description || "").trim().slice(0, 240);
  const rawInstructions = Array.isArray(input.instructions)
    ? input.instructions
    : String(input.instructions || "").split(/\r?\n/);
  const instructions = rawInstructions.map(line => String(line).trim()).filter(Boolean);
  if (!instructions.length || instructions.length > 20) {
    throw new Error("Custom mode needs 1-20 instruction lines");
  }
  if (instructions.some(line => line.length > 500)) {
    throw new Error("Custom mode instruction lines must be 500 characters or fewer");
  }

  const tools = input.tools && typeof input.tools === "object" ? input.tools : {};
  const allow = normalizeToolList(tools.allow ?? [], "tools.allow");
  const deny = normalizeToolList(tools.deny ?? [], "tools.deny");
  if (!allow.length) throw new Error("Custom mode must explicitly allow at least one tool group");
  const overlap = allow.find(group => deny.includes(group));
  if (overlap) throw new Error(`Tool group cannot be both allowed and denied: ${overlap}`);

  const mutationPolicy = String(input.mutationPolicy || "approval-required");
  if (!["approval-required", "read-only-until-explicit-transition"].includes(mutationPolicy)) {
    throw new Error(`Unsupported mutation policy: ${mutationPolicy}`);
  }

  const provider = String(input.provider || "").trim().slice(0, 120) || null;
  const model = String(input.model || "").trim().slice(0, 160) || null;

  return {
    id,
    name,
    description,
    instructions,
    provider,
    model,
    tools: { allow, deny },
    mutationPolicy,
    custom: true
  };
}

export function listModes(customModes = []) {
  const normalized = customModes.map(validateCustomMode);
  const seen = new Set();
  for (const mode of normalized) {
    if (seen.has(mode.id)) throw new Error(`Duplicate custom mode id: ${mode.id}`);
    seen.add(mode.id);
  }
  return [...listBuiltinModes(), ...normalized.map(cloneMode)];
}

export function resolveMode(id, customModes = []) {
  const key = String(id || "");
  if (BUILTIN_MODES[key]) return getBuiltinMode(key);
  const mode = customModes.map(validateCustomMode).find(item => item.id === key);
  if (!mode) throw new Error(`Unknown mode: ${key}`);
  return cloneMode(mode);
}

export function renderModePolicy(mode) {
  const normalized = typeof mode === "string" ? getBuiltinMode(mode) : mode;
  const lines = [
    `${normalized.name} mode`,
    ...normalized.instructions.map((line, index) => `${index + 1}. ${line}`),
    normalized.provider ? `Preferred provider: ${normalized.provider}` : "",
    normalized.model ? `Preferred model: ${normalized.model}` : "",
    `Allowed tool groups: ${normalized.tools.allow.join(", ") || "none"}`,
    `Denied tool groups: ${normalized.tools.deny.join(", ") || "none"}`,
    `Mutation policy: ${normalized.mutationPolicy}`
  ];
  return lines.filter(Boolean).join("\n");
}

export function compileModePrompt(modeId, task, context = {}, customModes = []) {
  const mode = resolveMode(modeId, customModes);
  const cleanTask = String(task || "").trim();
  if (!cleanTask) throw new Error("Task is required");

  const contextLines = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([key, value]) => `- ${key}: ${String(value).trim()}`);

  return [
    `[DevMoter mode: ${mode.name}]`,
    "Follow this mode policy for this turn:",
    renderModePolicy(mode),
    contextLines.length ? `Context:\n${contextLines.join("\n")}` : "",
    `User task:\n${cleanTask}`
  ].filter(Boolean).join("\n\n");
}
