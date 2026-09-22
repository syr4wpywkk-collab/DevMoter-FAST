export const MODE_TOOL_GROUPS = Object.freeze([
  "read",
  "diagnostics",
  "tests",
  "git",
  "files",
  "commands",
  "network"
]);

const BUILTIN_MODES = Object.freeze({
  debug: Object.freeze({
    id: "debug",
    name: "Debug",
    description: "Reproduce failures, inspect evidence, run approved diagnostics/tests, and propose the smallest targeted fix.",
    instructions: [
      "Reproduce or narrow the failure before proposing a fix.",
      "Inspect relevant logs, test output, configuration, and code paths.",
      "You may request diagnostics or test commands, but never bypass the backend's normal approval flow.",
      "Prefer the smallest targeted fix that addresses the demonstrated cause.",
      "Any file mutation or command that requires approval must remain in the normal DevMoter/Codex/OpenCode approval and diff flow.",
      "State what you verified after the fix and call out anything you could not verify."
    ],
    model: null,
    tools: Object.freeze({
      allow: Object.freeze(["read", "diagnostics", "tests", "git"]),
      deny: Object.freeze([])
    }),
    mutationPolicy: "approval-required"
  })
});

export function listBuiltinModes() {
  return Object.values(BUILTIN_MODES).map(mode => ({
    ...mode,
    instructions: [...mode.instructions],
    tools: { allow: [...mode.tools.allow], deny: [...mode.tools.deny] }
  }));
}

export function getBuiltinMode(id) {
  const mode = BUILTIN_MODES[String(id || "")];
  if (!mode) throw new Error(`Unknown mode: ${String(id || "")}`);
  return {
    ...mode,
    instructions: [...mode.instructions],
    tools: { allow: [...mode.tools.allow], deny: [...mode.tools.deny] }
  };
}

export function renderModePolicy(mode) {
  const normalized = typeof mode === "string" ? getBuiltinMode(mode) : mode;
  const lines = [
    `${normalized.name} mode`,
    ...normalized.instructions.map((line, index) => `${index + 1}. ${line}`),
    `Allowed tool groups: ${normalized.tools.allow.join(", ") || "none"}`,
    `Denied tool groups: ${normalized.tools.deny.join(", ") || "none"}`,
    `Mutation policy: ${normalized.mutationPolicy}`
  ];
  return lines.join("\n");
}

export function compileModePrompt(modeId, task, context = {}) {
  const mode = getBuiltinMode(modeId);
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
